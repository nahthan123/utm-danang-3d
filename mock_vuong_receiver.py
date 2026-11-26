"""
Mock Vuong UTM Ops Outbound Receiver (HTTP POST Port 8080)
Simulates Vuong's Khối 1 HTTP endpoint receiving progress updates and tactical decisions
from Khối 4/5 (Web 3D Monitoring).

Run:
    python mock_vuong_receiver.py
"""

from collections import deque
from datetime import datetime, timezone
import json
import os
from typing import Any, Dict
import urllib.request

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import uvicorn

app = FastAPI(title="Mock Vuong UTM Ops Receiver")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

received_items: deque[Dict[str, Any]] = deque(maxlen=50)
total_received_count = 0


def record_item(endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    global total_received_count
    total_received_count += 1
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    entry = {
        "receivedAt": now_iso,
        "endpoint": endpoint,
        "payload": payload,
    }
    received_items.appendleft(entry)
    return entry


@app.get("/api/received")
async def inspect_received_json():
    items = list(received_items)
    return {
        "service": "Mock Vuong UTM Ops Receiver",
        "received_count": total_received_count,
        "stored_count": len(items),
        "latest": items[:20],
    }


@app.get("/", response_class=HTMLResponse)
async def live_dashboard():
    return """<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Mock Vương UTM Ops Receiver (:8080)</title>
  <style>
    body { margin: 0; padding: 18px 24px; background: #070b14; color: #e2e8f0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; }
    .top { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e293b; padding-bottom: 12px; margin-bottom: 14px; }
    .badge { background: #064e3b; color: #6ee7b7; border: 1px solid #059669; padding: 4px 10px; border-radius: 6px; font-weight: bold; }
    .item { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
    .decision { border-color: #f59e0b; background: #1c1917; }
    .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .uav { color: #38bdf8; font-weight: bold; font-size: 14px; }
    .meta { color: #94a3b8; font-size: 12px; }
    pre { margin: 6px 0 0; padding: 8px; background: #020617; border: 1px solid #1e293b; border-radius: 6px; overflow-x: auto; font-size: 11px; color: #cbd5e1; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <strong style="font-size:16px;color:#fff;">KHỐI 1 — VƯƠNG UTM OPS (:8080) — DUYỆT ĐƠN BAY & NHẬN BÁO CÁO GIÁM SÁT</strong>
      <div class="meta">Tự động cập nhật mỗi 1 giây • <a href="/api/received" target="_blank">Xem JSON thô (/api/received)</a></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button onclick="approvePlan('uav-1')" style="background:#0284c7;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;">+ Duyệt & Gửi Đơn Bay uav-1 sang Khối 2 & Khối 4</button>
      <button onclick="approvePlan('uav-2')" style="background:#7c3aed;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;">+ Duyệt & Gửi Đơn Bay uav-2 sang Khối 2 & Khối 4</button>
      <div class="badge" id="counter">Đã nhận: 0 gói tin</div>
    </div>
  </div>
  <div id="dispatchStatus" style="margin-bottom:10px;color:#4ade80;font-weight:bold;"></div>
  <div id="list">Đang chờ gói tin từ Web 3D (:3000)...</div>
  <script>
    async function poll() {
      try {
        const res = await fetch('/api/received');
        const data = await res.json();
        document.getElementById('counter').textContent = 'Đã nhận liên tục: ' + data.received_count + ' gói tin (2s/lần)';
        const list = document.getElementById('list');
        if (!data.latest || data.latest.length === 0) {
          list.innerHTML = '<div class="meta">Chưa có gói tin nào — hãy mở http://localhost:3000 để Web 3D tự động đẩy vị trí sang!</div>';
          return;
        }
        list.innerHTML = data.latest.slice(0, 10).map((entry) => {
          const p = entry.payload || {};
          const isDec = p.eventType === 'monitoring.decision';
          const pos = p.currentPosition || {};
          const pred = p.predictedNextPosition;
          const prog = p.routeProgress || {};
          const predLine = pred
            ? ('<div style="color:#facc15;margin-top:3px;">Dự đoán ' + (pred.lookaheadSec ?? 12) + 's tới: (' + pred.latitude + ', ' + pred.longitude + ', ' + pred.altitudeM + 'm)</div>')
            : '';
          const summary = isDec
            ? ('QUYẾT ĐỊNH BAY [' + (p.decisionStatus || '') + ']: ' + (p.instructionSummary || ''))
            : ('Vị trí: (' + (pos.latitude ?? '-') + ', ' + (pos.longitude ?? '-') + ') | Độ cao: ' + (pos.altitudeM ?? '-') + 'm ' + (pos.altitudeReference || '') + ' | Tốc độ: ' + (pos.groundSpeedMps ?? '-') + ' m/s | Hướng: ' + (pos.headingDeg ?? '-') + '° | Lộ trình: ' + (prog.progressPercent ?? 0) + '% (' + (prog.currentLegLabel || '-') + ')' + predLine);
          return '<div class="item ' + (isDec ? 'decision' : '') + '">' +
            '<div class="row"><span class="uav">' + (p.droneId || '?') + ' · ' + (p.eventType || '') + '</span><span class="meta">' + entry.receivedAt + '</span></div>' +
            '<div style="color:' + (isDec ? '#fcd34d' : '#e2e8f0') + '">' + summary + '</div>' +
            '<pre>' + JSON.stringify(p, null, 2) + '</pre>' +
          '</div>';
        }).join('');
      } catch (e) {}
    }
    async function approvePlan(uavId) {
      const box = document.getElementById('dispatchStatus');
      box.textContent = 'Đang gửi đơn bay đã duyệt của ' + uavId + ' sang Khối 2 (:8001) và Khối 4 (:8000)...';
      try {
        const res = await fetch('/api/approve-and-dispatch?uav_id=' + encodeURIComponent(uavId), { method: 'POST' });
        const data = await res.json();
        box.textContent = '✔ Đã duyệt & đẩy đơn bay ' + data.flightId + ' (' + uavId + ') sang Khối 2 (:8001) và Khối 4 (:8000)!';
      } catch (e) {
        box.textContent = 'Lỗi gửi đơn bay: ' + e;
      }
    }
    poll();
    setInterval(poll, 1000);
  </script>
</body>
</html>"""


@app.post("/api/approve-and-dispatch")
async def approve_and_dispatch_flight_plan(uav_id: str = "uav-1"):
    from datetime import timedelta
    import uuid

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    if uav_id == "uav-2":
        flight_uuid = "22222222-2222-4222-8222-222222222222"
        drone_uuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        raw_pts = [
            ("Cầu Sông Hàn (Bờ Tây)", 16.0718, 108.2232, 92.0),
            ("Cầu Sông Hàn (Bờ Đông)", 16.0724, 108.2288, 95.0),
            ("Bến Du Thuyền Marina", 16.0762, 108.2302, 90.0),
            ("Trung tâm Hành chính ĐN", 16.0774, 108.2238, 92.0),
        ]
    else:
        flight_uuid = "11111111-1111-4111-8111-111111111111"
        drone_uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        raw_pts = [
            ("Cầu Rồng (Bờ Tây)", 16.0612, 108.2235, 75.0),
            ("Giữa Cầu Rồng", 16.0611, 108.2275, 78.0),
            ("Bờ Đông Sông Hàn", 16.0645, 108.2305, 76.0),
            ("Công viên APEC", 16.0592, 108.2248, 74.0),
        ]

    waypoints = []
    for idx, (name, lat, lon, alt) in enumerate(raw_pts):
        wp_time = (now_dt + timedelta(seconds=idx * 45)).isoformat().replace("+00:00", "Z")
        waypoints.append(
            {
                "name": name,
                "latitude": lat,
                "longitude": lon,
                "altitude": alt,
                "altitudeM": alt,
                "time": wp_time,
            }
        )

    plan_payload = {
        "schemaVersion": "1.0",
        "eventId": str(uuid.uuid4()),
        "eventType": "flightplan.accepted",
        "occurredAt": now_iso,
        "coordinateSystem": {
            "horizontalReference": "WGS84",
            "epsg": 4326,
            "altitudeReference": "AGL",
            "altitudeUnit": "m",
            "timeReference": "UTC",
        },
        "flightPlan": {
            "flightId": flight_uuid,
            "droneId": drone_uuid,
            "serialNumber": uav_id,
            "operatorId": "99999999-9999-4999-8999-999999999999",
            "droneType": "MULTIROTOR",
            "departureName": raw_pts[0][0],
            "destinationName": raw_pts[-1][0],
            "startTime": waypoints[0]["time"],
            "endTime": waypoints[-1]["time"],
            "status": "APPROVED",
            "waypoints": waypoints,
        },
    }

    results = {}
    for target_name, url in [
        ("khoi2_px4_8001", "http://127.0.0.1:8001/api/integration/flight-plans"),
        ("khoi4_monitoring_8000", "http://127.0.0.1:8000/api/integration/flight-plans"),
    ]:
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(plan_payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-UTM-Integration-Key": os.getenv("UTM_MONITORING_TOKEN", "danang-utm-shared-secret-2026"),
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                results[target_name] = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            results[target_name] = {"error": str(exc)}

    return {
        "status": "DISPATCHED_TO_KHOI2_AND_KHOI4",
        "flightId": flight_uuid,
        "droneId": uav_id,
        "results": results,
    }


@app.post("/api/integration/monitoring-updates")
async def receive_progress(payload: Dict[str, Any]):
    entry = record_item("/api/integration/monitoring-updates", payload)
    uav_id = payload.get("droneId") or payload.get("uav_id") or "?"
    pos = payload.get("currentPosition") or {}
    progress = payload.get("routeProgress") or {}
    pct = progress.get("progressPercent", 0)
    leg = progress.get("currentLegLabel", "-")
    alt = pos.get("altitudeM", "?")
    print(f"[Mock Vuong] PROGRESS {uav_id}: {pct}% ({leg}) | Do cao: {alt}m")
    return {
        "status": "ACCEPTED",
        "eventType": "monitoring.progress",
        "receivedAt": entry["receivedAt"],
    }


@app.post("/api/integration/monitoring-decisions")
async def receive_decision(payload: Dict[str, Any]):
    entry = record_item("/api/integration/monitoring-decisions", payload)
    uav_id = payload.get("droneId") or payload.get("uav_id") or "?"
    status = payload.get("decisionStatus", "EXECUTING")
    instr = payload.get("instructionSummary", "-")
    print(f"[Mock Vuong] DECISION [{status}] {uav_id}: {instr}")
    return {
        "status": "ACCEPTED",
        "eventType": "monitoring.decision",
        "receivedAt": entry["receivedAt"],
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    print(f"Starting Mock Vuong Receiver on http://localhost:{port} ...")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
