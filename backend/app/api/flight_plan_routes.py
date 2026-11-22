"""Durable, idempotent UTM Ops handoff. Planned paths never create observed UAVs."""

import asyncio
from contextlib import closing
from functools import lru_cache
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

router = APIRouter(tags=["UTM Ops flight plans"])


class Coordinates(BaseModel):
    horizontalReference: Literal["WGS84"]
    epsg: Literal[4326]
    altitudeReference: Literal["AGL", "MSL", "AMSL", "WGS84"]
    altitudeUnit: Literal["m"]
    timeReference: Literal["UTC"]


class Waypoint(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude: float = Field(ge=-500, le=50000)
    time: AwareDatetime


class OpsPlan(BaseModel):
    flightId: UUID
    droneId: UUID
    serialNumber: str = Field(min_length=1, max_length=255)
    operatorId: UUID
    droneType: Literal["MULTIROTOR", "FIXED_WING", "HYBRID"] | None = None
    departureName: str | None = None
    destinationName: str | None = None
    startTime: AwareDatetime
    endTime: AwareDatetime
    status: Literal["APPROVED", "ACTIVE", "COMPLETED", "CANCELLED"]
    waypoints: list[Waypoint] = Field(min_length=2, max_length=10000)

    @model_validator(mode="after")
    def validate_route(self):
        if self.startTime >= self.endTime:
            raise ValueError("endTime must follow startTime")
        if self.waypoints[0].time != self.startTime or self.waypoints[-1].time != self.endTime:
            raise ValueError("Waypoint endpoints must match the flight window")
        if any(a.time >= b.time for a, b in zip(self.waypoints, self.waypoints[1:])):
            raise ValueError("Waypoint times must increase")
        return self


class FlightPlanEvent(BaseModel):
    schemaVersion: Literal["1.0"]
    eventId: UUID
    eventType: Literal["flightplan.accepted", "flightplan.status.changed", "flightplan.cancelled"]
    occurredAt: AwareDatetime
    coordinateSystem: Coordinates
    flightPlan: OpsPlan

    @model_validator(mode="after")
    def validate_transition(self):
        allowed = {
            "flightplan.accepted": {"APPROVED"},
            "flightplan.status.changed": {"ACTIVE", "COMPLETED"},
            "flightplan.cancelled": {"CANCELLED"},
        }
        if self.flightPlan.status not in allowed[self.eventType]:
            raise ValueError("Event type does not match flight status")
        return self


def planned_speed(a: Waypoint, b: Waypoint) -> float:
    lat1, lat2 = math.radians(a.latitude), math.radians(b.latitude)
    dlat = lat2 - lat1
    dlon = math.radians(b.longitude - a.longitude)
    hav = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    distance = 6371000 * 2 * math.asin(math.sqrt(min(1.0, hav)))
    return distance / (b.time - a.time).total_seconds()


def monitoring_plan(event: FlightPlanEvent) -> dict:
    plan = event.flightPlan
    return {
        "plan_id": str(plan.flightId), "uav_id": str(plan.droneId),
        "callsign": plan.serialNumber, "operator_id": str(plan.operatorId),
        "departure_time_utc": plan.startTime.isoformat(),
        "estimated_arrival_time_utc": plan.endTime.isoformat(),
        "altitude_reference": "MSL" if event.coordinateSystem.altitudeReference == "AMSL"
        else event.coordinateSystem.altitudeReference,
        "waypoints": [
            {"id": f"{plan.flightId}-WP-{i + 1}", "name": f"WP {i + 1}",
             "latitude": point.latitude, "longitude": point.longitude,
             "altitude_m": point.altitude, "planned_time_utc": point.time.isoformat(),
             "planned_speed_mps": planned_speed(plan.waypoints[i - 1], point) if i else
             planned_speed(point, plan.waypoints[1])}
            for i, point in enumerate(plan.waypoints)
        ],
        # Monitoring tolerances, not a claim that Ops granted an airspace corridor.
        "corridor_width_m": 50, "altitude_corridor_m": 15, "time_tolerance_s": 10,
        "status": "SCHEDULED" if plan.status == "APPROVED" else plan.status,
        "source": "UTM_OPS", "departure_name": plan.departureName,
        "destination_name": plan.destinationName,
    }


class FlightPlanStore:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS ops_events (event_id TEXT PRIMARY KEY, digest TEXT NOT NULL)")
            db.execute("""CREATE TABLE IF NOT EXISTS ops_plans (
                plan_id TEXT PRIMARY KEY, occurred_at REAL NOT NULL, rank INTEGER NOT NULL,
                payload TEXT NOT NULL)""")

    def snapshot(self) -> list[dict]:
        with closing(sqlite3.connect(self.path)) as db:
            return [json.loads(row[0]) for row in db.execute("SELECT payload FROM ops_plans ORDER BY plan_id")]

    def accept(self, event: FlightPlanEvent) -> tuple[dict, dict | None]:
        event_id = str(event.eventId)
        digest = hashlib.sha256(event.model_dump_json().encode()).hexdigest()
        plan = monitoring_plan(event)
        rank = {"SCHEDULED": 1, "ACTIVE": 2, "COMPLETED": 3, "CANCELLED": 3}[plan["status"]]
        timestamp = event.occurredAt.timestamp()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            duplicate = db.execute("SELECT digest FROM ops_events WHERE event_id=?", (event_id,)).fetchone()
            if duplicate:
                if duplicate[0] != digest:
                    raise HTTPException(409, "eventId already used for a different payload")
                return {"status": "ACCEPTED", "eventId": event_id, "duplicate": True, "applied": False}, None
            previous = db.execute("SELECT occurred_at, rank, payload FROM ops_plans WHERE plan_id=?",
                                  (plan["plan_id"],)).fetchone()
            applied = previous is None or (
                timestamp >= previous[0] and rank >= previous[1]
                and (previous[1] < 3 or json.loads(previous[2])["status"] == plan["status"]))
            db.execute("INSERT INTO ops_events VALUES (?, ?)", (event_id, digest))
            if applied:
                db.execute("INSERT OR REPLACE INTO ops_plans VALUES (?, ?, ?, ?)",
                           (plan["plan_id"], timestamp, rank, json.dumps(plan)))
        return {"status": "ACCEPTED", "eventId": event_id, "duplicate": False, "applied": applied}, plan if applied else None


@lru_cache
def get_store() -> FlightPlanStore:
    return FlightPlanStore(os.getenv("UTM_MONITORING_DB", "data/monitoring.sqlite3"))


subscribers: set[WebSocket] = set()
handoff_lock = asyncio.Lock()


@router.post("/api/integration/flight-plans")
async def receive_plan(event: FlightPlanEvent, x_utm_integration_key: str | None = Header(default=None)):
    token = os.getenv("UTM_MONITORING_TOKEN", "").strip()
    if len(token) < 16:
        raise HTTPException(503, "UTM_MONITORING_TOKEN must be configured (at least 16 characters)")
    if not hmac.compare_digest((x_utm_integration_key or "").encode(), token.encode()):
        raise HTTPException(401, "Invalid integration key")
    async with handoff_lock:
        ack, plan = get_store().accept(event)
        if plan is not None:
            for socket in list(subscribers):
                try:
                    await asyncio.wait_for(socket.send_json({"type": "flight_plan.update", "payload": plan}), 2)
                except (TimeoutError, RuntimeError, WebSocketDisconnect, OSError):
                    subscribers.discard(socket)
        return ack


@router.websocket("/ws/flight-plans")
async def watch_plans(socket: WebSocket):
    await socket.accept()
    try:
        async with handoff_lock:
            await socket.send_json({"type": "flight_plan.snapshot", "payload": get_store().snapshot()})
            subscribers.add(socket)
        while True:
            await socket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        subscribers.discard(socket)
