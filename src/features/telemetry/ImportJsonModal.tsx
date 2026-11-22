import React, { useState } from 'react';
import { useMonitoringStore } from '../../stores/useMonitoringStore';
import { ExternalTelemetryAdapter, PhuocFieldAnalysis } from '../../services/adapters/PhuocTelemetryAdapter';
import { TelemetryValidator } from '../../services/validator/TelemetryValidator';
import { TelemetrySynchronizer } from '../../services/synchronizer/TelemetrySynchronizer';
import { ObservedUAVState } from '../../types/monitoring';
import {
  FileCode,
  X,
  Play,
  Upload,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Eye,
  Info,
  Copy,
  Check,
} from 'lucide-react';

interface ImportJsonModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImportJsonModal: React.FC<ImportJsonModalProps> = ({ isOpen, onClose }) => {
  const { ingestMessage, focusUav } = useMonitoringStore();

  const sampleAstmJson = JSON.stringify(
    {
      messageType: 'UAV_TELEMETRY',
      timestamp: '2026-10-18T14:16:15.274Z',
      simulationTimeSec: 71.2,
      uav: {
        id: 'UAV-01',
        callsign: 'MED-EXPRESS-1',
        type: 'Multirotor',
        position: {
          longitude: 108.238596,
          latitude: 16.067234,
          altitudeAGL_m: 125,
        },
        movement: {
          airSpeed_mps: 18,
          groundSpeed_mps: 18,
          headingDeg: 128.7,
          driftAngleDeg: 0,
        },
        system: {
          batteryPercent: 85,
          flightMode: 'AUTONOMOUS_UTM_CONTROL',
        },
      },
    },
    null,
    2
  );

  const sampleGazeboEnuJson = JSON.stringify(
    {
      messageType: 'UAV_TELEMETRY',
      sequence: 104,
      timestamp: '2026-11-12T10:15:30.000Z',
      simulationTimeSec: 42.5,
      uav: {
        id: 'UAV-GAZEBO-02',
        callsign: 'HAN-SURVEY-2',
        type: 'VTOL',
        position: {
          x: 185.4,
          y: 120.0,
          z: 95.5,
        },
        movement: {
          groundSpeed_mps: 18.2,
          headingDeg: 56.3,
        },
        system: {
          batteryPercent: 91,
          flightMode: 'AUTO_MISSION',
        },
      },
    },
    null,
    2
  );

  const samplePx4FastApiJson = JSON.stringify(
    {
      uav_id: 'uav-1',
      system_id: 1,
      status: {
        connected: true,
        armed: true,
        flight_mode: 'AUTO_HOLD',
        landed_state: 'IN_AIR',
      },
      position: {
        latitude: 16.0544,
        longitude: 108.2022,
        altitude_msl_m: 12.78,
        relative_altitude_m: 2.78,
      },
      local_position: {
        x_m: 0.015,
        y_m: -0.008,
        z_m: -2.78,
      },
      velocity: {
        vx_m_s: 0.05,
        vy_m_s: 0.02,
        vz_m_s: 0.0,
        groundspeed_m_s: 0.05,
        climb_rate_m_s: 0.0,
      },
      attitude: {
        roll_deg: -0.02,
        pitch_deg: 0.01,
        yaw_deg: 90.54,
        heading_deg: 90.0,
      },
      battery: {
        voltage_v: 16.8,
        remaining_percent: 98.5,
      },
      gps: {
        fix_type: 3,
        satellites: 10,
      },
      timestamps: {
        source_timestamp_ms: 138204000,
        backend_timestamp: '2026-11-18T16:19:30.123456Z',
      },
    },
    null,
    2
  );

  const [rawText, setRawText] = useState(sampleAstmJson);
  const [analysis, setAnalysis] = useState<PhuocFieldAnalysis | null>(null);
  const [observedPreview, setObservedPreview] = useState<ObservedUAVState | null>(null);
  const [showObservedJson, setShowObservedJson] = useState(false);
  const [copiedObserved, setCopiedObserved] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgress, setReplayProgress] = useState<string>('');

  if (!isOpen) return null;

  const handleAnalyze = () => {
    setParseError(null);
    setAnalysis(null);
    setObservedPreview(null);
    setShowObservedJson(false);

    const safe = TelemetryValidator.safeJsonParse(rawText);
    if (!safe.isValid || !safe.sanitized) {
      setParseError(safe.errors[0] || 'JSON không hợp lệ');
      return;
    }

    const data = safe.sanitized;
    // Check if it's an array
    const targetObj = Array.isArray(data) ? data[0] : data;

    if (ExternalTelemetryAdapter.isPhuocTelemetry(targetObj)) {
      const result = ExternalTelemetryAdapter.analyzeAndAdapt(targetObj);
      setAnalysis(result);
      if (result.telemetry) {
        const previewSync = new TelemetrySynchronizer();
        const { state } = previewSync.processTelemetry(result.telemetry, undefined, undefined);
        setObservedPreview(state);
      }
    } else {
      // Internal or other format
      const val = TelemetryValidator.validateTelemetry(targetObj);
      setAnalysis({
        receivedFields: Object.keys(targetObj as object).map((k) => `${k}: ${JSON.stringify((targetObj as any)[k])}`),
        inferredFields: [],
        missingFields: val.isValid ? [] : val.errors,
        telemetry: val.sanitized,
        errors: val.isValid ? [] : val.errors,
      });
      if (val.isValid && val.sanitized) {
        const previewSync = new TelemetrySynchronizer();
        const { state } = previewSync.processTelemetry(val.sanitized, undefined, undefined);
        setObservedPreview(state);
      }
    }
  };

  const handleCopyObserved = async () => {
    if (!observedPreview || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(observedPreview, null, 2));
      setCopiedObserved(true);
      setTimeout(() => setCopiedObserved(false), 1800);
    } catch {
      // Clipboard API unavailable in restricted context
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setRawText(content);
      setParseError(null);
      setAnalysis(null);
    };
    reader.readAsText(file);
  };

  const handleInjectToMap = () => {
    setParseError(null);
    const safe = TelemetryValidator.safeJsonParse(rawText);
    if (!safe.isValid || !safe.sanitized) {
      setParseError('Vui lòng kiểm tra lại cú pháp JSON trước khi nạp');
      return;
    }

    const data = safe.sanitized;
    const items = Array.isArray(data) ? data : [data];

    let lastUavId = '';

    for (const item of items) {
      if (ExternalTelemetryAdapter.isPhuocTelemetry(item) || ExternalTelemetryAdapter.isPhuocEnvironment(item)) {
        const adapted = ExternalTelemetryAdapter.adapt(item);
        if (adapted) {
          const adaptedList = Array.isArray(adapted) ? adapted : [adapted];
          for (const msg of adaptedList) {
            ingestMessage(msg);
            if (msg.type === 'uav.telemetry') {
              lastUavId = msg.uav_id;
            }
          }
        }
      } else {
        ingestMessage(item as any);
        if ((item as any).type === 'uav.telemetry') {
          lastUavId = (item as any).uav_id;
        }
      }
    }

    if (lastUavId) {
      setTimeout(() => {
        focusUav(lastUavId);
      }, 200);
    }

    onClose();
  };

  const handleReplayArray = async () => {
    const safe = TelemetryValidator.safeJsonParse(rawText);
    if (!safe.isValid || !safe.sanitized || !Array.isArray(safe.sanitized)) {
      setParseError('Chức năng Replay yêu cầu một mảng JSON các bản tin theo thời gian [ { ... }, { ... } ]');
      return;
    }

    const items = safe.sanitized;
    setIsReplaying(true);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setReplayProgress(`Đang phát lại bản tin ${i + 1}/${items.length}...`);

      if (ExternalTelemetryAdapter.isPhuocTelemetry(item) || ExternalTelemetryAdapter.isPhuocEnvironment(item)) {
        const adapted = ExternalTelemetryAdapter.adapt(item);
        if (adapted) {
          const adaptedList = Array.isArray(adapted) ? adapted : [adapted];
          adaptedList.forEach((m) => ingestMessage(m));
        }
      } else {
        ingestMessage(item as any);
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    setIsReplaying(false);
    setReplayProgress('Phát lại hoàn tất!');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2">
            <FileCode className="w-5 h-5 text-cyan-400" />
            <div>
              <span className="font-bold text-sm font-mono uppercase text-white tracking-wide">
                Nạp & Kiểm tra Telemetry JSON
              </span>
              <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                ASTM F3411 & Gazebo ENU
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 cursor-pointer font-medium transition-all">
                <Upload className="w-3.5 h-3.5" />
                <span>Tải tệp JSON</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => setRawText(sampleAstmJson)}
                className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded border border-slate-800 font-mono text-[11px]"
              >
                Mẫu ASTM F3411 (WGS84)
              </button>

              <button
                onClick={() => setRawText(sampleGazeboEnuJson)}
                className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded border border-slate-800 font-mono text-[11px]"
              >
                Mẫu Gazebo ENU (x, y, z)
              </button>

              <button
                onClick={() => setRawText(samplePx4FastApiJson)}
                className="px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 hover:text-emerald-100 rounded border border-emerald-800/80 font-mono text-[11px]"
              >
                Mẫu PX4 / FastAPI (10Hz)
              </button>
            </div>

            <button
              onClick={handleAnalyze}
              className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium shadow-sm transition-all"
            >
              Kiểm tra & Phân tích cấu trúc
            </button>
          </div>

          {/* JSON Textarea */}
          <div>
            <textarea
              rows={8}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Dán bản tin JSON từ SITL/Gazebo (WGS84 hoặc local x, y, z) hoặc chuẩn UTM v1.0 vào đây..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-slate-200 font-mono text-[11px] leading-relaxed focus:outline-none focus:border-cyan-500 resize-y"
            />
          </div>

          {/* Error notice */}
          {parseError && (
            <div className="p-3 bg-rose-950/40 border border-rose-800 rounded text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Analysis Result Breakdown */}
          {analysis && (
            <div className="space-y-3 bg-slate-950/70 p-3.5 rounded-lg border border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-xs text-white font-mono flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-cyan-400" />
                  BÁO CÁO PHÂN LOẠI TRƯỜNG DỮ LIỆU
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  Định dạng: {ExternalTelemetryAdapter.isPhuocTelemetry(TelemetryValidator.safeJsonParse(rawText).sanitized) ? 'External Simulator (ASTM F3411 / Gazebo ENU)' : 'UTM Internal'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                {/* 1. Received Fields */}
                <div className="bg-emerald-950/20 border border-emerald-800/40 p-2.5 rounded">
                  <span className="font-semibold text-emerald-400 flex items-center gap-1 mb-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Dữ liệu nhận được ({analysis.receivedFields.length})
                  </span>
                  <ul className="space-y-1 text-slate-300 font-mono text-[10px] max-h-40 overflow-y-auto">
                    {analysis.receivedFields.map((f, i) => (
                      <li key={i} className="text-emerald-300/90">• {f}</li>
                    ))}
                  </ul>
                </div>

                {/* 2. Inferred Fields */}
                <div className="bg-cyan-950/20 border border-cyan-800/40 p-2.5 rounded">
                  <span className="font-semibold text-cyan-400 flex items-center gap-1 mb-1.5">
                    <HelpCircle className="w-3.5 h-3.5" />
                    Dữ liệu suy ra ({analysis.inferredFields.length})
                  </span>
                  <ul className="space-y-1 text-slate-300 font-mono text-[10px] max-h-40 overflow-y-auto">
                    {analysis.inferredFields.map((f, i) => (
                      <li key={i} className="text-cyan-300/90">• {f}</li>
                    ))}
                  </ul>
                </div>

                {/* 3. Missing Fields */}
                <div className="bg-amber-950/20 border border-amber-800/40 p-2.5 rounded">
                  <span className="font-semibold text-amber-400 flex items-center gap-1 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Dữ liệu còn thiếu ({analysis.missingFields.length})
                  </span>
                  <ul className="space-y-1 text-slate-300 font-mono text-[10px] max-h-40 overflow-y-auto">
                    {analysis.missingFields.map((f, i) => (
                      <li key={i} className="text-amber-300/90">• {f}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Special Altitude, Plan & ObservedState Output */}
              {analysis.telemetry && (
                <div className="p-2.5 bg-slate-900 border border-slate-800 rounded text-[11px] text-slate-300 space-y-1.5">
                  <div>
                    <strong className="text-cyan-400">Mốc độ cao:</strong> Được nhận diện là{' '}
                    <span className="text-amber-300 font-mono font-bold">
                      {Math.round(analysis.telemetry.position.altitude_m * 10) / 10}m {analysis.telemetry.position.altitude_reference}
                    </span>{' '}
                    ({analysis.telemetry.position.altitude_reference === 'AGL' ? 'Above Ground Level' : 'Mean Sea Level'}). Hệ thống giữ nguyên mốc {analysis.telemetry.position.altitude_reference}, không tự quy đổi.
                  </div>
                  <div>
                    <strong className="text-cyan-400">Kế hoạch bay:</strong>{' '}
                    {analysis.telemetry.flight_plan_id ? (
                      <>
                        Đã liên kết kế hoạch <span className="font-mono text-emerald-300">{analysis.telemetry.flight_plan_id}</span>.
                      </>
                    ) : (
                      <>
                        Bản tin chưa có <span className="font-mono text-slate-400">flight_plan_id</span>. Hệ thống đánh dấu <span className="text-slate-200">Chưa liên kết kế hoạch</span> và không tự đối chiếu kế hoạch giả.
                      </>
                    )}
                  </div>

                  {observedPreview && (
                    <div className="pt-1.5 border-t border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-emerald-400 font-semibold font-mono text-[10px]">
                          ✓ ĐÃ CHUẨN HÓA DỮ LIỆU TELEMETRY THÀNH CÔNG
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setShowObservedJson((prev) => !prev)}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono text-[10px]"
                          >
                            {showObservedJson ? 'Ẩn ObservedState' : 'Xem ObservedState'}
                          </button>
                          <button
                            onClick={handleCopyObserved}
                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-800/80 font-mono text-[10px]"
                          >
                            {copiedObserved ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedObserved ? 'Đã copy' : 'Copy JSON'}</span>
                          </button>
                        </div>
                      </div>
                      {showObservedJson && (
                        <pre className="max-h-44 overflow-auto p-2 bg-slate-950 border border-slate-800 rounded text-[10px] font-mono text-emerald-300/90">
                          {JSON.stringify(observedPreview, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 font-mono">
              Chế độ nạp: <span className="text-purple-400 font-bold">TEST / REPLAY</span>
            </span>
            {replayProgress && (
              <span className="text-cyan-400 text-xs font-mono ml-2 animate-pulse">
                {replayProgress}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReplayArray}
              disabled={isReplaying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all font-medium disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Phát lại Mảng JSON</span>
            </button>

            <button
              onClick={handleInjectToMap}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold shadow-md shadow-cyan-950 transition-all"
            >
              <Eye className="w-4 h-4" />
              <span>Nạp vào bản đồ 3D & Theo dõi</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
