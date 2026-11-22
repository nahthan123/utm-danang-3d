import { describe, it, expect } from 'vitest';
import { predictForwardPath } from '../src/services/prediction/TrajectoryPredictor';
import {
  buildVuongDecisionPayload,
  buildVuongProgressPayload,
  computeRouteProgress,
} from '../src/services/dispatch/VuongOutboundService';
import { ObservedUAVState } from '../src/types/monitoring';
import { FlightPlan } from '../src/types/telemetry';
import { haversineDistanceMeters } from '../src/utils/coordinates';

function makeUav(overrides: Partial<ObservedUAVState> = {}): ObservedUAVState {
  return {
    uav_id: 'uav-1',
    flight_plan_id: 'plan-1',
    callsign: 'UAV-01',
    status: 'FLYING',
    position: {
      latitude: 16.0612,
      longitude: 108.2245,
      altitude_m: 80,
      altitude_reference: 'AGL',
    },
    velocity: {
      ground_speed_mps: 12,
      vertical_speed_mps: 0,
      heading_deg: 90,
    },
    timestamp: '2026-11-23T04:00:00Z',
    data_quality: {
      freshness: 'FRESH',
      confidence: 'HIGH',
      sim_time_utc: '2026-11-23T04:00:00Z',
      message_created_at_utc: '2026-11-23T04:00:00Z',
      received_at_wall_clock_utc: '2026-11-23T04:00:00Z',
      freshness_age_ms: 100,
      latency_ms: 500,
      last_sequence: 1,
      sequence_gap_count: 0,
      out_of_order_count: 0,
      is_stale: false,
      is_lost: false,
      is_invalid: false,
    },
    trail: [],
    ...overrides,
  };
}

const samplePlan: FlightPlan = {
  plan_id: 'plan-1',
  source: 'UTM_OPS',
  altitude_reference: 'AGL',
  uav_id: 'uav-1',
  callsign: 'UAV-01',
  departure_time_utc: '2026-11-23T04:00:00Z',
  estimated_arrival_time_utc: '2026-11-23T04:05:00Z',
  status: 'ACTIVE',
  corridor_width_m: 50,
  altitude_corridor_m: 15,
  time_tolerance_s: 10,
  waypoints: [
    {
      id: 'wp-1',
      name: 'Cầu Rồng Tây',
      latitude: 16.0612,
      longitude: 108.2225,
      altitude_m: 80,
      planned_time_utc: '2026-11-23T04:00:00Z',
      planned_speed_mps: 12,
    },
    {
      id: 'wp-2',
      name: 'Cầu Rồng Đông',
      latitude: 16.0612,
      longitude: 108.2265,
      altitude_m: 80,
      planned_time_utc: '2026-11-23T04:02:30Z',
      planned_speed_mps: 12,
    },
    {
      id: 'wp-3',
      name: 'Sông Hàn',
      latitude: 16.0712,
      longitude: 108.2265,
      altitude_m: 85,
      planned_time_utc: '2026-11-23T04:05:00Z',
      planned_speed_mps: 12,
    },
  ],
};

describe('TrajectoryPredictor & VuongOutboundService (Lean MVP)', () => {
  it('projects forward "- - - -" points along heading & clamps latency compensation <= 2.0s', () => {
    const uavHighLatency = makeUav({
      data_quality: {
        ...makeUav().data_quality,
        latency_ms: 4800,
      },
    });

    const pred = predictForwardPath(uavHighLatency, samplePlan, 12, 2);

    expect(pred.isPreFlight).toBe(false);
    expect(pred.latencyCompensatedSec).toBe(2.0);
    expect(pred.points.length).toBe(7); // 0s, 2s, 4s, 6s, 8s, 10s, 12s
    expect(pred.points[0].latitude).toBeCloseTo(16.0612, 6);
    expect(pred.points[0].longitude).toBeCloseTo(108.2245, 6);

    // Heading 90 (East) -> longitude increases monotonically; distance at 12s+2s clamp ~ 168m
    expect(pred.points[pred.points.length - 1].longitude).toBeGreaterThan(pred.points[0].longitude);
    const totalDist = haversineDistanceMeters(
      pred.points[0].latitude,
      pred.points[0].longitude,
      pred.points[pred.points.length - 1].latitude,
      pred.points[pred.points.length - 1].longitude
    );
    expect(totalDist).toBeGreaterThan(150);
    expect(totalDist).toBeLessThan(185);
  });

  it('stops extrapolating when link quality is STALE or LOST', () => {
    const staleUav = makeUav({
      data_quality: { ...makeUav().data_quality, freshness: 'STALE', is_stale: true },
    });
    const lostUav = makeUav({
      data_quality: { ...makeUav().data_quality, freshness: 'LOST', is_lost: true },
    });

    expect(predictForwardPath(staleUav, samplePlan).points).toEqual([]);
    expect(predictForwardPath(lostUav, samplePlan).points).toEqual([]);
  });

  it('produces pre-flight 5-point dashed preview when UAV is PREFLIGHT/IDLE with linked plan', () => {
    const groundUav = makeUav({
      status: 'PREFLIGHT',
      position: { latitude: 16.0612, longitude: 108.2225, altitude_m: 2, altitude_reference: 'AGL' },
      velocity: { ground_speed_mps: 0, vertical_speed_mps: 0, heading_deg: 90 },
    });

    const pred = predictForwardPath(groundUav, samplePlan);

    expect(pred.isPreFlight).toBe(true);
    expect(pred.latencyCompensatedSec).toBe(0);
    expect(pred.points).toHaveLength(5);
    expect(pred.points[4].longitude).toBeGreaterThan(pred.points[0].longitude);
  });

  it('supports independent forward predictions for >= 2 UAVs simultaneously', () => {
    const uav1 = makeUav({
      uav_id: 'uav-1',
      velocity: { ground_speed_mps: 14, vertical_speed_mps: 0, heading_deg: 90 }, // East
    });
    const uav2 = makeUav({
      uav_id: 'uav-2',
      position: { latitude: 16.062, longitude: 108.228, altitude_m: 85, altitude_reference: 'AGL' },
      velocity: { ground_speed_mps: 15, vertical_speed_mps: 0, heading_deg: 270 }, // West
    });

    const pred1 = predictForwardPath(uav1);
    const pred2 = predictForwardPath(uav2);

    expect(pred1.uavId).toBe('uav-1');
    expect(pred2.uavId).toBe('uav-2');
    expect(pred1.points[pred1.points.length - 1].longitude).toBeGreaterThan(pred1.points[0].longitude);
    expect(pred2.points[pred2.points.length - 1].longitude).toBeLessThan(pred2.points[0].longitude);
  });

  it('formats Vuong progress & decision payloads with schemaVersion 1.0 and route metrics', () => {
    const uavAtWp2 = makeUav({
      position: { latitude: 16.0612, longitude: 108.2265, altitude_m: 80, altitude_reference: 'AGL' },
    });

    const routeInfo = computeRouteProgress(uavAtWp2, samplePlan);
    expect(routeInfo.currentWaypointIndex).toBe(2);
    expect(routeInfo.totalWaypoints).toBe(3);
    expect(routeInfo.progressPercent).toBeGreaterThan(0);

    const progressPayload = buildVuongProgressPayload(uavAtWp2, samplePlan);
    expect(progressPayload.schemaVersion).toBe('1.0');
    expect(progressPayload.eventType).toBe('monitoring.progress');
    expect(progressPayload.flightId).toBe('plan-1');
    expect(progressPayload.droneId).toBe('uav-1');
    const predNext = progressPayload.predictedNextPosition as {
      latitude: number;
      longitude: number;
      altitudeM: number;
      lookaheadSec: number;
    };
    expect(predNext).toBeTruthy();
    expect(predNext.lookaheadSec).toBe(12);
    expect(predNext.longitude).toBeGreaterThan(uavAtWp2.position.longitude);
    expect(predNext.altitudeM).toBe(80);

    const decisionPayload = buildVuongDecisionPayload(
      'uav-1',
      { action_type: 'HEADING_CHANGE', heading_delta_deg: 35 },
      'Tránh cắt mặt uav-2 tại Cầu Rồng',
      'plan-1'
    );
    expect(decisionPayload.schemaVersion).toBe('1.0');
    expect(decisionPayload.eventType).toBe('monitoring.decision');
    expect(decisionPayload.actionType).toBe('HEADING_CHANGE');
    expect(String(decisionPayload.instructionSummary)).toContain('+35°');
  });
});
