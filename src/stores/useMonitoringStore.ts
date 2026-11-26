import { create } from 'zustand';
import { IngestibleMessage, FlightPlan, RestrictedZone, MonitoringAlert, SimulationStatus } from '../types/telemetry';
import { ObservedUAVState } from '../types/monitoring';
import { ResolutionAdjustment } from '../types/tactical';
import { TelemetryValidator } from '../services/validator/TelemetryValidator';
import { TelemetrySynchronizer } from '../services/synchronizer/TelemetrySynchronizer';
import { IDataSource, ConnectionStatus } from '../services/dataSource/IDataSource';
import { DemoDataSource } from '../services/dataSource/DemoDataSource';
import { LiveWebSocketDataSource } from '../services/dataSource/LiveWebSocketDataSource';
import { part5Bridge } from '../services/part5Bridge/Part5ExportBridge';
import {
  VuongOutboundLog,
  buildVuongDecisionPayload,
  buildVuongProgressPayload,
  postToVuong,
} from '../services/dispatch/VuongOutboundService';
import { DANANG_RESTRICTED_ZONES } from '../data/danangAirspace';
import { MOCK_FLIGHT_PLANS } from '../data/mockScenarios';

export interface CameraTarget {
  latitude: number;
  longitude: number;
  altitude_m: number;
  heading_deg?: number;
  timestamp: number;
}

interface MonitoringStoreState {
  // Mode & Data Source
  mode: 'DEMO' | 'LIVE';
  connectionStatus: ConnectionStatus;
  connectionMessage: string;
  wsUrl: string;
  opsWsUrl: string;
  opsConnectionStatus: ConnectionStatus;
  cesiumIonToken: string;

  // Tracked Entities
  uavStates: Record<string, ObservedUAVState>;
  selectedUavId: string | null;
  flightPlans: Record<string, FlightPlan>;
  restrictedZones: RestrictedZone[];
  alerts: MonitoringAlert[];

  // Simulation State
  simStatus: SimulationStatus;
  simClockIso: string;
  wallClockIso: string;
  totalReceivedPackets: number;
  droppedPacketsCount: number;
  outOfOrderCount: number;
  conflictDemoActive: boolean;

  // Filter & Search
  searchQuery: string;
  statusFilter: 'ALL' | 'FLYING' | 'ALERT' | 'STALE';

  // Map & 3D Engine Controls
  renderEngine: 'THREE_3D' | 'CESIUM_MAP';
  showZones: boolean;
  showPlans: boolean;
  showTrails: boolean;
  showPredictions: boolean;
  show3DCity: boolean;
  mapStyle: 'DARK' | 'SATELLITE' | 'STREET';
  cameraTarget: CameraTarget | null;

  // Outbound Delivery to Vuong (UTM Ops)
  vuongOutboundUrl: string;
  vuongOutboundEnabled: boolean;
  vuongOutboundLogs: VuongOutboundLog[];

  // UI Panels
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  settingsModalOpen: boolean;
  importJsonModalOpen: boolean;
  telemetryProtocol: 'AUTO_DETECT' | 'INTERNAL_V1' | 'PHUOC_SIMULATOR';

  // Actions
  setMode: (mode: 'DEMO' | 'LIVE') => void;
  setWsUrl: (url: string) => void;
  setOpsWsUrl: (url: string) => void;
  setCesiumIonToken: (token: string) => void;
  setTelemetryProtocol: (p: 'AUTO_DETECT' | 'INTERNAL_V1' | 'PHUOC_SIMULATOR') => void;
  setVuongOutboundUrl: (url: string) => void;
  setVuongOutboundEnabled: (enabled: boolean) => void;
  clearVuongOutboundLogs: () => void;
  sendDecisionToVuong: (
    uavId: string,
    adjustment: ResolutionAdjustment,
    reason: string
  ) => Promise<void>;
  selectUav: (id: string | null) => void;
  focusUav: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: 'ALL' | 'FLYING' | 'ALERT' | 'STALE') => void;
  acknowledgeAlert: (alertId: string) => void;
  clearAlerts: () => void;
  toggleLayer: (layer: 'zones' | 'plans' | 'trails' | 'city3d' | 'predictions') => void;
  setRenderEngine: (engine: 'THREE_3D' | 'CESIUM_MAP') => void;
  setMapStyle: (style: 'DARK' | 'SATELLITE' | 'STREET') => void;
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setImportJsonModalOpen: (open: boolean) => void;
  resetCameraToDaNang: () => void;
  focusDaNang3DView: () => void;

  // Simulation Controls (Part 2 Bridge)
  togglePauseSimulation: () => void;
  setSimulationSpeed: (speed: number) => void;
  startConflictDemo: () => void;
  stopConflictDemo: () => void;
  executeTacticalManeuver: (uavId: string, adjustment: ResolutionAdjustment) => void;

  // Internal Data Pipeline
  ingestMessage: (msg: IngestibleMessage) => void;
  tickLiveness: () => void;
  initializeDataSources: () => void;
  cleanup: () => void;
}

// Singletons for validation and synchronization
const synchronizer = new TelemetrySynchronizer();
let activeDataSource: IDataSource | null = null;
let opsDataSource: LiveWebSocketDataSource | null = null;
let livenessTimer: number | null = null;
let livenessTickCount = 0;

// Initial flight plans map
const initialPlansMap: Record<string, FlightPlan> = {};
MOCK_FLIGHT_PLANS.forEach((p) => {
  initialPlansMap[p.plan_id] = p;
});

export const useMonitoringStore = create<MonitoringStoreState>((set, get) => ({
  mode: 'LIVE',
  connectionStatus: 'DISCONNECTED',
  connectionMessage: 'Chưa kết nối',
  wsUrl: import.meta.env.VITE_WS_TELEMETRY_URL || 'ws://localhost:8001/ws/telemetry',
  opsWsUrl: import.meta.env.VITE_OPS_WS_URL || 'ws://localhost:8000/ws/flight-plans',
  opsConnectionStatus: 'DISCONNECTED',
  cesiumIonToken: '',

  uavStates: {},
  selectedUavId: null,
  flightPlans: initialPlansMap,
  restrictedZones: DANANG_RESTRICTED_ZONES,
  alerts: [],

  simStatus: {
    simulation_id: 'SIM-DANANG-TEST-001',
    status: 'RUNNING',
    sim_time: '2026-10-18T10:00:00Z',
    playback_speed: 1.0,
    active_uav_count: 3,
    timestamp: new Date().toISOString(),
  },

  simClockIso: '2026-10-18T10:00:00Z',
  wallClockIso: new Date().toISOString(),
  totalReceivedPackets: 0,
  droppedPacketsCount: 0,
  outOfOrderCount: 0,
  conflictDemoActive: false,

  searchQuery: '',
  statusFilter: 'ALL',

  showZones: true,
  showPlans: true,
  showTrails: true,
  showPredictions: true,
  show3DCity: true,
  renderEngine: 'THREE_3D',
  mapStyle: 'DARK',
  cameraTarget: null,

  vuongOutboundUrl:
    import.meta.env.VITE_VUONG_OUTBOUND_URL || 'http://localhost:8080/api/integration/monitoring-updates',
  vuongOutboundEnabled: false,
  vuongOutboundLogs: [],

  leftPanelOpen: true,
  rightPanelOpen: true,
  settingsModalOpen: false,
  importJsonModalOpen: false,
  telemetryProtocol: 'AUTO_DETECT',

  setWsUrl: (url: string) => {
    set({ wsUrl: url });
    if (activeDataSource instanceof LiveWebSocketDataSource) {
      activeDataSource.setUrl(url);
    }
  },
  setCesiumIonToken: (token: string) => set({ cesiumIonToken: token }),
  setOpsWsUrl: (url: string) => {
    set({ opsWsUrl: url });
    opsDataSource?.setUrl(url);
  },
  setTelemetryProtocol: (p) => set({ telemetryProtocol: p }),
  setVuongOutboundUrl: (url: string) => set({ vuongOutboundUrl: url }),
  setVuongOutboundEnabled: (enabled: boolean) => set({ vuongOutboundEnabled: enabled }),
  clearVuongOutboundLogs: () => set({ vuongOutboundLogs: [] }),

  sendDecisionToVuong: async (
    uavId: string,
    adjustment: ResolutionAdjustment,
    reason: string
  ) => {
    const state = get();
    const uav = state.uavStates[uavId];
    const flightId = uav?.flight_plan_id || 'UNLINKED';
    const payload = buildVuongDecisionPayload(uavId, adjustment, reason, flightId, 'EXECUTING');
    const decisionUrl = state.vuongOutboundUrl.replace(/monitoring-updates\/?$/, 'monitoring-decisions');
    const result = await postToVuong(decisionUrl, payload);

    const log: VuongOutboundLog = {
      id: `OUT-DEC-${uavId}-${Date.now()}`,
      timestampUtc: new Date().toISOString(),
      eventType: 'monitoring.decision',
      uavId,
      flightId,
      status: result.ok ? 'SENT' : 'ERROR',
      httpStatus: result.httpStatus,
      summary: String(payload.instructionSummary || adjustment.action_type),
      errorMessage: result.errorMessage,
      payload,
    };

    set((prev) => ({
      vuongOutboundLogs: [log, ...prev.vuongOutboundLogs].slice(0, 30),
    }));
  },

  setLeftPanelOpen: (open: boolean) => set({ leftPanelOpen: open }),
  setRightPanelOpen: (open: boolean) => set({ rightPanelOpen: open }),
  setSettingsModalOpen: (open: boolean) => set({ settingsModalOpen: open }),
  setImportJsonModalOpen: (open: boolean) => set({ importJsonModalOpen: open }),

  selectUav: (id: string | null) => set({ selectedUavId: id }),

  focusUav: (id: string) => {
    const uav = get().uavStates[id];
    if (uav) {
      set({
        selectedUavId: id,
        cameraTarget: {
          latitude: uav.position.latitude - 0.0022,
          longitude: uav.position.longitude - 0.0012,
          altitude_m: Math.max(uav.position.altitude_m + 180, 260),
          heading_deg: 25,
          timestamp: Date.now(),
        },
      });
    }
  },

  resetCameraToDaNang: () => {
    set({
      selectedUavId: null,
      cameraTarget: {
        latitude: 16.0544,
        longitude: 108.2022,
        altitude_m: 12000,
        heading_deg: 0,
        timestamp: Date.now(),
      },
    });
  },

  focusDaNang3DView: () => {
    set({
      selectedUavId: null,
      cameraTarget: {
        latitude: 16.0555,
        longitude: 108.2245,
        altitude_m: 780,
        heading_deg: 12,
        timestamp: Date.now(),
      },
    });
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setStatusFilter: (filter: 'ALL' | 'FLYING' | 'ALERT' | 'STALE') => set({ statusFilter: filter }),

  acknowledgeAlert: (alertId: string) => {
    set((state) => ({
      alerts: state.alerts.map((a) => (a.alert_id === alertId ? { ...a, acknowledged: true } : a)),
    }));
  },

  clearAlerts: () => set({ alerts: [] }),

  toggleLayer: (layer: 'zones' | 'plans' | 'trails' | 'city3d' | 'predictions') => {
    if (layer === 'zones') set((s) => ({ showZones: !s.showZones }));
    if (layer === 'plans') set((s) => ({ showPlans: !s.showPlans }));
    if (layer === 'trails') set((s) => ({ showTrails: !s.showTrails }));
    if (layer === 'city3d') set((s) => ({ show3DCity: !s.show3DCity }));
    if (layer === 'predictions') set((s) => ({ showPredictions: !s.showPredictions }));
  },

  setRenderEngine: (engine: 'THREE_3D' | 'CESIUM_MAP') => set({ renderEngine: engine }),
  setMapStyle: (style: 'DARK' | 'SATELLITE' | 'STREET') => set({ mapStyle: style }),

  togglePauseSimulation: () => {
    if (activeDataSource instanceof DemoDataSource) {
      const isPaused = activeDataSource.togglePause();
      set((state) => ({
        simStatus: {
          ...state.simStatus,
          status: isPaused ? 'PAUSED' : 'RUNNING',
        },
      }));
    }
  },

  setSimulationSpeed: (speed: number) => {
    if (activeDataSource instanceof DemoDataSource) {
      activeDataSource.setSpeed(speed);
      set((state) => ({
        simStatus: {
          ...state.simStatus,
          playback_speed: speed,
        },
      }));
    }
  },

  startConflictDemo: () => {
    const store = get();
    if (store.mode !== 'DEMO' || !(activeDataSource instanceof DemoDataSource)) {
      store.setMode('DEMO');
    }
    if (activeDataSource instanceof DemoDataSource) {
      activeDataSource.startConflictDemo();
    }
    set((state) => ({
      conflictDemoActive: true,
      simStatus: {
        ...state.simStatus,
        status: 'RUNNING',
      },
      cameraTarget: {
        latitude: 16.0612,
        longitude: 108.2245,
        altitude_m: 340,
        heading_deg: 10,
        timestamp: Date.now(),
      },
    }));
  },

  stopConflictDemo: () => {
    if (activeDataSource instanceof DemoDataSource) {
      activeDataSource.stopConflictDemo();
    }
    set({ conflictDemoActive: false });
  },

  executeTacticalManeuver: (uavId: string, adjustment: ResolutionAdjustment) => {
    const store = get();
    if (activeDataSource instanceof DemoDataSource) {
      activeDataSource.applyTacticalManeuver(uavId, adjustment);
    } else if (store.mode === 'LIVE') {
      // Forward tactical adjustment command directly to Khối 2 PX4 simulator (:8001/api/commands)
      let cmdUrl = 'http://localhost:8001/api/commands';
      try {
        const parsed = new URL(store.wsUrl);
        const proto = parsed.protocol === 'wss:' ? 'https:' : 'http:';
        cmdUrl = `${proto}//${parsed.host}/api/commands`;
      } catch {
        // fallback default
      }
      let commandType: string | null = null;
      let parameters: Record<string, unknown> = {};
      if (adjustment.action_type === 'ALTITUDE_CHANGE') {
        commandType = 'CHANGE_ALTITUDE';
        parameters = {
          target_altitude_m: adjustment.target_altitude_m,
          delta_m: adjustment.altitude_delta_m,
        };
      } else if (adjustment.action_type === 'HEADING_CHANGE') {
        commandType = 'CHANGE_HEADING';
        parameters = {
          target_heading_deg: adjustment.target_heading_deg,
          delta_deg: adjustment.heading_delta_deg,
        };
      } else if (adjustment.action_type === 'SPEED_CHANGE') {
        commandType = 'CHANGE_SPEED';
        const currentSpeed = store.uavStates[uavId]?.velocity.ground_speed_mps ?? 13.0;
        const targetSpeed =
          adjustment.target_ground_speed_mps ??
          (adjustment.speed_delta_mps !== undefined
            ? Math.max(0, currentSpeed + adjustment.speed_delta_mps)
            : currentSpeed);
        parameters = { target_speed_mps: targetSpeed };
      }
      if (commandType) {
        void fetch(cmdUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uav_id: uavId, command_type: commandType, parameters }),
        }).catch(() => undefined);
      }
    }
    const detailText =
      adjustment.action_type === 'ALTITUDE_CHANGE'
        ? `lệnh leo cao ${adjustment.altitude_delta_m ?? 35}m (đích ${adjustment.target_altitude_m}m)`
        : adjustment.action_type === 'SPEED_CHANGE'
        ? `lệnh điều chỉnh tốc độ (${adjustment.target_ground_speed_mps ?? adjustment.speed_delta_mps ?? ''} m/s)`
        : `lệnh chuyển hướng +${adjustment.heading_delta_deg ?? 35}°`;
    const alert: MonitoringAlert = {
      alert_id: `ALT-MANEUVER-${Date.now()}`,
      severity: 'INFO',
      source: 'TACTICAL_CONFLICT_PART5',
      uav_id: uavId,
      title: `Đang thực thi né xung đột (${uavId})`,
      description: `Đã truyền ${detailText} tới ${uavId}. Theo dõi tách phân cách an toàn trên 3D.`,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };
    set((state) => ({
      alerts: [alert, ...state.alerts].slice(0, 50),
    }));

    if (get().vuongOutboundEnabled) {
      void get().sendDecisionToVuong(
        uavId,
        adjustment,
        `Xử lý né xung đột chiến thuật: ${detailText}`
      );
    }
  },

  setMode: (newMode: 'DEMO' | 'LIVE') => {
    const currentMode = get().mode;
    if (currentMode === newMode && activeDataSource) return;

    if (activeDataSource) {
      activeDataSource.stop();
      activeDataSource = null;
    }

    opsDataSource?.stop();
    opsDataSource = null;

    set({
      mode: newMode,
      uavStates: {},
      alerts: [],
      flightPlans: newMode === 'DEMO' ? { ...initialPlansMap } : {},
      opsConnectionStatus: 'DISCONNECTED',
      selectedUavId: null,
      conflictDemoActive: false,
      connectionStatus: 'CONNECTING',
      connectionMessage: `Đang chuyển sang chế độ ${newMode}...`,
    });

    const store = get();
    if (newMode === 'DEMO') {
      activeDataSource = new DemoDataSource();
    } else {
      activeDataSource = new LiveWebSocketDataSource(store.wsUrl);
    }

    activeDataSource.start({
      onMessage: (msg) => store.ingestMessage(msg),
      onConnectionChange: (status, message) => {
        set({ connectionStatus: status, connectionMessage: message || '' });
      },
      onError: (err) => {
        console.error('[DataSource Error]:', err);
        set({ connectionStatus: 'ERROR', connectionMessage: err.message });
      },
    });

    if (newMode === 'LIVE') {
      opsDataSource = new LiveWebSocketDataSource(store.opsWsUrl);
      opsDataSource.start({
        onMessage: (msg) => {
          if (msg.type === 'flight_plan.update' || msg.type === 'flight_plan.snapshot') store.ingestMessage(msg);
        },
        onConnectionChange: (status) => set({ opsConnectionStatus: status }),
        onError: () => set({ opsConnectionStatus: 'ERROR' }),
      });
    }
  },

  ingestMessage: (msg: IngestibleMessage) => {
    const now = new Date();
    set((state) => ({
      wallClockIso: now.toISOString(),
      totalReceivedPackets: state.totalReceivedPackets + 1,
    }));

    // Handle Simulation Status Message
    if (msg.type === 'simulation.status') {
      const statusPayload = (msg as { payload: SimulationStatus }).payload;
      set({
        simStatus: statusPayload,
        simClockIso: statusPayload.sim_time,
      });
      return;
    }

    // Handle Telemetry Messages
    if (msg.type === 'uav.telemetry') {
      const validation = TelemetryValidator.validateTelemetry(msg);
      if (!validation.isValid || !validation.sanitized) {
        console.warn('[Telemetry Validation Failed]:', validation.errors);
        return;
      }

      const validMsg = validation.sanitized;
      const state = get();
      const existing = state.uavStates[validMsg.uav_id];
      const findPlanForUav = (flightPlanId: string | undefined, uavId: string, callsign?: string) => {
        if (flightPlanId && state.flightPlans[flightPlanId]) {
          return state.flightPlans[flightPlanId];
        }
        return Object.values(state.flightPlans).find(
          (p) =>
            p.status !== 'CANCELLED' &&
            p.status !== 'COMPLETED' &&
            (p.uav_id === uavId || (Boolean(p.callsign) && (p.callsign === uavId || p.callsign === callsign)))
        );
      };
      const flightPlan = findPlanForUav(validMsg.flight_plan_id, validMsg.uav_id, validMsg.callsign);
      const isPaused = state.simStatus.status === 'PAUSED';

      const { state: updatedUav, isDuplicate, isOutOfOrder, gapDetected } = synchronizer.processTelemetry(
        validMsg,
        existing,
        flightPlan,
        now,
        isPaused
      );

      if (isDuplicate) return;

      const newStates = {
        ...state.uavStates,
        [validMsg.uav_id]: updatedUav,
      };

      // If UAV was previously STALE or LOST, create recovery notice
      const previousFreshness = existing?.data_quality.freshness;
      let currentAlerts = state.alerts;
      if (previousFreshness === 'STALE' || previousFreshness === 'LOST') {
        const recoverAlert: MonitoringAlert = {
          alert_id: `ALERT-RECOVER-${validMsg.uav_id}-${Date.now()}`,
          severity: 'INFO',
          source: 'SYSTEM',
          uav_id: validMsg.uav_id,
          title: `Khôi phục tín hiệu Telemetry (${validMsg.uav_id})`,
          description: `Đã kết nối lại và nhận telemetry thời gian thực từ ${validMsg.uav_id}.`,
          timestamp: now.toISOString(),
          acknowledged: false,
        };
        currentAlerts = [recoverAlert, ...state.alerts.slice(0, 49)];
      }

      const isFirstLiveUav = state.mode === 'LIVE' && Object.keys(state.uavStates).length === 0;

      set({
        uavStates: newStates,
        simClockIso: validMsg.timestamp,
        alerts: currentAlerts,
        droppedPacketsCount: state.droppedPacketsCount + gapDetected,
        outOfOrderCount: state.outOfOrderCount + (isOutOfOrder ? 1 : 0),
        ...(isFirstLiveUav
          ? {
              selectedUavId: validMsg.uav_id,
              cameraTarget: {
                latitude: validMsg.position.latitude,
                longitude: validMsg.position.longitude,
                altitude_m: Math.max(validMsg.position.altitude_m + 180, 220),
                heading_deg: 20,
                timestamp: Date.now(),
              },
            }
          : {}),
      });

      // Export verified snapshot to Part 5 bridge
      part5Bridge.generateSnapshot(newStates, currentAlerts);
    }

    // Handle Alert Messages
    else if (msg.type === 'monitoring.alert') {
      const alert = (msg as { payload: MonitoringAlert }).payload;
      set((state) => ({
        alerts: [alert, ...state.alerts.slice(0, 49)],
      }));
    }

    // Handle Flight Plan Updates
    else if (msg.type === 'flight_plan.update') {
      const plan = (msg as { payload: FlightPlan }).payload;
      set((state) => ({
        flightPlans: { ...state.flightPlans, [plan.plan_id]: plan },
      }));
    }

    else if (msg.type === 'flight_plan.snapshot') {
      set({ flightPlans: Object.fromEntries(msg.payload.map((plan) => [plan.plan_id, plan])) });
    }

    // Handle Dynamic Restricted Zone Updates from Part 2
    else if (msg.type === 'zone.update') {
      const zone = (msg as { payload: RestrictedZone }).payload;
      set((state) => {
        const filtered = state.restrictedZones.filter((z) => z.zone_id !== zone.zone_id);
        return { restrictedZones: [...filtered, zone] };
      });
    }
  },

  tickLiveness: () => {
    const now = new Date();
    const state = get();
    let hasChanges = false;
    const updatedMap: Record<string, ObservedUAVState> = {};
    const isPaused = state.simStatus.status === 'PAUSED';
    const newAlerts: MonitoringAlert[] = [];

    Object.values(state.uavStates).forEach((uav) => {
      const evaluated = synchronizer.evaluateLiveness(uav, now, isPaused);
      if (
        evaluated.data_quality.freshness !== uav.data_quality.freshness ||
        evaluated.data_quality.freshness_age_ms !== uav.data_quality.freshness_age_ms
      ) {
        hasChanges = true;
      }

      // Check transition to STALE or LOST to generate visible Link Loss Alerts
      if (uav.data_quality.freshness !== 'STALE' && evaluated.data_quality.freshness === 'STALE') {
        newAlerts.push({
          alert_id: `ALERT-STALE-${uav.uav_id}-${Date.now()}`,
          severity: 'WARNING',
          source: 'DATA_LINK_LOSS',
          uav_id: uav.uav_id,
          title: `Cảnh báo trễ Telemetry (${uav.uav_id})`,
          description: `Telemetry từ ${uav.uav_id} không nhận được quá 6.0s (STALE). Đóng băng xử lý tự động.`,
          timestamp: now.toISOString(),
          acknowledged: false,
        });
      } else if (uav.data_quality.freshness !== 'LOST' && evaluated.data_quality.freshness === 'LOST') {
        newAlerts.push({
          alert_id: `ALERT-LOST-${uav.uav_id}-${Date.now()}`,
          severity: 'CRITICAL',
          source: 'DATA_LINK_LOSS',
          uav_id: uav.uav_id,
          title: `MẤT TÍN HIỆU ĐƯỜNG TRUYỀN (${uav.uav_id})`,
          description: `Mất tín hiệu telemetry từ ${uav.uav_id} quá 15.0s (LOST LINK). Kích hoạt quy trình an toàn.`,
          timestamp: now.toISOString(),
          acknowledged: false,
        });
      }

      updatedMap[uav.uav_id] = evaluated;
    });

    if (hasChanges || newAlerts.length > 0) {
      const combinedAlerts = newAlerts.length > 0 ? [...newAlerts, ...state.alerts.slice(0, 49)] : state.alerts;
      set({ uavStates: updatedMap, alerts: combinedAlerts });
      part5Bridge.generateSnapshot(updatedMap, combinedAlerts);
    }

    livenessTickCount += 1;
    if (state.vuongOutboundEnabled && !isPaused && livenessTickCount % 2 === 0) {
      const targetUrl = state.vuongOutboundUrl;
      const plansMap = state.flightPlans;
      Object.values(updatedMap).forEach((uav) => {
        const linkedPlan =
          (uav.flight_plan_id ? plansMap[uav.flight_plan_id] : undefined) ||
          Object.values(plansMap).find(
            (p) =>
              p.status !== 'CANCELLED' &&
              p.status !== 'COMPLETED' &&
              (p.uav_id === uav.uav_id || (Boolean(p.callsign) && (p.callsign === uav.uav_id || p.callsign === uav.callsign)))
          );
        const payload = buildVuongProgressPayload(uav, linkedPlan);
        const routeProgress = payload.routeProgress as {
          progressPercent: number;
          currentLegLabel: string;
        };
        const flightId = String(payload.flightId || 'UNLINKED');

        void postToVuong(targetUrl, payload).then((res) => {
          const log: VuongOutboundLog = {
            id: `OUT-PROG-${uav.uav_id}-${Date.now()}`,
            timestampUtc: new Date().toISOString(),
            eventType: 'monitoring.progress',
            uavId: uav.uav_id,
            flightId,
            status: res.ok ? 'SENT' : 'ERROR',
            httpStatus: res.httpStatus,
            summary: `${routeProgress.progressPercent}% (${routeProgress.currentLegLabel}) • ${Math.round(uav.position.altitude_m)}m`,
            errorMessage: res.errorMessage,
            payload,
          };
          set((prev) => ({
            vuongOutboundLogs: [log, ...prev.vuongOutboundLogs].slice(0, 30),
          }));
        });
      });
    }
  },

  initializeDataSources: () => {
    const store = get();
    set({ vuongOutboundEnabled: true });
    store.setMode('LIVE');

    if (!livenessTimer) {
      livenessTimer = window.setInterval(() => {
        get().tickLiveness();
      }, 1000);
    }
  },

  cleanup: () => {
    livenessTickCount = 0;
    opsDataSource?.stop();
    opsDataSource = null;
    set({ opsConnectionStatus: 'DISCONNECTED' });
    if (activeDataSource) {
      activeDataSource.stop();
      activeDataSource = null;
    }
    if (livenessTimer) {
      window.clearInterval(livenessTimer);
      livenessTimer = null;
    }
  },
}));
