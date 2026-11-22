import React from 'react';
import { useMonitoringStore } from '../../stores/useMonitoringStore';
import { Cpu, Clock } from 'lucide-react';
import { formatUtcTime } from '../../utils/time';

export const BottomBar: React.FC = () => {
  const {
    mode,
    connectionStatus,
    wallClockIso,
    uavStates,
    totalReceivedPackets,
    droppedPacketsCount,
    outOfOrderCount,
    vuongOutboundEnabled,
  } = useMonitoringStore();

  const states = Object.values(uavStates);
  const freshCount = states.filter((u) => u.data_quality.freshness === 'FRESH').length;
  const degradedCount = states.filter((u) => u.data_quality.freshness === 'DEGRADED').length;
  const staleCount = states.filter(
    (u) => u.data_quality.freshness === 'STALE' || u.data_quality.freshness === 'LOST'
  ).length;

  return (
    <footer className="h-8 bg-slate-950/95 border-t border-slate-800 px-4 flex items-center justify-between text-[11px] font-mono text-slate-400 z-20 backdrop-blur-md select-none">
      {/* Left: Clock and status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-cyan-400" />
          <span>WALL UTC: {formatUtcTime(wallClockIso)}</span>
        </div>

        <div className="h-3 w-[1px] bg-slate-800" />

        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">CHẾ ĐỘ:</span>
          <span className={mode === 'LIVE' ? 'text-emerald-400 font-bold' : 'text-cyan-400 font-bold'}>
            {mode}
          </span>
          <span className="text-slate-600">({connectionStatus})</span>
        </div>
      </div>

      {/* Middle: UAV Health Breakdown */}
      <div className="hidden md:flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>Tươi mới: {freshCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span>Suy giảm: {degradedCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          <span>Mất tín hiệu: {staleCount}</span>
        </div>
      </div>

      {/* Right: Telemetry Engine Health & UTM Ops Outbound Status */}
      <div className="flex items-center gap-4">
        <div className="hidden lg:flex items-center gap-2 text-slate-500">
          <span>Gói nhận: {totalReceivedPackets}</span>
          <span>•</span>
          <span>Mất gói: {droppedPacketsCount}</span>
          <span>•</span>
          <span>Sai thứ tự: {outOfOrderCount}</span>
        </div>

        <div className="h-3 w-[1px] bg-slate-800" />

        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1 px-2 py-0.5 rounded border ${
              vuongOutboundEnabled
                ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80'
                : 'text-slate-400 bg-slate-900 border-slate-700'
            }`}
          >
            <Cpu className="w-3 h-3" />
            ĐẦU RA UTM OPS: {vuongOutboundEnabled ? 'ĐANG GỬI (2s/lần)' : 'TẠM DỪNG'}
          </span>
        </div>
      </div>
    </footer>
  );
};
