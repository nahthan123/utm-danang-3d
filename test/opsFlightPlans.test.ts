import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMonitoringStore } from '../src/stores/useMonitoringStore';
import { FlightPlan, UAVTelemetryMessage } from '../src/types/telemetry';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  close() { this.onclose?.({ code: 1000 }); }
  message(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

const plan: FlightPlan = {
  plan_id: 'ops-flight', uav_id: 'ops-drone', callsign: 'OPS-01', source: 'UTM_OPS',
  altitude_reference: 'AGL', status: 'SCHEDULED',
  departure_time_utc: '2027-01-01T02:00:00Z', estimated_arrival_time_utc: '2027-01-01T02:10:00Z',
  corridor_width_m: 50, altitude_corridor_m: 15, time_tolerance_s: 10,
  waypoints: [
    { id: 'WP1', name: 'A', latitude: 16.06, longitude: 108.22, altitude_m: 60,
      planned_time_utc: '2027-01-01T02:00:00Z', planned_speed_mps: 10 },
    { id: 'WP2', name: 'B', latitude: 16.065, longitude: 108.225, altitude_m: 60,
      planned_time_utc: '2027-01-01T02:10:00Z', planned_speed_mps: 10 },
  ],
};

describe('UTM Ops plans and independent live telemetry', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    useMonitoringStore.setState({ mode: 'DEMO', uavStates: {}, flightPlans: {}, alerts: [] });
  });
  afterEach(() => { useMonitoringStore.getState().cleanup(); vi.unstubAllGlobals(); });

  it('connects two sources, replaces the snapshot on reconnect, and never creates observed positions from plans', () => {
    useMonitoringStore.getState().setMode('LIVE');
    expect(FakeSocket.instances).toHaveLength(2);
    const [telemetry, ops] = FakeSocket.instances;
    expect(ops.url).toContain('/ws/flight-plans');
    ops.onopen?.();
    ops.message({ type: 'flight_plan.snapshot', payload: [plan] });
    expect(useMonitoringStore.getState().flightPlans[plan.plan_id]).toEqual(plan);
    expect(useMonitoringStore.getState().uavStates).toEqual({});
    telemetry.onerror?.();
    expect(useMonitoringStore.getState().opsConnectionStatus).toBe('CONNECTED');
    ops.message({ type: 'flight_plan.update', payload: { ...plan, status: 'CANCELLED' } });
    expect(useMonitoringStore.getState().flightPlans[plan.plan_id].status).toBe('CANCELLED');
    ops.message({ type: 'flight_plan.snapshot', payload: [] });
    expect(useMonitoringStore.getState().flightPlans).toEqual({});
    useMonitoringStore.getState().cleanup();
    ops.message({ type: 'flight_plan.snapshot', payload: [plan] });
    expect(useMonitoringStore.getState().flightPlans).toEqual({});
    expect(useMonitoringStore.getState().opsConnectionStatus).toBe('DISCONNECTED');
  });

  it('links actual telemetry to the approved plan and stops corridor checks after cancellation', () => {
    const store = useMonitoringStore.getState();
    store.ingestMessage({ type: 'flight_plan.update', payload: plan });
    const telemetry: UAVTelemetryMessage = {
      schema_version: '1.0', type: 'uav.telemetry', sequence: 1, uav_id: plan.uav_id,
      flight_plan_id: plan.plan_id, timestamp: plan.departure_time_utc, status: 'FLYING',
      position: { latitude: 16.06, longitude: 108.22, altitude_m: 60, altitude_reference: 'AGL' },
      velocity: { ground_speed_mps: 10, heading_deg: 45 },
    };
    store.ingestMessage(telemetry);
    expect(useMonitoringStore.getState().uavStates[plan.uav_id].plan_deviation?.within_corridor).toBe(true);
    expect(useMonitoringStore.getState().uavStates[plan.uav_id].position).toEqual(telemetry.position);
    store.ingestMessage({ type: 'flight_plan.update', payload: { ...plan, status: 'CANCELLED' } });
    store.ingestMessage({ ...telemetry, sequence: 2 });
    expect(useMonitoringStore.getState().uavStates[plan.uav_id].plan_deviation).toBeUndefined();
  });

  it('does not compare telemetry altitude against a different altitude datum', () => {
    const store = useMonitoringStore.getState();
    store.ingestMessage({ type: 'flight_plan.update', payload: { ...plan, altitude_reference: 'MSL' } });
    store.ingestMessage({
      schema_version: '1.0', type: 'uav.telemetry', sequence: 1, uav_id: plan.uav_id,
      flight_plan_id: plan.plan_id, timestamp: plan.departure_time_utc, status: 'FLYING',
      position: { latitude: 16.06, longitude: 108.22, altitude_m: 60, altitude_reference: 'AGL' },
      velocity: { ground_speed_mps: 10, heading_deg: 45 },
    });
    expect(useMonitoringStore.getState().uavStates[plan.uav_id].plan_deviation).toBeUndefined();
  });
});
