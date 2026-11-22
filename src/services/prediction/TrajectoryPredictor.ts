import { ObservedUAVState } from '../../types/monitoring';
import { FlightPlan } from '../../types/telemetry';
import { enuToWgs84, toRadians, wgs84ToEnu } from '../../utils/coordinates';

export interface PredictedPoint {
  timeOffsetSec: number;
  latitude: number;
  longitude: number;
  altitude_m: number;
}

export interface UAVForwardPrediction {
  uavId: string;
  isPreFlight: boolean;
  latencyCompensatedSec: number;
  points: PredictedPoint[];
}

/**
 * Projects a minimal forward "- - - -" dashed trajectory ahead of an observed UAV,
 * supporting pre-flight preview, clamped latency compensation (<= 2.0s),
 * and safe shutoff on STALE / LOST links.
 */
export function predictForwardPath(
  uav: ObservedUAVState,
  linkedPlan?: FlightPlan,
  lookaheadSeconds: number = 12,
  stepSeconds: number = 2
): UAVForwardPrediction {
  if (uav.data_quality.freshness === 'STALE' || uav.data_quality.freshness === 'LOST') {
    return {
      uavId: uav.uav_id,
      isPreFlight: false,
      latencyCompensatedSec: 0,
      points: [],
    };
  }

  const speed = uav.velocity.ground_speed_mps ?? 0;

  if (
    (uav.status === 'IDLE' || uav.status === 'PREFLIGHT' || speed < 0.8) &&
    linkedPlan &&
    linkedPlan.waypoints.length >= 2
  ) {
    const wp0 = linkedPlan.waypoints[0];
    const wp1 = linkedPlan.waypoints[1];
    const p0 = wgs84ToEnu(wp0.latitude, wp0.longitude, wp0.altitude_m);
    const p1 = wgs84ToEnu(wp1.latitude, wp1.longitude, wp1.altitude_m);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const segDist = Math.max(1, Math.hypot(dx, dy));
    const maxScale = Math.min(1, 200 / segDist);
    const baseAlt = Math.max(0, uav.position.altitude_m);

    const points: PredictedPoint[] = [];
    const totalPoints = 5;
    for (let i = 0; i < totalPoints; i++) {
      const frac = (i / (totalPoints - 1)) * maxScale;
      const geo = enuToWgs84(
        p0.x + dx * frac,
        p0.y + dy * frac,
        Math.max(baseAlt, p0.z + dz * frac)
      );
      points.push({
        timeOffsetSec: i * stepSeconds,
        latitude: geo.latitude,
        longitude: geo.longitude,
        altitude_m: Math.max(0, geo.altitude_m),
      });
    }

    return {
      uavId: uav.uav_id,
      isPreFlight: true,
      latencyCompensatedSec: 0,
      points,
    };
  }

  const latencySec = Math.min(2.0, Math.max(0, (uav.data_quality.latency_ms ?? 0) / 1000));
  const headingRad = toRadians(uav.velocity.heading_deg ?? 0);
  const vx = speed * Math.sin(headingRad);
  const vy = speed * Math.cos(headingRad);
  const vz = uav.velocity.vertical_speed_mps ?? 0;

  const origin = {
    latitude: uav.position.latitude,
    longitude: uav.position.longitude,
    altitude_m: uav.position.altitude_m,
  };

  const points: PredictedPoint[] = [
    {
      timeOffsetSec: 0,
      latitude: origin.latitude,
      longitude: origin.longitude,
      altitude_m: Math.max(0, origin.altitude_m),
    },
  ];

  const safeStep = Math.max(0.5, stepSeconds);
  for (let t = safeStep; t <= lookaheadSeconds + 0.0001; t += safeStep) {
    const effectiveT = t + latencySec;
    const geo = enuToWgs84(vx * effectiveT, vy * effectiveT, vz * effectiveT, origin);
    points.push({
      timeOffsetSec: Number(t.toFixed(1)),
      latitude: geo.latitude,
      longitude: geo.longitude,
      altitude_m: Math.max(0, geo.altitude_m),
    });
  }

  return {
    uavId: uav.uav_id,
    isPreFlight: false,
    latencyCompensatedSec: Number(latencySec.toFixed(3)),
    points,
  };
}
