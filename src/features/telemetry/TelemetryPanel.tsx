import React, { useState } from 'react';
import { useMonitoringStore } from '../../stores/useMonitoringStore';
import {
  Compass,
  ArrowUpRight,
  Shield,
  AlertTriangle,
  FileText,
  CheckCircle2,
  Trash2,
  Layers,
  Gauge,
  Timer,
  Battery,
  HelpCircle,
  Database,
  Send,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { formatCoordinates } from '../../utils/coordinates';
import { formatUtcTime } from '../../utils/time';
import { predictForwardPath } from '../../services/prediction/TrajectoryPredictor';

export const TelemetryPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'TELEMETRY' | 'PROFILE' | 'PROVENANCE' | 'ALERTS'>('TELEMETRY');
  const [vuongExpanded, setVuongExpanded] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [cmdAlt, setCmdAlt] = useState('90');
  const [cmdSpeed, setCmdSpeed] = useState('14');
  const [cmdHeading, setCmdHeading] = useState('90');
  const [cmdFeedback, setCmdFeedback] = useState<string | null>(null);

  const {
    mode,
    wsUrl,
    selectedUavId,
    uavStates,
    flightPlans,
    alerts,
    vuongOutboundUrl,
    vuongOutboundEnabled,
    vuongOutboundLogs,
    setVuongOutboundEnabled,
    clearVuongOutboundLogs,
    acknowledgeAlert,
    clearAlerts,
  } = useMonitoringStore();

  const sendKhoi2Command = async (commandType: string, parameters: Record<string, unknown> = {}) => {
    if (!selectedUavId) return;
    let cmdUrl = 'http://localhost:8001/api/commands';
    try {
      const parsed = new URL(wsUrl);
      const proto = parsed.protocol === 'wss:' ? 'https:' : 'http:';
      cmdUrl = `${proto}//${parsed.host}/api/commands`;
    } catch {
      // fallback default
    }
    try {
      const res = await fetch(cmdUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uav_id: selectedUavId, command_type: commandType, parameters }),
      });
      const data = await res.json();
      if (res.ok && data?.feedback?.message) {
        setCmdFeedback(`✔ ${data.feedback.message}`);
      } else {
        setCmdFeedback(`⚠ Lỗi: ${data?.detail?.feedback?.message || res.statusText}`);
      }
    } catch {
      setCmdFeedback('⚠ Không kết nối được Khối 2 (:8001)');
    }
  };

  const selectedUav = selectedUavId ? uavStates[selectedUavId] : null;
  const plan = selectedUav && selectedUav.flight_plan_id ? flightPlans[selectedUav.flight_plan_id] : null;
  const profile = selectedUav?.uav_profile || plan?.uav_profile;
  const forwardPred = selectedUav ? predictForwardPath(selectedUav, plan || undefined, 12, 2) : null;
  const predTarget =
    forwardPred && forwardPred.points.length > 1
      ? forwardPred.points[forwardPred.points.length - 1]
      : null;
  const unreadAlertsCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="w-72 xl:w-88 shrink-0 h-full bg-slate-950/95 border-l border-slate-800 flex flex-col z-10 backdrop-blur-md select-none">
      {/* Tabs Switcher */}
      <div className="flex border-b border-slate-800 bg-slate-900/60 p-1 gap-1">
        <button
          onClick={() => setActiveTab('TELEMETRY')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all text-center ${
            activeTab === 'TELEMETRY'
              ? 'bg-slate-800 text-cyan-400 border border-slate-700/80 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Telemetry
        </button>
        <button
          onClick={() => setActiveTab('PROFILE')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all text-center ${
            activeTab === 'PROFILE'
              ? 'bg-slate-800 text-purple-400 border border-slate-700/80 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Cấu hình
        </button>
        <button
          onClick={() => setActiveTab('PROVENANCE')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all text-center ${
            activeTab === 'PROVENANCE'
              ? 'bg-slate-800 text-emerald-400 border border-slate-700/80 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Nguồn tin
        </button>
        <button
          onClick={() => setActiveTab('ALERTS')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all text-center flex items-center justify-center gap-1 ${
            activeTab === 'ALERTS'
              ? 'bg-slate-800 text-rose-400 border border-slate-700/80 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Cảnh báo</span>
          {unreadAlertsCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center font-mono">
              {unreadAlertsCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === 'TELEMETRY' ? (
          !selectedUav ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <Compass className="w-8 h-8 mb-2 text-slate-600" />
              <p className="text-xs">Chưa chọn UAV nào</p>
              <p className="text-[11px] text-slate-600 mt-1">
                Nhấp vào một UAV trên bản đồ 3D hoặc từ danh sách bên trái để kiểm tra dữ liệu đo xa
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              {/* Header Box */}
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold text-sm text-cyan-300">
                      {selectedUav.uav_id}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {profile && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800">
                        {profile.uav_type}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                      {selectedUav.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5 font-mono pt-1 border-t border-slate-800/80">
                  <div>
                    Kế hoạch:{' '}
                    {selectedUav.flight_plan_id ? (
                      <span className="text-slate-200">{selectedUav.flight_plan_id}</span>
                    ) : (
                      <span className="text-amber-400/90 italic">Chưa liên kết</span>
                    )}
                  </div>
                  {selectedUav.battery_pct !== undefined && (
                    <div className="flex items-center gap-1 text-emerald-400">
                      <Battery className="w-3.5 h-3.5" />
                      <span>{selectedUav.battery_pct}%</span>
                    </div>
                  )}
                </div>

                {selectedUav.flight_mode && (
                  <div className="text-[10px] text-slate-400 font-mono mt-1">
                    Chế độ bay:{' '}
                    <span className="text-cyan-400">{selectedUav.flight_mode}</span>
                  </div>
                )}
              </div>

              {/* Direct UAV Flight Controls -> Khoi 2 PX4 SITL */}
              {mode === 'LIVE' && (
                <div className="bg-slate-900/80 border border-cyan-900/70 p-2.5 rounded-lg space-y-2">
                  <div className="text-[10px] uppercase font-bold text-cyan-300 flex items-center justify-between">
                    <span>🎮 Điều khiển trực tiếp ({selectedUav.uav_id})</span>
                    <span className="text-[9px] font-mono text-slate-400">➔ Khối 2 PX4</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-[10.5px] font-semibold">
                    <button
                      onClick={() => void sendKhoi2Command('TAKEOFF')}
                      className="py-1 px-1.5 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white"
                    >
                      Cất cánh
                    </button>
                    <button
                      onClick={() => void sendKhoi2Command('RESUME_MISSION')}
                      className="py-1 px-1.5 rounded bg-cyan-700/80 hover:bg-cyan-600 text-white"
                    >
                      Bay tuyến
                    </button>
                    <button
                      onClick={() => void sendKhoi2Command('HOLD_POSITION')}
                      className="py-1 px-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
                    >
                      Giữ chỗ
                    </button>
                    <button
                      onClick={() => void sendKhoi2Command('RTL')}
                      className="py-1 px-1.5 rounded bg-indigo-700/80 hover:bg-indigo-600 text-white"
                    >
                      Về RTL
                    </button>
                    <button
                      onClick={() => void sendKhoi2Command('LAND')}
                      className="col-span-2 py-1 px-1.5 rounded bg-amber-700/80 hover:bg-amber-600 text-white"
                    >
                      Hạ cánh (0m)
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={cmdAlt}
                        onChange={(e) => setCmdAlt(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-slate-200 font-mono"
                        title="Độ cao (m)"
                      />
                      <button
                        onClick={() =>
                          void sendKhoi2Command('CHANGE_ALTITUDE', { target_altitude_m: Number(cmdAlt) })
                        }
                        className="px-1.5 rounded bg-purple-700 hover:bg-purple-600 text-white font-semibold shrink-0"
                      >
                        Cao
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={cmdSpeed}
                        onChange={(e) => setCmdSpeed(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-slate-200 font-mono"
                        title="Tốc độ (m/s)"
                      />
                      <button
                        onClick={() =>
                          void sendKhoi2Command('CHANGE_SPEED', { target_speed_mps: Number(cmdSpeed) })
                        }
                        className="px-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-semibold shrink-0"
                      >
                        Tốc độ
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={cmdHeading}
                        onChange={(e) => setCmdHeading(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-slate-200 font-mono"
                        title="Hướng (°)"
                      />
                      <button
                        onClick={() =>
                          void sendKhoi2Command('CHANGE_HEADING', { target_heading_deg: Number(cmdHeading) })
                        }
                        className="px-1.5 rounded bg-teal-700 hover:bg-teal-600 text-white font-semibold shrink-0"
                      >
                        Hướng
                      </button>
                    </div>
                  </div>
                  {cmdFeedback && (
                    <div className="text-[10px] font-mono text-emerald-300 bg-slate-950/70 px-2 py-1 rounded border border-slate-800">
                      {cmdFeedback}
                    </div>
                  )}
                </div>
              )}

              {/* Position & Altitude (Strictly preserves AGL or MSL) */}
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <Compass className="w-3.5 h-3.5 text-cyan-400" />
                  Vị trí quan sát thực tế (WGS84)
                </div>
                <div className="space-y-1.5 font-mono">
                  <div className="flex justify-between text-slate-300 text-[11px]">
                    <span className="text-slate-500">Kinh/Vĩ độ:</span>
                    <span className="text-slate-200 font-semibold">
                      {formatCoordinates(selectedUav.position.latitude, selectedUav.position.longitude)}
                    </span>
                  </div>

                  <div className="flex justify-between text-slate-300 text-[11px] items-center">
                    <span className="text-slate-500">
                      Độ cao ({selectedUav.position.altitude_reference}):
                    </span>
                    <span className="text-cyan-300 font-bold text-xs">
                      {Math.round(selectedUav.position.altitude_m * 10) / 10} m{' '}
                      <span className="text-[10px] text-amber-400 px-1 py-0.2 rounded bg-amber-950/60 border border-amber-800/80">
                        {selectedUav.position.altitude_reference}
                      </span>
                    </span>
                  </div>

                  {selectedUav.position.altitude_reference === 'AGL' && (
                    <div className="text-[10px] text-amber-300/90 bg-amber-950/30 p-1.5 rounded border border-amber-800/50 leading-relaxed">
                      <strong>Mốc AGL:</strong> Độ cao cách mặt đất tại vị trí UAV (theo nguồn mô phỏng). Hệ thống giữ nguyên mốc AGL, không đánh đồng sang MSL.
                    </div>
                  )}

                  <div className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-800/80">
                    * Tọa độ vật lý gốc nhận trực tiếp từ luồng telemetry
                  </div>
                </div>
              </div>

              {/* Velocity & Dynamics */}
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
                  Động học bay
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">TỐC ĐỘ MẶT ĐẤT</span>
                    <span className="text-slate-200 font-semibold">
                      {Math.round(selectedUav.velocity.ground_speed_mps * 10) / 10} m/s
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      ({Math.round(selectedUav.velocity.ground_speed_mps * 3.6)} km/h)
                    </span>
                    {selectedUav.velocity.air_speed_mps !== undefined && (
                      <span className="text-[10px] text-cyan-400/90 block mt-0.5">
                        Air: {selectedUav.velocity.air_speed_mps} m/s
                      </span>
                    )}
                  </div>
                  <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">HƯỚNG BAY</span>
                    <span className="text-slate-200 font-semibold">
                      {Math.round(selectedUav.velocity.heading_deg * 10) / 10}°
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      Leo/hạ:{' '}
                      {selectedUav.velocity.vertical_speed_mps !== undefined ? (
                        `${selectedUav.velocity.vertical_speed_mps > 0 ? '+' : ''}${selectedUav.velocity.vertical_speed_mps} m/s`
                      ) : (
                        <span className="text-slate-500 italic">N/A (Chưa đo)</span>
                      )}
                    </span>
                    {selectedUav.velocity.drift_angle_deg !== undefined && (
                      <span className="text-[10px] text-slate-400 block">
                        Dạt: {selectedUav.velocity.drift_angle_deg}°
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Forward 12s Prediction Summary ("- - - -") */}
              <div className="bg-slate-900/80 border border-amber-800/60 p-2.5 rounded-lg">
                <div className="text-[10px] uppercase font-bold text-amber-300 mb-1.5 flex items-center justify-between">
                  <span>Dự đoán 12s tới (- - - -)</span>
                  <span className="font-mono text-[10px] text-slate-400">
                    Bù trễ: {forwardPred?.latencyCompensatedSec ?? 0}s ({Math.round(selectedUav.data_quality.latency_ms || 0)}ms)
                  </span>
                </div>
                {predTarget ? (
                  <div className="space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-500">Tọa độ 12s tới:</span>
                      <span className="text-amber-300 font-semibold">
                        {formatCoordinates(predTarget.latitude, predTarget.longitude)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-500">Độ cao dự kiến:</span>
                      <span className="text-amber-200 font-semibold">
                        {Math.round(predTarget.altitude_m)} m {selectedUav.position.altitude_reference}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-500 italic">
                    Tạm dừng ngoại suy (tín hiệu trễ hoặc UAV đứng yên chưa có tuyến)
                  </div>
                )}
              </div>

              {/* 4D Strategic Plan Comparison or Unlinked Notice */}
              {selectedUav.plan_deviation ? (
                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <div className="text-[10px] uppercase font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-cyan-400" />
                    Đối chiếu Kế hoạch bay 4D
                  </div>

                  <div className="space-y-1.5 font-mono text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Lệch ngang (Cross-track):</span>
                      <span
                        className={`font-bold ${
                          selectedUav.plan_deviation.within_spatial_corridor
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {selectedUav.plan_deviation.cross_track_error_m} m
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Lệch độ cao:</span>
                      <span className="text-slate-300">
                        {selectedUav.plan_deviation.vertical_deviation_m} m
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Sai lệch thời gian 4D:</span>
                      <span
                        className={`font-semibold ${
                          selectedUav.plan_deviation.within_time_corridor
                            ? 'text-cyan-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {selectedUav.plan_deviation.time_deviation_s === 0
                          ? 'Đúng giờ'
                          : selectedUav.plan_deviation.time_deviation_s > 0
                          ? `Chậm ${selectedUav.plan_deviation.time_deviation_s}s`
                          : `Sớm ${Math.abs(selectedUav.plan_deviation.time_deviation_s)}s`}
                      </span>
                    </div>

                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          selectedUav.plan_deviation.within_corridor
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            (selectedUav.plan_deviation.cross_track_error_m / (plan?.corridor_width_m || 40)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900/60 border border-slate-800/80 p-2.5 rounded-lg text-slate-400 font-mono text-[11px] space-y-1">
                  <div className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-slate-500" />
                    Đối chiếu Kế hoạch bay 4D
                  </div>
                  <p className="text-slate-400 text-[10px]">
                    Phương tiện chưa liên kết kế hoạch bay. Hệ thống giữ nguyên trạng thái quan sát thực tế và <strong>không tự đối chiếu kế hoạch giả mạo</strong>.
                  </p>
                </div>
              )}

              {/* Timing References & Sequence Provenance */}
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <Timer className="w-3.5 h-3.5 text-cyan-400" />
                  Mốc Thời gian & Số thứ tự bản tin
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Sim Time:</span>
                    <span className="text-cyan-300">
                      {formatUtcTime(selectedUav.data_quality.sim_time_utc)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Bản tin tạo lúc:</span>
                    <span className="text-slate-300">
                      {formatUtcTime(selectedUav.data_quality.message_created_at_utc)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Thời điểm nhận:</span>
                    <span className="text-slate-300">
                      {formatUtcTime(selectedUav.data_quality.received_at_wall_clock_utc)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Độ mới (Age):</span>
                    <span className="text-emerald-400 font-bold">
                      {selectedUav.data_quality.freshness_age_ms} ms
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-800">
                    <span className="text-slate-500">Thứ tự gói tin:</span>
                    <span className="text-slate-300">
                      {selectedUav.is_inferred_sequence ? (
                        <span className="text-cyan-400">
                          #{selectedUav.data_quality.last_sequence} (receive_sequence nội bộ)
                        </span>
                      ) : (
                        `#${selectedUav.data_quality.last_sequence} (nguồn)`
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Độ tin cậy dữ liệu:</span>
                    <span
                      className={`font-bold ${
                        selectedUav.data_quality.confidence === 'HIGH'
                          ? 'text-cyan-400'
                          : selectedUav.data_quality.confidence === 'MEDIUM'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {selectedUav.data_quality.confidence}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        ) : activeTab === 'PROFILE' ? (
          /* Profile Tab */
          !profile ? (
            <div className="p-6 text-center text-slate-500 text-xs">
              Phương tiện chưa được gán hồ sơ hiệu năng kỹ thuật
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                <span className="text-[10px] text-purple-400 font-bold font-mono uppercase block mb-1">
                  LOẠI PHƯƠNG TIỆN BAY
                </span>
                <span className="text-sm font-bold text-white block">
                  {profile.model_name}
                </span>
                <span className="text-[11px] text-slate-400">
                  Nhà sản xuất: {profile.manufacturer || 'Nguồn mô phỏng ngoài'}
                </span>
              </div>

              {/* Physical Dimensions & Weight */}
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  Kích thước & Khối lượng
                </div>
                <div className="space-y-1 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Dài x Rộng x Cao:</span>
                    <span className="text-slate-200">
                      {profile.dimensions_m.length}m × {profile.dimensions_m.wingspan_or_diameter}m × {profile.dimensions_m.height}m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Khối lượng MTOW:</span>
                    <span className="text-purple-300 font-bold">
                      {profile.mtow_kg} kg
                    </span>
                  </div>
                </div>
              </div>

              {/* Flight Performance & Limits */}
              <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5 text-purple-400" />
                  Giới hạn Khai thác & Cơ động
                </div>
                <div className="space-y-1 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tốc độ tối đa:</span>
                    <span className="text-slate-200">
                      {profile.max_ground_speed_mps} m/s ({Math.round(profile.max_ground_speed_mps * 3.6)} km/h)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tốc độ hành trình:</span>
                    <span className="text-slate-200">
                      {profile.cruise_speed_mps} m/s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Leo cao tối đa:</span>
                    <span className="text-slate-200">
                      {profile.max_climb_rate_mps} m/s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Thời gian bay tối đa:</span>
                    <span className="text-emerald-400 font-bold">
                      {profile.max_flight_time_min} phút
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        ) : activeTab === 'PROVENANCE' ? (
          /* Provenance & Field Segregation Tab */
          !selectedUav ? (
            <div className="p-6 text-center text-slate-500 text-xs">
              Chưa chọn phương tiện
            </div>
          ) : (
            <div className="space-y-3 text-xs font-mono">
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg">
                <span className="text-xs font-bold text-white flex items-center gap-1.5 mb-1">
                  <Database className="w-4 h-4 text-cyan-400" />
                  PHÂN LOẠI TRƯỜNG DỮ LIỆU CỦA NGUỒN
                </span>
                <p className="text-[10px] text-slate-400 font-sans leading-relaxed">
                  Định dạng bản tin: <strong className="text-cyan-300">{selectedUav.data_source_format || 'INTERNAL_V1'}</strong>
                </p>
              </div>

              {/* 3 Categories Breakdown */}
              <div className="space-y-2">
                <div className="bg-emerald-950/20 border border-emerald-800/50 p-2.5 rounded">
                  <span className="font-semibold text-emerald-400 flex items-center gap-1 mb-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Dữ liệu nhận được thực tế
                  </span>
                  <ul className="text-[10px] text-slate-300 space-y-0.5">
                    <li>• uav_id: "{selectedUav.uav_id}"</li>
                    {selectedUav.callsign && <li>• callsign: "{selectedUav.callsign}"</li>}
                    <li>• latitude: {selectedUav.position.latitude}</li>
                    <li>• longitude: {selectedUav.position.longitude}</li>
                    <li>• altitude: {selectedUav.position.altitude_m}m ({selectedUav.position.altitude_reference})</li>
                    <li>• ground_speed: {selectedUav.velocity.ground_speed_mps} m/s</li>
                    <li>• heading: {selectedUav.velocity.heading_deg}°</li>
                    {selectedUav.battery_pct !== undefined && <li>• batteryPercent: {selectedUav.battery_pct}%</li>}
                    {selectedUav.flight_mode && <li>• flightMode: "{selectedUav.flight_mode}"</li>}
                  </ul>
                </div>

                <div className="bg-cyan-950/20 border border-cyan-800/50 p-2.5 rounded">
                  <span className="font-semibold text-cyan-400 flex items-center gap-1 mb-1">
                    <HelpCircle className="w-3.5 h-3.5" />
                    Dữ liệu chuẩn hóa nội bộ (UTM)
                  </span>
                  <ul className="text-[10px] text-slate-300 space-y-0.5">
                    {selectedUav.is_inferred_sequence && (
                      <li>• receive_sequence: #{selectedUav.data_quality.last_sequence} (tự tăng)</li>
                    )}
                    <li>• status: "{selectedUav.status}" (suy từ flightMode / speed)</li>
                    <li>• uav_profile: {profile?.uav_type} (mặc định theo loại)</li>
                  </ul>
                </div>

                <div className="bg-amber-950/20 border border-amber-800/50 p-2.5 rounded">
                  <span className="font-semibold text-amber-400 flex items-center gap-1 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Trường nguồn mô phỏng còn thiếu
                  </span>
                  <ul className="text-[10px] text-amber-300/90 space-y-0.5">
                    {selectedUav.is_inferred_sequence && (
                      <li>• sequence: Chưa có số thứ tự nguồn (source sequence)</li>
                    )}
                    {selectedUav.is_unlinked_plan && (
                      <li>• flight_plan_id: Chưa liên kết kế hoạch bay 4D</li>
                    )}
                    {selectedUav.velocity.vertical_speed_mps === undefined && (
                      <li>• vertical_speed_mps: Chưa có vận tốc leo/hạ</li>
                    )}
                    {selectedUav.position.altitude_reference === 'AGL' && (
                      <li>• altitudeMSL_m: Chưa có độ cao mốc nước biển MSL</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )
        ) : (
          /* Alerts Tab */
          <div className="space-y-2">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[11px] text-slate-400">
                Tổng cộng {alerts.length} bản tin cảnh báo
              </span>
              {alerts.length > 0 && (
                <button
                  onClick={clearAlerts}
                  className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Xóa tất cả
                </button>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                Không có cảnh báo nào trong không phận
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.alert_id}
                  className={`p-2.5 rounded-lg border text-xs transition-all ${
                    alert.severity === 'CRITICAL'
                      ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
                      : alert.severity === 'WARNING'
                      ? 'bg-amber-950/30 border-amber-800/80 text-amber-200'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  } ${alert.acknowledged ? 'opacity-50' : 'opacity-100'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-[11px] font-mono flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {alert.title}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-mono uppercase bg-slate-950/80">
                      {alert.source}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 mb-2 leading-relaxed">
                    {alert.description}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-800/60 pt-1.5 font-mono">
                    <span>{formatUtcTime(alert.timestamp)}</span>
                    {!alert.acknowledged && (
                      <button
                        onClick={() => acknowledgeAlert(alert.alert_id)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        Xác nhận
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Compact Collapsible Vuong Outbound Card */}
      <div className="border-t border-slate-800 bg-slate-950 text-xs">
        <div className="px-3 py-2 flex items-center justify-between gap-2 bg-slate-900/70">
          <button
            onClick={() => setVuongExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-left font-semibold text-slate-200 hover:text-white min-w-0"
          >
            <Send className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">Đầu ra gửi về Vương</span>
            <span className="px-1.5 py-0.2 rounded bg-slate-800 text-cyan-300 font-mono text-[10px]">
              {vuongOutboundLogs.length}
            </span>
            {vuongExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
          </button>

          <button
            onClick={() => setVuongOutboundEnabled(!vuongOutboundEnabled)}
            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border transition-colors shrink-0 ${
              vuongOutboundEnabled
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            {vuongOutboundEnabled ? 'BẬT' : 'TẮT'}
          </button>
        </div>

        {vuongExpanded && (
          <div className="p-2.5 space-y-2 max-h-64 overflow-y-auto border-t border-slate-800/80">
            <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
              <span className="truncate" title={vuongOutboundUrl}>
                POST {vuongOutboundUrl}
              </span>
              {vuongOutboundLogs.length > 0 && (
                <button
                  onClick={clearVuongOutboundLogs}
                  className="text-slate-500 hover:text-rose-400 shrink-0 flex items-center gap-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                  Xóa
                </button>
              )}
            </div>

            {vuongOutboundLogs.length === 0 ? (
              <div className="py-3 text-center text-[11px] text-slate-500">
                {vuongOutboundEnabled
                  ? 'Đang chờ nhịp gửi kế tiếp (2s/lần)...'
                  : 'Bật nút BẬT ở trên để gửi tiến độ & quyết định về Vương'}
              </div>
            ) : (
              <div className="space-y-1.5">
                {vuongOutboundLogs.slice(0, 6).map((log) => {
                  const isOpen = expandedLogId === log.id;
                  return (
                    <div
                      key={log.id}
                      className="rounded border border-slate-800 bg-slate-900/70 p-2 text-[10px]"
                    >
                      <button
                        onClick={() => setExpandedLogId(isOpen ? null : log.id)}
                        className="w-full text-left flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-semibold text-slate-200 truncate">
                            {log.uavId} ·{' '}
                            <span
                              className={
                                log.eventType === 'monitoring.decision'
                                  ? 'text-amber-300'
                                  : 'text-cyan-300'
                              }
                            >
                              {log.eventType}
                            </span>
                          </div>
                          <div className="text-slate-400 truncate mt-0.5">{log.summary}</div>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded font-mono shrink-0 ${
                            log.status === 'SENT'
                              ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/60'
                              : 'bg-rose-950/90 text-rose-300 border border-rose-700/60'
                          }`}
                        >
                          {log.status === 'SENT'
                            ? `${log.httpStatus ?? 200} OK`
                            : log.errorMessage || 'Lỗi kết nối'}
                        </span>
                      </button>

                      {isOpen && (
                        <pre className="mt-2 p-2 rounded bg-slate-950 border border-slate-800 text-[9px] font-mono text-slate-300 overflow-x-auto max-h-36">
                          {JSON.stringify(log.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
