"""
Mock Vuong UTM Ops Outbound Receiver (HTTP POST Port 8080)
Simulates Vuong's Khối 1 HTTP endpoint receiving progress updates and tactical decisions
from Khối 4/5 (Web 3D Monitoring).

Run:
    python mock_vuong_receiver.py
"""

from collections import deque
from datetime import datetime, timezone
import os
from typing import Any, Dict

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
      <strong style="font-size:16px;color:#fff;">Đầu nhận giả lập phía VƯƠNG (UTM Ops :8080)</strong>
      <div class="meta">Tự động cập nhật mỗi 1 giây • <a href="/api/received" target="_blank">Xem JSON thô (/api/received)</a></div>
    </div>
    <div class="badge" id="counter">Đã nhận: 0 gói tin</div>
  </div>
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
    poll();
    setInterval(poll, 1000);
  </script>
</body>
</html>"""


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
