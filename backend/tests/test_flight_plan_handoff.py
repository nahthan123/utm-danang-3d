from copy import deepcopy
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.app.main import app
from backend.app.api import flight_plan_routes as routes

TOKEN = "test-monitoring-key-123456"
HEADERS = {"X-UTM-Integration-Key": TOKEN}
URL = "/api/integration/flight-plans"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("UTM_MONITORING_TOKEN", TOKEN)
    monkeypatch.setenv("UTM_MONITORING_DB", str(tmp_path / "monitoring.sqlite3"))
    routes.get_store.cache_clear()
    with TestClient(app) as instance:
        yield instance
    routes.get_store.cache_clear()


@pytest.fixture
def event():
    return json.loads((Path(__file__).parent / "fixtures" / "ops-flightplan-accepted.json").read_text(encoding="utf-8"))


def test_push_is_broadcast_persisted_and_replayed_without_fabricating_telemetry(client, event):
    with client.websocket_connect("/ws/flight-plans") as ws:
        assert ws.receive_json() == {"type": "flight_plan.snapshot", "payload": []}
        result = client.post(URL, headers=HEADERS, json=event)
        assert result.status_code == 200
        assert result.json()["eventId"] == event["eventId"]
        update = ws.receive_json()
        assert update["type"] == "flight_plan.update"
        plan = update["payload"]
        assert plan["uav_id"] == event["flightPlan"]["droneId"]
        assert plan["plan_id"] == event["flightPlan"]["flightId"]
        assert plan["status"] == "SCHEDULED"
        assert plan["altitude_reference"] == "AGL"
        assert plan["waypoints"][0]["altitude_m"] == 60
        assert "position" not in plan
    # Reload the receiver store to exercise disk persistence, then connect a new dashboard.
    routes.get_store.cache_clear()
    with client.websocket_connect("/ws/flight-plans") as ws:
        assert ws.receive_json()["payload"] == [plan]
    assert client.post(URL, headers=HEADERS, json=event).json()["duplicate"] is True
    assert len(routes.get_store().snapshot()) == 1


def test_cancel_and_complete_cannot_be_undone_by_delayed_approval(client, event):
    assert client.post(URL, headers=HEADERS, json=event).status_code == 200
    cancel = deepcopy(event)
    cancel.update(eventId=str(uuid4()), eventType="flightplan.cancelled", occurredAt="2027-01-01T01:30:00Z")
    cancel["flightPlan"]["status"] = "CANCELLED"
    assert client.post(URL, headers=HEADERS, json=cancel).json()["applied"] is True
    delayed = deepcopy(event)
    delayed["eventId"] = str(uuid4())
    assert client.post(URL, headers=HEADERS, json=delayed).json()["applied"] is False
    delayed.update(eventId=str(uuid4()), occurredAt="2027-01-01T01:40:00Z")
    assert client.post(URL, headers=HEADERS, json=delayed).json()["applied"] is False
    assert routes.get_store().snapshot()[0]["status"] == "CANCELLED"


def test_active_and_completed_snapshots_work_without_receiving_original_approval(client, event):
    for status, occurred in [("ACTIVE", "02:00:00"), ("COMPLETED", "02:10:00")]:
        update = deepcopy(event)
        update.update(eventId=str(uuid4()), eventType="flightplan.status.changed", occurredAt=f"2027-01-01T{occurred}Z")
        update["flightPlan"]["status"] = status
        assert client.post(URL, headers=HEADERS, json=update).json()["applied"] is True
        assert routes.get_store().snapshot()[0]["status"] == status


def test_authentication_validation_and_event_id_collision(client, event, monkeypatch):
    assert client.post(URL, json=event).status_code == 401
    invalid = deepcopy(event)
    invalid["flightPlan"]["waypoints"][0]["latitude"] = 91
    assert client.post(URL, headers=HEADERS, json=invalid).status_code == 422
    invalid = deepcopy(event)
    invalid["flightPlan"]["waypoints"][1]["time"] = "2027-01-01T01:00:00Z"
    assert client.post(URL, headers=HEADERS, json=invalid).status_code == 422
    invalid = deepcopy(event)
    invalid["flightPlan"]["status"] = "CANCELLED"
    assert client.post(URL, headers=HEADERS, json=invalid).status_code == 422
    assert client.post(URL, headers=HEADERS, json=event).status_code == 200
    event["flightPlan"]["serialNumber"] = "different-drone"
    assert client.post(URL, headers=HEADERS, json=event).status_code == 409
    monkeypatch.delenv("UTM_MONITORING_TOKEN")
    assert client.post(URL, headers=HEADERS, json=event).status_code == 503


def test_legacy_amsl_is_mapped_to_msl_without_changing_altitude(client, event):
    event["coordinateSystem"]["altitudeReference"] = "AMSL"
    assert client.post(URL, headers=HEADERS, json=event).status_code == 200
    plan = routes.get_store().snapshot()[0]
    assert plan["altitude_reference"] == "MSL"
    assert plan["waypoints"][0]["altitude_m"] == 60
