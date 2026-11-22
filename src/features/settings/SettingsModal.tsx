import React, { useState } from 'react';
import { useMonitoringStore } from '../../stores/useMonitoringStore';
import { X, Globe, Wifi, Key, Save, AlertCircle, Radio } from 'lucide-react';

export const SettingsModal: React.FC = () => {
  const settingsModalOpen = useMonitoringStore((state) => state.settingsModalOpen);
  if (!settingsModalOpen) return null;
  return <SettingsModalContent />;
};

const SettingsModalContent: React.FC = () => {
  const {
    wsUrl,
    opsWsUrl,
    cesiumIonToken,
    telemetryProtocol,
    setSettingsModalOpen,
    setWsUrl,
    setOpsWsUrl,
    setCesiumIonToken,
    setTelemetryProtocol,
    setMode,
  } = useMonitoringStore();

  const [inputWsUrl, setInputWsUrl] = useState(wsUrl);
  const [inputOpsWsUrl, setInputOpsWsUrl] = useState(opsWsUrl);
  const [inputToken, setInputToken] = useState(cesiumIonToken);

  const handleSave = () => {
    setWsUrl(inputWsUrl.trim() || 'ws://localhost:8000/ws/telemetry');
    setOpsWsUrl(inputOpsWsUrl.trim() || 'ws://localhost:8000/ws/flight-plans');
    setCesiumIonToken(inputToken);
    setSettingsModalOpen(false);
  };

  const handleSaveAndConnect = () => {
    setWsUrl(inputWsUrl.trim() || 'ws://localhost:8000/ws/telemetry');
    setOpsWsUrl(inputOpsWsUrl.trim() || 'ws://localhost:8000/ws/flight-plans');
    setCesiumIonToken(inputToken);
    setMode('LIVE');
    setSettingsModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-cyan-400" />
            <span className="font-bold text-sm tracking-wide font-mono uppercase text-white">
              Cấu hình UTM Monitoring System
            </span>
          </div>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs max-h-[65vh] overflow-y-auto">
          {/* WebSocket Settings */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Wifi className="w-4 h-4 text-cyan-400" />
              Địa chỉ WebSocket Telemetry (SITL / Gazebo / Simulator)
            </label>
            <input
              type="text"
              value={inputWsUrl}
              onChange={(e) => setInputWsUrl(e.target.value)}
              placeholder="ws://localhost:8000/ws/telemetry"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-500">
              Nhập URL WebSocket nguồn phát mô phỏng trong mạng LAN hoặc localhost (vd: ws://localhost:8000/ws/telemetry cho PX4/FastAPI 10Hz, hoặc ws://192.168.1.x:8000/ws/telemetry). Tự động nhận chuẩn PX4 phẳng, ASTM F3411 và Gazebo ENU (x, y, z).
            </p>
          </div>

          {/* Telemetry Protocol Format */}
          <div className="space-y-1.5">
            <label htmlFor="ops-ws-url" className="font-semibold text-slate-300">Kế hoạch bay từ UTM Ops</label>
            <input id="ops-ws-url" type="text" value={inputOpsWsUrl}
              onChange={(e) => setInputOpsWsUrl(e.target.value)}
              placeholder="ws://localhost:8000/ws/flight-plans"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono" />
            <p className="text-[11px] text-slate-500">
              Kết nối ở chế độ LIVE để nhận lộ trình đã duyệt. Vị trí UAV lấy từ nguồn telemetry ở trên.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-cyan-400" />
              Định dạng bản tin đầu vào (Input Telemetry Protocol)
            </label>
            <div className="grid grid-cols-1 gap-1.5 bg-slate-950 p-2 rounded-lg border border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                <input
                  type="radio"
                  name="protocol"
                  checked={telemetryProtocol === 'AUTO_DETECT'}
                  onChange={() => setTelemetryProtocol('AUTO_DETECT')}
                  className="text-cyan-500 focus:ring-0"
                />
                <div>
                  <span className="font-semibold">Tự động nhận diện (Khuyên dùng)</span>
                  <span className="block text-[10px] text-slate-500">
                    Tự động chuẩn hóa cả ASTM F3411, Gazebo local ENU (x, y, z) lẫn chuẩn nội bộ UTM v1.0
                  </span>
                </div>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                <input
                  type="radio"
                  name="protocol"
                  checked={telemetryProtocol === 'PHUOC_SIMULATOR'}
                  onChange={() => setTelemetryProtocol('PHUOC_SIMULATOR')}
                  className="text-cyan-500 focus:ring-0"
                />
                <div>
                  <span className="font-semibold">Nguồn mô phỏng ngoài (ASTM F3411 / Gazebo ENU)</span>
                  <span className="block text-[10px] text-slate-500">
                    Sử dụng trực tiếp ExternalTelemetryAdapter để chuyển đổi gói tin mô phỏng sang UTM
                  </span>
                </div>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                <input
                  type="radio"
                  name="protocol"
                  checked={telemetryProtocol === 'INTERNAL_V1'}
                  onChange={() => setTelemetryProtocol('INTERNAL_V1')}
                  className="text-cyan-500 focus:ring-0"
                />
                <div>
                  <span className="font-semibold">Chuẩn nội bộ UTM Monitoring v1.0</span>
                  <span className="block text-[10px] text-slate-500">
                    Bản tin uav.telemetry chuẩn hóa có sequence, altitude và flight_plan_id
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Cesium Ion Token Settings */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Key className="w-4 h-4 text-amber-400" />
              Cesium Ion Access Token (Tùy chọn)
            </label>
            <textarea
              rows={3}
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              placeholder="Nhập Cesium Ion Token (nếu có)..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
            />
            <div className="flex items-start gap-1.5 text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded border border-slate-800">
              <AlertCircle className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <span>
                <strong>Chế độ dự phòng:</strong> Hệ thống đã được thiết kế hoạt động hoàn toàn độc lập với OpenStreetMap / CartoDB Dark Matter tiles. Nếu không có token, bản đồ 3D vẫn hiển thị đầy đủ và mượt mà.
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-slate-800 bg-slate-950/50">
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Hủy bỏ
          </button>
          <button
            onClick={handleSaveAndConnect}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all"
          >
            <Radio className="w-4 h-4" />
            Lưu & Kết nối WS
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold transition-all shadow-md shadow-cyan-500/20"
          >
            <Save className="w-4 h-4" />
            Lưu thay đổi
          </button>
        </div>
      </div>
    </div>
  );
};
