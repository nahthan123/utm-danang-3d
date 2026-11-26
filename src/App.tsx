import React, { useEffect } from 'react';
import { useMonitoringStore } from './stores/useMonitoringStore';
import { useTacticalStore } from './stores/useTacticalStore';
import { TopBar } from './features/header/TopBar';
import { FlightListPanel } from './features/flights/FlightListPanel';
import { CesiumViewer } from './features/map3d/CesiumViewer';
import { City3DViewer } from './features/map3d/City3DViewer';
import { TelemetryPanel } from './features/telemetry/TelemetryPanel';
import { BottomBar } from './features/footer/BottomBar';
import { SettingsModal } from './features/settings/SettingsModal';
import { TacticalConflictPanel } from './features/tactical/TacticalConflictPanel';
import { TacticalReportModal } from './features/tactical/TacticalReportModal';

export const App: React.FC = () => {
  const {
    leftPanelOpen,
    rightPanelOpen,
    renderEngine,
    setRenderEngine,
    initializeDataSources,
    cleanup,
  } = useMonitoringStore();

  const { initializeTacticalBridge } = useTacticalStore();

  useEffect(() => {
    initializeDataSources();
    const unsubscribeTactical = initializeTacticalBridge();
    return () => {
      cleanup();
      unsubscribeTactical();
    };
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* 1. Header Navigation & Simulation Bar */}
      <TopBar />

      {/* 2. Main Work Area: Left Panel, 3D Center Viewport, Right Panel */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Flight List Panel */}
        {leftPanelOpen && <FlightListPanel />}

        {/* Center 3D Airspace Viewport */}
        <main className="flex-1 min-w-0 h-full relative overflow-hidden bg-slate-950">
          {renderEngine === 'THREE_3D' ? <City3DViewer /> : <CesiumViewer />}

          {/* Floating Engine Switcher: Three.js 3D City vs CesiumJS Globe */}
          <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-20 flex items-center bg-slate-950/90 p-1 rounded-lg border border-slate-700/80 shadow-xl backdrop-blur-md">
            <button
              onClick={() => setRenderEngine('THREE_3D')}
              className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-all ${
                renderEngine === 'THREE_3D'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              3D Đô thị (WebGL)
            </button>
            <button
              onClick={() => setRenderEngine('CESIUM_MAP')}
              className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-all ${
                renderEngine === 'CESIUM_MAP'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Bản đồ Địa cầu (CesiumJS)
            </button>
          </div>

          {/* Tactical Deconfliction Panel Overlay */}
          <TacticalConflictPanel />
        </main>

        {/* Right Telemetry & Alert Stream Panel */}
        {rightPanelOpen && <TelemetryPanel />}
      </div>

      {/* 3. Footer Status Bar */}
      <BottomBar />

      {/* 4. Settings Configuration Modal */}
      <SettingsModal />

      {/* 5. Tactical Incident Report Modal */}
      <TacticalReportModal />
    </div>
  );
};

export default App;
