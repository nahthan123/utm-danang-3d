r"""Exercise real Ops -> HTTP -> SQLite -> WebSocket with disposable databases.

Usage: .venv\Scripts\python scripts/verify_ops_handoff.py --ops-jar <packaged-ops.jar> --java <java.exe>
"""

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time

import httpx
from websockets.sync.client import connect


def free_port():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return server.getsockname()[1]


def wait_for(url, process):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Service exited during startup; inspect the verification log")
        try:
            if httpx.get(url, timeout=1).status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise RuntimeError("Service startup timed out")


def request(client, method, path, **kwargs):
    response = client.request(method, path, **kwargs)
    response.raise_for_status()
    return response.json()


def verify(ops, operator, backend_url, ws_url, token):
    drone = request(operator, "POST", "/api/drones", json={
        "serialNumber": "HANDOFF-TEST-001", "model": "Test UAV", "droneType": "MULTIROTOR",
        "maxFlightTime": 30, "maxSpeed": 20,
    })
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=2)
    end = start + timedelta(minutes=10)
    flight = request(operator, "POST", "/api/flights", json={
        "droneId": drone["id"], "startTime": start.isoformat(), "endTime": end.isoformat(),
        "departureName": "Điểm A", "destinationName": "Điểm B",
        "trajectoryJson": json.dumps([
            {"latitude": 16.06, "longitude": 108.22, "altitude": 60, "time": start.isoformat()},
            {"latitude": 16.065, "longitude": 108.225, "altitude": 60, "time": end.isoformat()},
        ]),
    })

    def receipt(event_type):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            rows = request(ops, "GET", f"/api/flights/{flight['id']}/integration")
            for row in rows:
                if row["target"] == "MONITORING" and row["eventType"] == event_type and row["status"] == "DELIVERED":
                    assert any(r["target"] == "SIMULATION" and r["status"] == "PENDING" for r in rows)
                    return json.loads(row["payloadJson"])
            time.sleep(0.2)
        raise AssertionError("No DELIVERED monitoring receipt")

    with connect(ws_url) as stream:
        assert json.loads(stream.recv(timeout=5))["payload"] == []
        request(ops, "PUT", f"/api/flights/{flight['id']}/status", json={"status": "APPROVED"})
        rows = request(ops, "GET", f"/api/flights/{flight['id']}/integration")
        from backend.app.api.flight_plan_routes import FlightPlanEvent
        for row in rows:
            FlightPlanEvent.model_validate_json(row["payloadJson"])
        update = json.loads(stream.recv(timeout=15))
        assert update["type"] == "flight_plan.update"
        assert update["payload"]["plan_id"] == flight["id"]
        assert update["payload"]["uav_id"] == drone["id"]
        assert update["payload"]["status"] == "SCHEDULED"
        original = receipt("flightplan.accepted")
        # The operator cancellation endpoint is deliberately exercised before takeoff.
        request(operator, "PUT", f"/api/flights/{flight['id']}/cancel")
        assert json.loads(stream.recv(timeout=15))["payload"]["status"] == "CANCELLED"
        receipt("flightplan.cancelled")
    with httpx.Client() as client:
        replay = client.post(backend_url + "/api/integration/flight-plans", json=original,
                             headers={"X-UTM-Integration-Key": token})
        replay.raise_for_status()
        assert replay.json()["duplicate"] is True
    with connect(ws_url) as stream:
        snapshot = json.loads(stream.recv(timeout=5))
        assert snapshot["payload"][0]["status"] == "CANCELLED"
    print("PASS: approval -> real HTTP ACK -> WebSocket plan -> cancellation -> duplicate replay -> reconnect snapshot")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ops-jar", type=Path, required=True)
    parser.add_argument("--java", default="java")
    args = parser.parse_args()
    jar = args.ops_jar.resolve(strict=True)
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    data = root / "data"
    data.mkdir(exist_ok=True)
    ops_port, backend_port = free_port(), free_port()
    ops_url, backend_url = f"http://127.0.0.1:{ops_port}", f"http://127.0.0.1:{backend_port}"
    token, password = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    processes = []
    with tempfile.TemporaryDirectory(prefix="handoff-verification-", dir=data) as temp:
        temp = Path(temp)
        env = os.environ.copy()
        env.update(UTM_MONITORING_TOKEN=token, UTM_MONITORING_DB=str(temp / "monitoring.sqlite3"),
                   PYTHONDONTWRITEBYTECODE="1")
        with (temp / "backend.log").open("w") as backend_log, (temp / "ops.log").open("w") as ops_log:
            try:
                flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
                backend = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.app.main:app",
                                            "--host", "127.0.0.1", "--port", str(backend_port)],
                                           cwd=root, env=env, stdout=backend_log, stderr=subprocess.STDOUT, **flags)
                processes.append(backend)
                ops = subprocess.Popen([
                    args.java, "-jar", str(jar), f"--server.port={ops_port}", "--spring.config.import=",
                    "--spring.datasource.url=jdbc:h2:mem:handoff;DB_CLOSE_DELAY=-1",
                    "--spring.datasource.driver-class-name=org.h2.Driver", "--spring.datasource.username=sa",
                    "--spring.datasource.password=", "--spring.jpa.hibernate.ddl-auto=create-drop",
                    "--spring.profiles.active=handoff-verification", "--utm.integration.mode=http",
                    f"--utm.integration.monitoring-url={backend_url}/api/integration/flight-plans",
                    "--utm.integration.poll-ms=500", "--utm.bootstrap.username=handoffadmin",
                    f"--utm.bootstrap.password={password}", "--logging.level.root=WARN",
                    "--logging.level.org.hibernate.SQL=WARN", "--spring.jpa.show-sql=false",
                ], cwd=temp, env=env, stdout=ops_log, stderr=subprocess.STDOUT, **flags)
                processes.append(ops)
                wait_for(backend_url + "/", backend)
                wait_for(ops_url + "/", ops)
                with httpx.Client(base_url=ops_url) as admin, httpx.Client(base_url=ops_url) as operator:
                    request(admin, "POST", "/api/auth/login", json={"username": "handoffadmin", "password": password})
                    request(operator, "POST", "/api/auth/register", json={
                        "username": "handoffoperator", "password": password, "fullName": "Handoff Test",
                        "email": "handoff@example.test", "phone": "0901234567",
                    })
                    verify(admin, operator, backend_url, f"ws://127.0.0.1:{backend_port}/ws/flight-plans", token)
            except Exception:
                for log in [temp / "backend.log", temp / "ops.log"]:
                    print(log.name + ":\n" + log.read_text(errors="replace")[-8000:], file=sys.stderr)
                raise
            finally:
                for process in reversed(processes):
                    if os.name == "nt":
                        # Windows venv launchers can leave the actual Python child running.
                        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       creationflags=subprocess.CREATE_NO_WINDOW, check=False)
                    else:
                        process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)


if __name__ == "__main__":
    main()
