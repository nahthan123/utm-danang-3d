/**
 * TASK 11: TACTICAL DECONFLICTION ZUSTAND STORE
 * Manages tactical conflict state, resolution sessions, AI mode toggling, and operator approvals.
 */

import { create } from 'zustand';
import {
  ConflictDetectionResult,
  TacticalResolutionSession,
  ResolutionOption
} from '../types/tactical';
import { Part5InputFeed } from '../types/monitoring';
import { tacticalClient } from '../services/tactical/tacticalClient';
import { part5Bridge } from '../services/part5Bridge/Part5ExportBridge';
import { useMonitoringStore } from './useMonitoringStore';

interface TacticalStoreState {
  conflicts: ConflictDetectionResult[];
  sessions: Record<string, TacticalResolutionSession>;
  selectedSessionId: string | null;
  previewedOption: ResolutionOption | null;
  aiEnabled: boolean;
  tacticalPanelOpen: boolean;
  reportModalSessionId: string | null;
  backendConnected: boolean;
  lastEvaluationTime: string;

  // Actions
  setAiEnabled: (enabled: boolean) => void;
  setTacticalPanelOpen: (open: boolean) => void;
  toggleTacticalPanel: () => void;
  selectSession: (sessionId: string | null) => void;
  setPreviewedOption: (option: ResolutionOption | null) => void;
  openReportModal: (sessionId: string) => void;
  closeReportModal: () => void;

  // Operator Actions
  approveResolution: (sessionId: string, optionId: string) => Promise<void>;
  rejectResolution: (sessionId: string, reason?: string) => Promise<void>;

  // Bridge Integration
  processFeedSnapshot: (feed: Part5InputFeed) => Promise<void>;
  initializeTacticalBridge: () => () => void;
}

export const useTacticalStore = create<TacticalStoreState>((set, get) => ({
  conflicts: [],
  sessions: {},
  selectedSessionId: null,
  previewedOption: null,
  aiEnabled: true,
  tacticalPanelOpen: false,
  reportModalSessionId: null,
  backendConnected: false,
  lastEvaluationTime: new Date().toISOString(),

  setAiEnabled: (enabled: boolean) => set({ aiEnabled: enabled }),
  setTacticalPanelOpen: (open: boolean) => set({ tacticalPanelOpen: open }),
  toggleTacticalPanel: () => set((s) => ({ tacticalPanelOpen: !s.tacticalPanelOpen })),
  selectSession: (id: string | null) => set({ selectedSessionId: id }),
  setPreviewedOption: (opt: ResolutionOption | null) => set({ previewedOption: opt }),
  openReportModal: (sessionId: string) => set({ reportModalSessionId: sessionId }),
  closeReportModal: () => set({ reportModalSessionId: null }),

  approveResolution: async (sessionId: string, optionId: string) => {
    const currentSession = get().sessions[sessionId];
    const chosenOption = currentSession?.proposed_options.find((o) => o.option_id === optionId);

    const updated = await tacticalClient.approveOption(sessionId, optionId);
    if (updated) {
      set((state) => ({
        previewedOption: chosenOption || state.previewedOption,
        sessions: {
          ...state.sessions,
          [sessionId]: updated,
        },
      }));
    } else {
      // Local optimistic update
      set((state) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        const nowIso = new Date().toISOString();
        return {
          previewedOption: chosenOption || state.previewedOption,
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...s,
              lifecycle_state: 'EXECUTING',
              selected_option_id: optionId,
              approved_by: 'OPERATOR-DANANG-UTM',
              approval_timestamp: nowIso,
              updated_at: nowIso,
            },
          },
        };
      });
    }

    if (chosenOption) {
      useMonitoringStore.getState().executeTacticalManeuver(chosenOption.target_uav_id, chosenOption.adjustment);
    }
  },

  rejectResolution: async (sessionId: string, reason?: string) => {
    const updated = await tacticalClient.rejectOption(sessionId, reason);
    if (updated) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: updated,
        },
      }));
    } else {
      // Local optimistic update
      set((state) => {
        const s = state.sessions[sessionId];
        if (!s) return state;
        const nowIso = new Date().toISOString();
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...s,
              lifecycle_state: 'REJECTED',
              updated_at: nowIso,
            },
          },
        };
      });
    }
  },

  processFeedSnapshot: async (feed: Part5InputFeed) => {
    const useAi = get().aiEnabled;
    const { conflicts, sessions } = await tacticalClient.sendFeed(feed, useAi);
    const prevSessions = get().sessions;
    const sessionsMap: Record<string, TacticalResolutionSession> = { ...prevSessions };
    const incomingIds = new Set(sessions.map((s) => s.session_id));

    sessions.forEach((s) => {
      // Preserve local approval state if already executing
      const existing = sessionsMap[s.session_id];
      if (existing && (existing.lifecycle_state === 'EXECUTING' || existing.lifecycle_state === 'VERIFIED')) {
        sessionsMap[s.session_id] = {
          ...s,
          lifecycle_state: existing.lifecycle_state,
          selected_option_id: existing.selected_option_id,
          approved_by: existing.approved_by,
          approval_timestamp: existing.approval_timestamp,
          verification_details: existing.verification_details,
        };
      } else {
        sessionsMap[s.session_id] = s;
      }
    });

    // If an EXECUTING session's conflict has cleared in live telemetry -> mark VERIFIED
    let clearedExecuting = false;
    Object.values(sessionsMap).forEach((s) => {
      if (s.lifecycle_state === 'EXECUTING' && !incomingIds.has(s.session_id)) {
        clearedExecuting = true;
        sessionsMap[s.session_id] = {
          ...s,
          lifecycle_state: 'VERIFIED',
          verification_status: 'SAFE_SEPARATION_RESTORED',
          verification_details: 'Đã xác nhận tách phân cách an toàn thực tế qua telemetry Khối 4.',
          updated_at: new Date().toISOString(),
        };
      }
    });

    const nextSelectedId =
      get().selectedSessionId ||
      (sessions.length > 0 ? sessions[0].session_id : null);

    set({
      conflicts,
      sessions: sessionsMap,
      selectedSessionId: nextSelectedId,
      previewedOption: clearedExecuting ? null : get().previewedOption,
      backendConnected: tacticalClient.getIsOnline(),
      lastEvaluationTime: new Date().toISOString(),
      // Auto-open panel if critical conflict appears and not yet opened
      tacticalPanelOpen: get().tacticalPanelOpen || conflicts.some((c) => c.severity === 'CRITICAL'),
    });
  },

  initializeTacticalBridge: () => {
    let lastDispatchedMs = 0;
    let inFlight = false;

    // Automatically subscribe to Part 4 export bridge with 1s throttle; only run automatic CPA when conflictDemoActive is enabled
    const unsubscribeFeed = part5Bridge.subscribe((feed) => {
      if (!useMonitoringStore.getState().conflictDemoActive) {
        if (get().conflicts.length > 0) {
          set({ conflicts: [], previewedOption: null });
        }
        return;
      }

      const nowMs = Date.now();
      if (inFlight || nowMs - lastDispatchedMs < 1000) {
        return;
      }
      lastDispatchedMs = nowMs;
      inFlight = true;
      void get()
        .processFeedSnapshot(feed)
        .finally(() => {
          inFlight = false;
        });
    });

    const unsubscribeMonitoring = useMonitoringStore.subscribe((state, prev) => {
      if ((!state.conflictDemoActive && prev.conflictDemoActive) || state.mode !== prev.mode) {
        set({ conflicts: [], previewedOption: null, tacticalPanelOpen: false });
      }
    });

    // Check initial health
    tacticalClient.checkHealth().then((online) => {
      set({ backendConnected: online });
    });

    return () => {
      unsubscribeFeed();
      unsubscribeMonitoring();
    };
  },
}));
