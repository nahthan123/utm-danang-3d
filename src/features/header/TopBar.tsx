import { useMonitoringStore } from '../../stores/useMonitoringStore';
import { Radio, Wifi, WifiOff, RefreshCw, Settings, Sliders, ShieldAlert, Navigation, Play, Pause } from 'lucide-react';
import { formatUtcTime } from '../../utils/time';

export const TopBar: React.FC = () => {
  const {
    mode,
    connectionStatus,
    connectionMessage,
    simClockIso,
    simStatus,
    uavStates,
    alerts,
    leftPanelOpen,
    rightPanelOpen,
    setMode,
    setLeftPanelOpen,
    setRightPanelOpen,
    setSettingsModalOpen,
    resetCameraToDaNang,
    togglePauseSimulation,
    setSimulationSpeed,
  } = useMonitoringStore();

  const totalUavs = Object.keys(uavStates).length;
  const criticalAlertsCount = alerts.filter((a) => !a.acknowledged && a.severity === 'CRITICAL').length;
  const warningAlertsCount = alerts.filter((a) => !a.acknowledged && a.severity === 'WARNING').length;

  return (
    <header className="h-14 bg-slate-950/95 border-b border-slate-800 px-2.5 xl:px-4 flex items-center justify-between gap-2 z-20 backdrop-blur-md select-none overflow-x-auto">
      {/* Brand & Left Controls */}
      <div className="flex items-center gap-2 xl:gap-3 shrink-0">
        <button
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
          title="Ẩn/Hiện danh sách chuyến bay"
          className={`p-1.5 rounded border transition-colors ${
            leftPanelOpen
              ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Radio className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs xl:text-sm tracking-wide text-white uppercase font-mono">
                UTM MONITORING
              </span>
              <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/80 font-mono">
                3D AIRSPACE
              </span>
            </div>
            <p className="hidden xl:block text-[11px] text-slate-400 leading-none">
              Trung tâm Giám sát Không phận 3D • Đà Nẵng
            </p>
          </div>
        </div>

        <div className="hidden lg:block h-5 w-[1px] bg-slate-800 mx-1" />

        {/* Da Nang Quick Center */}
        <button
          onClick={resetCameraToDaNang}
          className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 rounded border border-slate-700/70 transition-all"
        >
          <Navigation className="w-3.5 h-3.5 text-cyan-400" />
          <span>Đà Nẵng</span>
        </button>
      </div>

      {/* Middle: Sim Controls, Sim Time & Mode Switcher */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Mode Selector Toggle */}
        <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-700/80">
          <button
            onClick={() => setMode('DEMO')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === 'DEMO'
                ? 'bg-cyan-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            DEMO
          </button>
          <button
            onClick={() => setMode('LIVE')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === 'LIVE'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            LIVE (WS)
          </button>
        </div>

        {/* Simulation Playback & Speed Controls (Only available in Demo mode or when sim status received) */}
        {mode === 'DEMO' && (
          <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-lg p-0.5 gap-1 font-mono text-xs">
            <button
              onClick={togglePauseSimulation}
              title={simStatus.status === 'PAUSED' ? 'Tiếp tục mô phỏng' : 'Tạm dừng mô phỏng'}
              className={`p-1.5 rounded transition-all flex items-center gap-1 ${
                simStatus.status === 'PAUSED'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {simStatus.status === 'PAUSED' ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              <span className="text-[10px] font-semibold">
                {simStatus.status === 'PAUSED' ? 'PAUSED' : 'RUN'}
              </span>
            </button>

            <div className="h-3 w-[1px] bg-slate-800" />

            <div className="flex items-center gap-0.5 px-1">
              {[1.0, 2.0, 4.0].map((spd) => (
                <button
                  key={spd}
                  onClick={() => setSimulationSpeed(spd)}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${
                    simStatus.playback_speed === spd
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Connection Status Badge */}
        <button
          onClick={() => setSettingsModalOpen(true)}
          title={`${connectionMessage || 'Trạng thái kết nối'} — Bấm để cấu hình WebSocket`}
          className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-900/80 border border-slate-800 hover:border-cyan-500/60 transition-colors cursor-pointer"
        >
          {connectionStatus === 'CONNECTED' ? (
            <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <Wifi className="w-3.5 h-3.5" />
              ĐÃ KẾT NỐI
            </span>
          ) : connectionStatus === 'CONNECTING' || connectionStatus === 'RECONNECTING' ? (
            <span className="flex items-center gap-1.5 text-amber-400 text-xs font-mono font-medium">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ĐANG KẾT NỐI
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-rose-400 text-xs font-mono font-medium">
              <WifiOff className="w-3.5 h-3.5" />
              MẤT KẾT NỐI
            </span>
          )}
        </button>

        {/* UTC Sim Clock */}
        <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded bg-slate-900/90 border border-slate-800 text-slate-300 font-mono text-xs">
          <span className="text-slate-500">SIM UTC:</span>
          <span className="text-cyan-400 font-semibold">{formatUtcTime(simClockIso)}</span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Active UAV Count */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono bg-slate-900/90 px-2.5 py-1 rounded border border-slate-800">
          <span className="text-slate-400">UAV:</span>
          <span className="text-cyan-400 font-bold">{totalUavs}</span>
        </div>

        {/* Alert Counter Badge */}
        {(criticalAlertsCount > 0 || warningAlertsCount > 0) && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-rose-950/80 border border-rose-800/80 text-rose-300 text-xs font-mono animate-pulse">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>{criticalAlertsCount + warningAlertsCount} Cảnh báo</span>
          </div>
        )}

        {/* Settings Modal Toggle */}
        <button
          onClick={() => setSettingsModalOpen(true)}
          title="Cấu hình kết nối WebSocket (SITL/Gazebo) & Cesium Ion"
          className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Right Panel Toggle */}
        <button
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          title="Ẩn/Hiện thanh thông tin chi tiết và cảnh báo"
          className={`p-1.5 rounded border transition-colors ${
            rightPanelOpen
              ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4 rotate-180" />
        </button>
      </div>
    </header>
  );
};
