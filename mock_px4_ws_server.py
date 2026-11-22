"""
Mock PX4 / FastAPI WebSocket Telemetry Server (10Hz Multi-UAV)
Matches the exact JSON payload schema and endpoint (ws://localhost:<PORT>/ws/telemetry)
of the Khối 2 SITL/Gazebo backend for offline integration testing of Khối 4 (Web 3D).

Streams 2 UAVs simultaneously (uav-1 and uav-2) at 10Hz.
Optional PORT environment variable defaults to 8000.

Run:
    python mock_px4_ws_server.py
    # or on Windows PowerShell with custom port alongside backend :8000:
    $env:PORT=8001; python mock_px4_ws_server.py
"""

import asyncio
import math
import os
import time
from datetime import datetime, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(title="Mock PX4 Multi-UAV Telemetry Stream (10Hz)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HOME_LAT = 16.0608
HOME_LON = 108.2225
GROUND_MSL = 10.0

UAV_ROUTES = [
    {
        "uav_id": "uav-1",
        "system_id": 1,
        "speed_cruise": 14.0,
        "waypoints": [
            (16.0606, 108.2225, 0.0),    # Home pad (APEC Park / Dragon Bridge West)
            (16.0606, 108.2225, 72.0),   # Vertical takeoff to 72m AGL
            (16.0608, 108.2264, 75.0),   # East across Dragon Bridge
            (16.0648, 108.2256, 78.0),   # North over Han River (West corridor)
            (16.0642, 108.2224, 74.0),   # Return along Bach Dang Waterfront
            (16.0606, 108.2225, 72.0),   # Hold above Home
        ],
    },
    {
        "uav_id": "uav-2",
        "system_id": 2,
        "speed_cruise": 15.0,
        "waypoints": [
            (16.0718, 108.2286, 88.0),   # Han River East near Song Han Bridge
            (16.0724, 108.2236, 92.0),   # West across Song Han Bridge
            (16.0762, 108.2242, 95.0),   # North toward Thuan Phuoc corridor
            (16.0758, 108.2288, 90.0),   # East bank Waterfront
            (16.0718, 108.2286, 88.0),   # Return East Song Han Bridge
        ],
    },
]


def calc_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lat = (lat2 - lat1) * 111319.5
    d_lon = (lon2 - lon1) * 111319.5 * math.cos(math.radians(lat1))
    if math.hypot(d_lat, d_lon) < 0.05:
        return 90.0
    ang = math.degrees(math.atan2(d_lon, d_lat))
    return (ang + 360.0) % 360.0


def build_uav_tick(state: dict, dt: float, elapsed_ms: int, now_iso: str) -> dict:
    waypoints = state["waypoints"]
    seg_idx = state["seg_idx"]

    lat_a, lon_a, alt_a = waypoints[seg_idx]
    lat_b, lon_b, alt_b = waypoints[(seg_idx + 1) % len(waypoints)]

    d_north = (lat_b - lat_a) * 111319.5
    d_east = (lon_b - lon_a) * 111319.5 * math.cos(math.radians(lat_a))
    d_alt = alt_b - alt_a
    seg_dist = max(1.0, math.sqrt(d_north**2 + d_east**2 + d_alt**2))

    speed_mps = 4.5 if (seg_idx == 0 and alt_a < 1.0) else state["speed_cruise"]
    seg_duration = max(3.5, seg_dist / speed_mps)
    state["seg_t"] += dt / seg_duration

    if state["seg_t"] >= 1.0:
        state["seg_t"] = 0.0
        state["seg_idx"] = (seg_idx + 1) % len(waypoints)
        if state["seg_idx"] == 0:
            state["battery"] = 99.0
        seg_idx = state["seg_idx"]
        lat_a, lon_a, alt_a = waypoints[seg_idx]
        lat_b, lon_b, alt_b = waypoints[(seg_idx + 1) % len(waypoints)]
        d_north = (lat_b - lat_a) * 111319.5
        d_east = (lon_b - lon_a) * 111319.5 * math.cos(math.radians(lat_a))
        d_alt = alt_b - alt_a
        seg_dist = max(1.0, math.sqrt(d_north**2 + d_east**2 + d_alt**2))
        speed_mps = 4.5 if (seg_idx == 0 and alt_a < 1.0) else state["speed_cruise"]
        seg_duration = max(3.5, seg_dist / speed_mps)

    t = state["seg_t"]
    lat = lat_a + (lat_b - lat_a) * t
    lon = lon_a + (lon_b - lon_a) * t
    rel_alt = max(0.0, alt_a + (alt_b - alt_a) * t)
    alt_msl = GROUND_MSL + rel_alt

    vx = d_north / seg_duration
    vy = d_east / seg_duration
    climb_rate = d_alt / seg_duration
    groundspeed = math.hypot(vx, vy)
    heading = calc_bearing_deg(lat_a, lon_a, lat_b, lon_b)

    if seg_idx == 0 and alt_a < 1.0:
        flight_mode = "AUTO_TAKEOFF"
        landed_state = "TAKING_OFF" if rel_alt < 5.0 else "IN_AIR"
    elif seg_idx == len(waypoints) - 1:
        flight_mode = "AUTO_HOLD"
        landed_state = "IN_AIR" if rel_alt > 1.0 else "ON_GROUND"
    else:
        flight_mode = "AUTO_MISSION"
        landed_state = "IN_AIR"

    state["battery"] = max(20.0, state["battery"] - 0.006)
    battery = state["battery"]

    local_x = (lat - HOME_LAT) * 111319.5
    local_y = (lon - HOME_LON) * 111319.5 * math.cos(math.radians(HOME_LAT))

    return {
        "uav_id": state["uav_id"],
        "system_id": state["system_id"],
        "status": {
            "connected": True,
            "armed": True,
            "flight_mode": flight_mode,
            "landed_state": landed_state,
        },
        "position": {
            "latitude": round(lat, 7),
            "longitude": round(lon, 7),
            "altitude_msl_m": round(alt_msl, 2),
            "relative_altitude_m": round(rel_alt, 2),
        },
        "local_position": {
            "x_m": round(local_x, 3),
            "y_m": round(local_y, 3),
            "z_m": round(-rel_alt, 3),
        },
        "velocity": {
            "vx_m_s": round(vx, 2),
            "vy_m_s": round(vy, 2),
            "vz_m_s": round(-climb_rate, 2),
            "groundspeed_m_s": round(groundspeed, 2),
            "climb_rate_m_s": round(climb_rate, 2),
        },
        "attitude": {
            "roll_deg": round(math.sin((elapsed_ms + state["system_id"] * 500) / 1500.0) * 1.8, 2),
            "pitch_deg": round(-3.5 if groundspeed > 2.0 else 0.2, 2),
            "yaw_deg": round(heading, 2),
            "heading_deg": round(heading, 1),
        },
        "battery": {
            "voltage_v": round(14.8 + (battery / 100.0) * 2.0, 2),
            "remaining_percent": round(battery, 1),
        },
        "gps": {
            "fix_type": 3,
            "satellites": 10,
        },
        "timestamps": {
            "source_timestamp_ms": elapsed_ms,
            "backend_timestamp": now_iso,
        },
    }


@app.get("/")
async def root():
    port = int(os.getenv("PORT", "8000"))
    return {
        "service": "Mock PX4 Multi-UAV Telemetry Server (10Hz)",
        "uavs": [r["uav_id"] for r in UAV_ROUTES],
        "websocket": f"ws://localhost:{port}/ws/telemetry",
        "status": "running",
    }


@app.websocket("/ws/telemetry")
async def telemetry_ws(websocket: WebSocket):
    await websocket.accept()
    print("[Mock PX4 WS] Client connected to /ws/telemetry (2 UAVs @ 10Hz)")

    start_wall = time.time()
    dt = 0.1  # 10 Hz
    uav_states = [
        {
            "uav_id": route["uav_id"],
            "system_id": route["system_id"],
            "speed_cruise": route["speed_cruise"],
            "waypoints": route["waypoints"],
            "seg_idx": 0,
            "seg_t": 0.0,
            "battery": 99.0 - idx * 4.0,
        }
        for idx, route in enumerate(UAV_ROUTES)
    ]

    try:
        while True:
            elapsed_ms = int((time.time() - start_wall) * 1000)
            now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

            for uav_state in uav_states:
                packet = build_uav_tick(uav_state, dt, elapsed_ms, now_iso)
                await websocket.send_json(packet)

            await asyncio.sleep(dt)
    except WebSocketDisconnect:
        print("[Mock PX4 WS] Client disconnected")


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    print(f"Starting Mock PX4 Multi-UAV Telemetry Server on ws://localhost:{port}/ws/telemetry (10Hz)...")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
