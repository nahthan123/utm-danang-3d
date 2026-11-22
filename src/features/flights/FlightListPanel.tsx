import React from 'react';
import { useMonitoringStore } from '../../stores/useMonitoringStore';
import { Search, Plane, AlertTriangle, Eye, Activity, Signal, Navigation2 } from 'lucide-react';

export const FlightListPanel: React.FC = () => {
  const {
    uavStates,
    flightPlans,
    mode,
    opsConnectionStatus,
    selectedUavId,
    searchQuery,
    statusFilter,
    selectUav,
    focusUav,
    setSearchQuery,
    setStatusFilter,
  } = useMonitoringStore();

  const allUavs = Object.values(uavStates);
  const opsPlans = Object.values(flightPlans).filter((plan) => plan.source === 'UTM_OPS');
  const planLabels = { SCHEDULED: 'Đã duyệt', ACTIVE: 'Đang thực hiện', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' };

  // Filter UAVs based on search and status
  const filteredUavs = allUavs.filter((uav) => {
    const matchesSearch =
      uav.uav_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (uav.callsign ? uav.callsign.toLowerCase().includes(searchQuery.toLowerCase()) : false) ||
      (uav.flight_plan_id ? uav.flight_plan_id.toLowerCase().includes(searchQuery.toLowerCase()) : false);

    if (!matchesSearch) return false;

    if (statusFilter === 'FLYING') {
      return uav.status === 'FLYING';
    }
    if (statusFilter === 'ALERT') {
      const hasDeviation = uav.plan_deviation && !uav.plan_deviation.within_corridor;
      return hasDeviation || uav.data_quality.freshness === 'STALE';
    }
    if (statusFilter === 'STALE') {
      return uav.data_quality.freshness === 'STALE' || uav.data_quality.freshness === 'LOST';
    }

    return true;
  });

  return (
    <div className="w-64 xl:w-80 shrink-0 h-full bg-slate-950/95 border-r border-slate-800 flex flex-col z-10 backdrop-blur-md select-none">
      {/* Header */}
      <div className="p-3 border-b border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
            <Plane className="w-3.5 h-3.5 text-cyan-400" />
            Danh sách Chuyến bay
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-400 font-mono">
            {filteredUavs.length}/{allUavs.length}
          </span>
        </div>

        {/* Search input */}
        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Tìm theo mã UAV / Kế hoạch..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-xs bg-slate-900 border border-slate-700/80 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-all font-mono"
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-4 gap-1 text-[11px]">
          {(['ALL', 'FLYING', 'ALERT', 'STALE'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`py-1 rounded font-medium transition-all text-center ${
                statusFilter === filter
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {filter === 'ALL'
                ? 'Tất cả'
                : filter === 'FLYING'
                ? 'Đang bay'
                : filter === 'ALERT'
                ? 'Cảnh báo'
                : 'Mất tín'}
            </button>
          ))}
        </div>
      </div>

      {/* Flight Cards List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {mode === 'LIVE' && (
          <section className="p-2 rounded border border-slate-800 bg-slate-900/70 text-xs text-slate-300">
            <div className="font-semibold mb-2">Kế hoạch UTM Ops · {opsPlans.length}</div>
            <p className="text-[11px] text-slate-400 mb-2">
              {opsConnectionStatus === 'CONNECTED' ? 'Đã kết nối' : 'Chưa kết nối UTM Ops'}
            </p>
            {opsPlans.map((plan) => (
              <button key={plan.plan_id} className="block w-full text-left border-t border-slate-800 py-2"
                onClick={() => {
                  const point = plan.waypoints[0];
                  if (point) useMonitoringStore.setState({ cameraTarget: {
                    latitude: point.latitude, longitude: point.longitude,
                    altitude_m: Math.max(point.altitude_m + 300, 500), timestamp: Date.now(),
                  } });
                }}>
                <span className="block font-mono text-cyan-300">{plan.callsign} · {planLabels[plan.status]}</span>
                <span className="block text-[11px] text-slate-400">{plan.departure_name || 'Điểm đi'} → {plan.destination_name || 'Điểm đến'}</span>
                <span className="block text-[11px] text-slate-500">
                  {new Date(plan.departure_time_utc).toLocaleString('vi-VN')} · {plan.altitude_reference}
                </span>
                {!Object.values(uavStates).some((uav) => uav.flight_plan_id === plan.plan_id) && (
                  <span className="text-[11px] text-amber-300">Chưa có telemetry liên kết</span>
                )}
              </button>
            ))}
          </section>
        )}
        {filteredUavs.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">
            Không tìm thấy phương tiện bay nào phù hợp
          </div>
        ) : (
          filteredUavs.map((uav) => {
            const isSelected = selectedUavId === uav.uav_id;
            const hasDeviation = uav.plan_deviation && !uav.plan_deviation.within_corridor;
            const freshness = uav.data_quality.freshness;

            return (
              <div
                key={uav.uav_id}
                onClick={() => selectUav(uav.uav_id)}
                className={`p-2.5 rounded-lg border transition-all cursor-pointer relative ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500/70 shadow-lg shadow-cyan-950/50'
                    : 'bg-slate-900/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                {/* Header of Card */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono font-bold text-xs text-white tracking-wide">
                      {uav.uav_id}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {uav.flight_plan_id ? (
                        `(${uav.flight_plan_id})`
                      ) : (
                        <span className="text-amber-400/90 bg-amber-950/60 px-1 py-0.2 rounded border border-amber-800/60">
                          Chưa liên kết kế hoạch
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Freshness Badge */}
                  <div className="flex items-center gap-1">
                    {freshness === 'FRESH' && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/70 px-1.5 py-0.5 rounded border border-emerald-800 font-mono">
                        <Signal className="w-2.5 h-2.5" /> TỐT
                      </span>
                    )}
                    {freshness === 'DEGRADED' && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/70 px-1.5 py-0.5 rounded border border-amber-800 font-mono">
                        <Activity className="w-2.5 h-2.5" /> SUY GIẢM
                      </span>
                    )}
                    {(freshness === 'STALE' || freshness === 'LOST') && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 bg-rose-950/70 px-1.5 py-0.5 rounded border border-rose-800 font-mono animate-pulse">
                        <AlertTriangle className="w-2.5 h-2.5" /> MẤT TÍN HIỆU
                      </span>
                    )}
                  </div>
                </div>

                {/* Flight Metrics Grid */}
                <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono text-slate-300 py-1 bg-slate-950/50 px-2 rounded mb-2 border border-slate-800/60">
                  <div>
                    <span className="text-slate-500 text-[10px] block">ĐỘ CAO</span>
                    <span className="font-semibold text-cyan-300">
                      {Math.round(uav.position.altitude_m)}m <span className="text-[9px] text-slate-400">{uav.position.altitude_reference}</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">TỐC ĐỘ</span>
                    <span className="font-semibold text-slate-200">
                      {Math.round(uav.velocity.ground_speed_mps)} m/s
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">HƯỚNG</span>
                    <span className="font-semibold text-slate-200">
                      {Math.round(uav.velocity.heading_deg)}°
                    </span>
                  </div>
                </div>

                {/* Corridor Deviation Warning if any */}
                {hasDeviation && (
                  <div className="text-[10px] text-amber-300 bg-amber-950/50 border border-amber-800/80 px-2 py-1 rounded flex items-center gap-1 mb-2">
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    <span>Lệch hành lang: {uav.plan_deviation?.cross_track_error_m}m</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-800/70">
                  <span className="text-[10px] text-slate-500 font-mono">
                    Seq #{uav.data_quality.last_sequence}
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      focusUav(uav.uav_id);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-slate-800 hover:bg-cyan-600 hover:text-white text-slate-300 rounded border border-slate-700 transition-all"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Theo dõi 3D</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
