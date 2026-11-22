import { ObservedUAVState } from '../../types/monitoring';
import { FlightPlan } from '../../types/telemetry';
import { ResolutionAdjustment } from '../../types/tactical';
import { haversineDistanceMeters } from '../../utils/coordinates';
import { predictForwardPath } from '../prediction/TrajectoryPredictor';

export interface VuongOutboundLog {
  id: string;
  timestampUtc: string;
  eventType: 'monitoring.progress' | 'monitoring.decision';
  uavId: string;
  flightId: string;
  status: 'SENT' | 'ERROR';
  httpStatus?: number;
  summary: string;
  errorMessage?: string;
  payload: Record<string, unknown>;
}

export interface RouteProgressInfo {
  currentWaypointIndex: number;
  totalWaypoints: number;
  currentLegLabel: string;
  progressPercent: number;
}

/**
 * Computes current waypoint index, leg label, and progress % of an observed UAV along a FlightPlan.
 */
export function computeRouteProgress(uav: ObservedUAVState, plan?: FlightPlan): RouteProgressInfo {
  if (!plan || plan.waypoints.length < 2) {
    return {
      currentWaypointIndex: 0,
      totalWaypoints: 0,
      currentLegLabel: 'Bay tự do (chưa gắn kế hoạch)',
      progressPercent: 0,
    };
  }

  const wps = plan.waypoints;
  let closestIdx = 0;
  let minDist = Infinity;

  wps.forEach((wp, idx) => {
    const dist = haversineDistanceMeters(
      uav.position.latitude,
      uav.position.longitude,
      wp.latitude,
      wp.longitude
    );
    if (dist < minDist) {
      minDist = dist;
      closestIdx = idx;
    }
  });

  let totalDist = 0;
  let coveredDist = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const segLen = haversineDistanceMeters(
      wps[i].latitude,
      wps[i].longitude,
      wps[i + 1].latitude,
      wps[i + 1].longitude
    );
    totalDist += segLen;
    if (i < closestIdx) {
      coveredDist += segLen;
    }
  }

  const progressPercent =
    totalDist > 1 ? Math.min(100, Math.max(0, Math.round((coveredDist / totalDist) * 100))) : 0;

  const currentName = wps[closestIdx]?.name || `WP-${closestIdx + 1}`;
  const nextName = wps[Math.min(closestIdx + 1, wps.length - 1)]?.name || currentName;

  return {
    currentWaypointIndex: closestIdx + 1,
    totalWaypoints: wps.length,
    currentLegLabel:
      closestIdx < wps.length - 1 ? `${currentName} → ${nextName}` : `Đích ${currentName}`,
    progressPercent,
  };
}

/**
 * Formats periodic monitoring.progress JSON payload for Vuong's UTM Ops backend.
 */
export function buildVuongProgressPayload(
  uav: ObservedUAVState,
  plan?: FlightPlan
): Record<string, unknown> {
  const progress = computeRouteProgress(uav, plan);
  const flightId = plan?.plan_id || uav.flight_plan_id || 'UNLINKED';
  const prediction = predictForwardPath(uav, plan, 12, 2);
  const lastPredPoint =
    prediction.points.length > 1 ? prediction.points[prediction.points.length - 1] : null;
  const predictedNextPosition = lastPredPoint
    ? {
        latitude: Number(lastPredPoint.latitude.toFixed(6)),
        longitude: Number(lastPredPoint.longitude.toFixed(6)),
        altitudeM: Number(lastPredPoint.altitude_m.toFixed(1)),
        lookaheadSec: lastPredPoint.timeOffsetSec,
        latencyCompensatedSec: prediction.latencyCompensatedSec,
      }
    : null;

  return {
    schemaVersion: '1.0',
    eventType: 'monitoring.progress',
    timestampUtc: new Date().toISOString(),
    flightId,
    droneId: uav.uav_id,
    callsign: uav.callsign || uav.uav_id,
    currentPosition: {
      latitude: Number(uav.position.latitude.toFixed(6)),
      longitude: Number(uav.position.longitude.toFixed(6)),
      altitudeM: Number(uav.position.altitude_m.toFixed(1)),
      altitudeReference: uav.position.altitude_reference,
      groundSpeedMps: Number((uav.velocity.ground_speed_mps ?? 0).toFixed(1)),
      headingDeg: Math.round(uav.velocity.heading_deg ?? 0),
    },
    predictedNextPosition,
    routeProgress: {
      currentWaypointIndex: progress.currentWaypointIndex,
      totalWaypoints: progress.totalWaypoints,
      currentLegLabel: progress.currentLegLabel,
      progressPercent: progress.progressPercent,
      withinCorridor: uav.plan_deviation?.within_corridor ?? true,
      horizontalDeviationM: Number((uav.plan_deviation?.cross_track_error_m ?? 0).toFixed(1)),
      verticalDeviationM: Number((uav.plan_deviation?.vertical_deviation_m ?? 0).toFixed(1)),
    },
    linkQuality: {
      latencyMs: Math.round(uav.data_quality.latency_ms || 0),
      freshness: uav.data_quality.freshness,
    },
  };
}

/**
 * Formats immediate monitoring.decision JSON payload for Vuong's UTM Ops backend.
 */
export function buildVuongDecisionPayload(
  uavId: string,
  adjustment: ResolutionAdjustment,
  reason: string,
  flightId: string = 'UNLINKED',
  decisionStatus: 'PROPOSED' | 'APPROVED' | 'EXECUTING' | 'VERIFIED' = 'EXECUTING'
): Record<string, unknown> {
  let instructionSummary = 'Điều chỉnh quỹ đạo bay kết hợp';
  if (adjustment.action_type === 'ALTITUDE_CHANGE') {
    const delta = adjustment.altitude_delta_m ?? 30;
    instructionSummary = `Đổi độ cao ${delta >= 0 ? '+' : ''}${delta}m (mục tiêu ${adjustment.target_altitude_m}m)`;
  } else if (adjustment.action_type === 'HEADING_CHANGE') {
    const hdg = adjustment.heading_delta_deg ?? 35;
    instructionSummary = `Rẽ hướng ${hdg >= 0 ? '+' : ''}${hdg}°`;
  } else if (adjustment.action_type === 'SPEED_CHANGE') {
    const spd = adjustment.speed_delta_mps ?? 0;
    instructionSummary = `Điều chỉnh tốc độ ${spd >= 0 ? '+' : ''}${spd}m/s`;
  }

  return {
    schemaVersion: '1.0',
    eventType: 'monitoring.decision',
    timestampUtc: new Date().toISOString(),
    flightId,
    droneId: uavId,
    decisionStatus,
    actionType: adjustment.action_type,
    instructionSummary,
    parameters: {
      headingDeltaDeg: adjustment.heading_delta_deg,
      targetAltitudeM: adjustment.target_altitude_m,
      altitudeDeltaM: adjustment.altitude_delta_m,
      speedDeltaMps: adjustment.speed_delta_mps,
    },
    reason,
  };
}

/**
 * Posts outbound JSON payload to Vuong's endpoint with a 3-second AbortController timeout.
 */
export async function postToVuong(
  url: string,
  payload: Record<string, unknown>,
  apiKey?: string
): Promise<{ ok: boolean; httpStatus?: number; errorMessage?: string }> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-UTM-Integration-Key': apiKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        errorMessage: `HTTP ${response.status}`,
      };
    }

    return { ok: true, httpStatus: response.status };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'Timeout > 3s'
          : err.message
        : 'Lỗi kết nối';
    return { ok: false, errorMessage: message };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
