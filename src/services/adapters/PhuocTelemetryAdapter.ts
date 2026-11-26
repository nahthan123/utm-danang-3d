/**
 * PHUOC TELEMETRY ADAPTER (PART 2 SIMULATOR INTEGRATION)
 * Converts ASTM F3411 / Phuoc Simulator payloads to internal UTM Monitoring contracts.
 * 
 * STRICT PRINCIPLES:
 * 1. Do NOT convert AGL to MSL arbitrarily. Keep altitude_reference = 'AGL'.
 * 2. Do NOT treat internal receive sequence as source sequence.
 * 3. Clearly segregate received, inferred, and missing fields.
 * 4. Missing flight_plan_id means unlinked flight plan (do NOT fake deviation checks).
 * 5. Missing vertical_speed_mps is kept undefined (do NOT assume 0).
 */

import {
  UAVTelemetryMessage,
  UAVType,
  UAVPerformanceProfile,
  EnvironmentState,
  RestrictedZone,
  IngestibleMessage,
} from '../../types/telemetry';
import { DANANG_ENU_ORIGIN, enuToWgs84 } from '../../utils/coordinates';

export interface PhuocRawUavTelemetry {
  messageType?: string;
  sequence?: number;
  flightPlanId?: string;
  flight_plan_id?: string;
  timestamp?: string | number;
  ts?: string | number;
  time?: string | number;
  simulationTimeSec?: number;
  uav_id?: string;
  id?: string;
  drone_id?: string;
  system_id?: number;
  callsign?: string;
  // Exact nested PX4 / FastAPI bridge payload (ws://localhost:8000/ws/telemetry 10Hz)
  status?: {
    connected?: boolean;
    armed?: boolean;
    flight_mode?: string;
    landed_state?: string;
  };
  position?: {
    latitude?: number;
    longitude?: number;
    altitude_msl_m?: number;
    relative_altitude_m?: number;
    altitude_m?: number;
  };
  local_position?: {
    x_m?: number;
    y_m?: number;
    z_m?: number;
  };
  velocity?: {
    vx_m_s?: number;
    vy_m_s?: number;
    vz_m_s?: number;
    groundspeed_m_s?: number;
    climb_rate_m_s?: number;
  };
  attitude?: {
    roll_deg?: number;
    pitch_deg?: number;
    yaw_deg?: number;
    heading_deg?: number;
  };
  gps?: {
    fix_type?: number;
    satellites?: number;
  };
  timestamps?: {
    source_timestamp_ms?: number;
    backend_timestamp?: string;
  };
  // Flat PX4 / FastAPI WGS84 fields (fallback)
  lat?: number;
  lon?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  alt?: number;
  alt_msl?: number;
  altitude?: number;
  altitude_msl?: number;
  rel_alt?: number;
  relative_alt?: number;
  relative_altitude?: number;
  relative_altitude_m?: number;
  alt_rel?: number;
  altitude_agl?: number;
  heading?: number;
  heading_deg?: number;
  yaw?: number;
  yaw_deg?: number;
  speed?: number;
  ground_speed?: number;
  ground_speed_mps?: number;
  vz?: number;
  vertical_speed?: number;
  vertical_speed_mps?: number;
  battery?: number | { percent?: number; remaining_percent?: number; voltage?: number; voltage_v?: number };
  battery_pct?: number;
  batteryPercent?: number;
  battery_remaining?: number;
  mode?: string;
  flight_mode?: string;
  flightMode?: string;
  in_air?: boolean;
  is_in_air?: boolean;
  // Flat Gazebo local ENU fields
  x?: number;
  y?: number;
  z?: number;
  headingDeg?: number;
  speed_mps?: number;
  localPosition?: {
    x?: number;
    y?: number;
    z?: number;
  };
  uav?: {
    id?: string;
    callsign?: string;
    type?: string;
    position?: {
      longitude?: number;
      latitude?: number;
      altitudeAGL_m?: number;
      altitudeMSL_m?: number;
      x?: number;
      y?: number;
      z?: number;
    };
    movement?: {
      airSpeed_mps?: number;
      groundSpeed_mps?: number;
      headingDeg?: number;
      driftAngleDeg?: number;
      verticalSpeed_mps?: number;
    };
    system?: {
      batteryPercent?: number;
      flightMode?: string;
    };
  };
}

export interface PhuocFieldAnalysis {
  receivedFields: string[];
  inferredFields: string[];
  missingFields: string[];
  telemetry?: UAVTelemetryMessage;
  errors: string[];
}

export class PhuocTelemetryAdapter {
  // Internal receive sequence tracker per UAV (does NOT reflect packet drop from Phuoc)
  private static receiveSequenceMap: Map<string, number> = new Map();

  /**
   * Resets internal receive sequence tracker (useful for testing or session reset)
   */
  public static resetSequences(): void {
    this.receiveSequenceMap.clear();
  }

  /**
   * Identifies whether the raw payload matches external simulator (ASTM F3411 / Gazebo) telemetry structure
   */
  public static isPhuocTelemetry(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const obj = raw as Record<string, unknown>;

    // Matches messageType "UAV_TELEMETRY" or has uav object with position
    if (obj.messageType === 'UAV_TELEMETRY') return true;
    if (obj.uav && typeof obj.uav === 'object') {
      const uav = obj.uav as Record<string, unknown>;
      if (uav.position || uav.id) return true;
    }
    // Flat Gazebo / local-metric telemetry packet
    if (
      (typeof obj.uav_id === 'string' || typeof obj.id === 'string') &&
      ((typeof obj.x === 'number' && typeof obj.y === 'number') ||
        (obj.localPosition && typeof obj.localPosition === 'object'))
    ) {
      return true;
    }
    // Nested PX4 / FastAPI telemetry (ws://localhost:8000/ws/telemetry: top-level position + uav_id)
    if (
      obj.type !== 'uav.telemetry' &&
      obj.position &&
      typeof obj.position === 'object' &&
      typeof (obj.position as Record<string, unknown>).latitude === 'number' &&
      typeof (obj.position as Record<string, unknown>).longitude === 'number'
    ) {
      return true;
    }
    // Flat PX4 / FastAPI WGS84 stream (e.g., ws://localhost:8000/ws/telemetry 10Hz)
    if (
      obj.type !== 'uav.telemetry' &&
      ((typeof obj.lat === 'number' && (typeof obj.lon === 'number' || typeof obj.lng === 'number')) ||
        (typeof obj.latitude === 'number' && typeof obj.longitude === 'number'))
    ) {
      return true;
    }
    return false;
  }

  /**
   * Identifies whether raw payload is an Environment or Airspace restriction message
   */
  public static isPhuocEnvironment(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const obj = raw as Record<string, unknown>;
    return (
      obj.messageType === 'ENVIRONMENT_STATE' ||
      obj.messageType === 'ENVIRONMENT_STATUS' ||
      obj.messageType === 'AIRSPACE_RESTRICTIONS' ||
      Boolean(obj.environment || obj.weather || obj.restrictedZones)
    );
  }

  /**
   * Comprehensive analysis of Phuoc telemetry message, segregating received, inferred, and missing fields.
   */
  public static analyzeAndAdapt(raw: unknown): PhuocFieldAnalysis {
    const received: string[] = [];
    const inferred: string[] = [];
    const missing: string[] = [];
    const errors: string[] = [];

    if (!raw || typeof raw !== 'object') {
      return {
        receivedFields: [],
        inferredFields: [],
        missingFields: ['payload_object'],
        errors: ['Bản tin không phải là JSON object hợp lệ'],
      };
    }

    const p = raw as PhuocRawUavTelemetry;

    // Check messageType
    if (p.messageType) {
      received.push(`messageType: "${p.messageType}"`);
    } else {
      missing.push('messageType');
    }

    // Check timestamp (supports timestamps.backend_timestamp, ISO string, or numeric epoch seconds/ms)
    let finalTimestamp = new Date().toISOString();
    const rawTs = p.timestamps?.backend_timestamp ?? p.timestamp ?? p.ts ?? p.time;
    if (typeof rawTs === 'string') {
      const parsedTime = new Date(rawTs);
      if (!isNaN(parsedTime.getTime())) {
        finalTimestamp = rawTs;
        received.push(`timestamp: "${rawTs}"`);
      } else {
        errors.push(`Timestamp không hợp lệ: "${rawTs}"`);
      }
    } else if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
      const ms = rawTs < 1e12 ? rawTs * 1000 : rawTs;
      finalTimestamp = new Date(ms).toISOString();
      received.push(`timestamp(epoch): "${finalTimestamp}"`);
    } else {
      missing.push('timestamp');
      inferred.push(`timestamp (dùng thời gian nhận của bộ giám sát UTM: ${finalTimestamp})`);
    }

    // Simulation time in seconds (supports simulationTimeSec or timestamps.source_timestamp_ms)
    const derivedSimSec =
      typeof p.simulationTimeSec === 'number'
        ? p.simulationTimeSec
        : typeof p.timestamps?.source_timestamp_ms === 'number'
        ? Math.round((p.timestamps.source_timestamp_ms / 1000) * 1000) / 1000
        : undefined;
    if (typeof derivedSimSec === 'number') {
      received.push(`simulationTimeSec: ${derivedSimSec}s`);
    } else {
      missing.push('simulationTimeSec');
    }

    // Guard: ignore disconnected PX4 placeholder packets (e.g. status.connected === false before GPS lock)
    if (p.status && p.status.connected === false) {
      errors.push('UAV chưa kết nối tới autopilot (status.connected = false)');
      return { receivedFields: received, inferredFields: inferred, missingFields: missing, errors };
    }

    const nestedPx4Pos = p.position && typeof p.position === 'object' ? p.position : undefined;
    const flatLat = nestedPx4Pos?.latitude ?? p.lat ?? p.latitude;
    const flatLon = nestedPx4Pos?.longitude ?? p.lon ?? p.lng ?? p.longitude;
    const hasFlatOrPx4Wgs84 = typeof flatLat === 'number' && typeof flatLon === 'number';
    const flatRelAlt =
      nestedPx4Pos?.relative_altitude_m ??
      p.rel_alt ??
      p.relative_alt ??
      p.relative_altitude ??
      p.relative_altitude_m ??
      p.alt_rel ??
      p.altitude_agl;
    const flatMslAlt =
      nestedPx4Pos?.altitude_msl_m ??
      nestedPx4Pos?.altitude_m ??
      p.alt ??
      p.alt_msl ??
      p.altitude ??
      p.altitude_msl;
    const flatHeading =
      p.attitude?.heading_deg ??
      p.attitude?.yaw_deg ??
      p.headingDeg ??
      p.heading_deg ??
      p.heading ??
      p.yaw_deg ??
      p.yaw;
    const flatSpeed =
      p.velocity?.groundspeed_m_s ??
      (typeof p.velocity?.vx_m_s === 'number' && typeof p.velocity?.vy_m_s === 'number'
        ? Math.hypot(p.velocity.vx_m_s, p.velocity.vy_m_s)
        : undefined) ??
      p.ground_speed_mps ??
      p.ground_speed ??
      p.speed_mps ??
      p.speed;
    const flatVz =
      p.velocity?.climb_rate_m_s ??
      (typeof p.velocity?.vz_m_s === 'number' ? -p.velocity.vz_m_s : undefined) ??
      p.vertical_speed_mps ??
      p.vertical_speed ??
      p.vz;
    const flatBattery =
      typeof p.battery === 'number'
        ? p.battery
        : typeof p.battery === 'object' && p.battery !== null
        ? p.battery.remaining_percent ?? p.battery.percent
        : p.batteryPercent ?? p.battery_pct ?? p.battery_remaining;
    const flatMode = p.status?.flight_mode ?? p.flightMode ?? p.flight_mode ?? p.mode;

    if (hasFlatOrPx4Wgs84 && typeof flatRelAlt === 'number' && typeof flatMslAlt === 'number') {
      received.push(`position.altitude_msl_m: ${flatMslAlt}m (MSL gốc song song với relative_altitude_m)`);
    }
    if (typeof p.battery === 'object' && p.battery !== null && typeof p.battery.voltage_v === 'number') {
      received.push(`battery.voltage_v: ${p.battery.voltage_v}V`);
    }
    if (p.gps && typeof p.gps === 'object') {
      received.push(`gps: fix_type=${p.gps.fix_type ?? '?'}, satellites=${p.gps.satellites ?? '?'}`);
    }
    if (p.attitude && typeof p.attitude === 'object') {
      received.push(
        `attitude: roll=${p.attitude.roll_deg ?? 0}°, pitch=${p.attitude.pitch_deg ?? 0}°, yaw=${p.attitude.yaw_deg ?? 0}°`
      );
    }
    if (p.status?.landed_state) {
      received.push(`status.landed_state: "${p.status.landed_state}"`);
    }

    const flatDefaultId = !p.uav && hasFlatOrPx4Wgs84 && !p.uav_id && !p.id && !p.drone_id;
    if (flatDefaultId) {
      inferred.push('uav.id (mặc định "UAV-PX4-01" cho luồng đơn PX4/FastAPI)');
    }

    const u = p.uav || {
      id: p.uav_id || p.id || p.drone_id || (hasFlatOrPx4Wgs84 ? 'UAV-PX4-01' : undefined),
      callsign:
        p.callsign ||
        (hasFlatOrPx4Wgs84
          ? typeof p.system_id === 'number'
            ? `PX4-SYS-${p.system_id}`
            : 'PX4-SITL-LIVE'
          : undefined),
      position: hasFlatOrPx4Wgs84
        ? {
            latitude: flatLat,
            longitude: flatLon,
            altitudeAGL_m: typeof flatRelAlt === 'number' ? Math.max(0, flatRelAlt) : undefined,
            altitudeMSL_m: typeof flatRelAlt !== 'number' && typeof flatMslAlt === 'number' ? flatMslAlt : undefined,
          }
        : p.localPosition
        ? { x: p.localPosition.x, y: p.localPosition.y, z: p.localPosition.z, altitudeAGL_m: p.localPosition.z }
        : typeof p.x === 'number' && typeof p.y === 'number'
        ? { x: p.x, y: p.y, z: p.z, altitudeAGL_m: p.z }
        : undefined,
      movement:
        typeof flatSpeed === 'number' || typeof flatHeading === 'number' || typeof flatVz === 'number'
          ? {
              groundSpeed_mps: flatSpeed ?? 0,
              headingDeg: flatHeading ?? 0,
              verticalSpeed_mps: flatVz,
            }
          : undefined,
      system:
        typeof flatBattery === 'number' || flatMode
          ? {
              batteryPercent: flatBattery,
              flightMode: flatMode,
            }
          : undefined,
    };

    if (!u || (!u.id && !u.position)) {
      errors.push("Thiếu đối tượng 'uav' trong bản tin");
      return { receivedFields: received, inferredFields: inferred, missingFields: missing, errors };
    }

    // UAV ID
    if (!u.id || typeof u.id !== 'string') {
      errors.push("Thiếu trường 'uav.id'");
    } else {
      received.push(`uav.id: "${u.id}"`);
    }

    // Callsign
    if (u.callsign) {
      received.push(`uav.callsign: "${u.callsign}"`);
    } else {
      missing.push('uav.callsign');
    }

    // UAV Type
    let mappedType: UAVType = 'MULTIROTOR';
    if (u.type) {
      received.push(`uav.type: "${u.type}"`);
      const lowerType = u.type.toLowerCase();
      if (lowerType.includes('fixed') || lowerType.includes('wing')) {
        mappedType = 'FIXED_WING';
      } else if (lowerType.includes('vtol')) {
        mappedType = 'VTOL';
      } else {
        mappedType = 'MULTIROTOR';
      }
    } else {
      missing.push('uav.type');
      inferred.push('uav.type (suy ra mặc định MULTIROTOR)');
    }

    // Position (Supports both WGS84 lat/lon and Gazebo local ENU x/y/z)
    if (!u.position) {
      errors.push("Thiếu đối tượng 'uav.position'");
      return { receivedFields: received, inferredFields: inferred, missingFields: missing, errors };
    }

    const pos = u.position;
    let finalLat = pos.latitude;
    let finalLon = pos.longitude;
    let altitudeM = 0;
    let altitudeRef: 'AGL' | 'MSL' = 'AGL';

    const hasWgs84 = typeof pos.latitude === 'number' && typeof pos.longitude === 'number';
    const hasLocalEnu = typeof pos.x === 'number' && typeof pos.y === 'number';

    if (hasWgs84) {
      if (pos.latitude! < -90 || pos.latitude! > 90) {
        errors.push(`Vĩ độ (latitude) không hợp lệ: ${pos.latitude}`);
      } else {
        received.push(`uav.position.latitude: ${pos.latitude}`);
      }

      if (pos.longitude! < -180 || pos.longitude! > 180) {
        errors.push(`Kinh độ (longitude) không hợp lệ: ${pos.longitude}`);
      } else {
        received.push(`uav.position.longitude: ${pos.longitude}`);
      }
    } else if (hasLocalEnu) {
      const localZ =
        typeof pos.altitudeAGL_m === 'number'
          ? pos.altitudeAGL_m
          : typeof pos.z === 'number'
          ? pos.z
          : 0;
      const converted = enuToWgs84(pos.x!, pos.y!, localZ, DANANG_ENU_ORIGIN);
      finalLat = converted.latitude;
      finalLon = converted.longitude;
      received.push(`local_enu: (x=${pos.x}m, y=${pos.y}m)`);
      inferred.push(
        `WGS84 quy đổi từ Gazebo ENU quanh tâm Đà Nẵng (${finalLat}, ${finalLon})`
      );
    } else {
      errors.push("Thiếu tọa độ 'latitude/longitude' hoặc tọa độ cục bộ 'x/y'");
    }

    // Altitude: AGL vs MSL (or local Z)
    if (typeof pos.altitudeAGL_m === 'number') {
      altitudeM = pos.altitudeAGL_m;
      altitudeRef = 'AGL';
      received.push(`uav.position.altitudeAGL_m: ${pos.altitudeAGL_m}m (AGL)`);
    } else if (typeof pos.altitudeMSL_m === 'number') {
      altitudeM = pos.altitudeMSL_m;
      altitudeRef = 'MSL';
      received.push(`uav.position.altitudeMSL_m: ${pos.altitudeMSL_m}m (MSL)`);
    } else if (hasLocalEnu && typeof pos.z === 'number') {
      altitudeM = pos.z;
      altitudeRef = 'AGL';
      received.push(`local_enu.z: ${pos.z}m (AGL)`);
    } else {
      missing.push('uav.position.altitudeAGL_m (hoặc altitudeMSL_m)');
      errors.push('Thiếu thông số độ cao (altitudeAGL_m)');
    }

    // Movement (Ground speed, heading, air speed, drift angle)
    let groundSpeedMps = 0;
    let headingDeg = 0;
    let airSpeedMps: number | undefined = undefined;
    let driftAngleDeg: number | undefined = undefined;
    let verticalSpeedMps: number | undefined = undefined;

    if (u.movement) {
      const mov = u.movement;
      if (typeof mov.groundSpeed_mps === 'number' && mov.groundSpeed_mps >= 0) {
        groundSpeedMps = mov.groundSpeed_mps;
        received.push(`uav.movement.groundSpeed_mps: ${mov.groundSpeed_mps} m/s`);
      } else {
        missing.push('uav.movement.groundSpeed_mps');
      }

      if (typeof mov.headingDeg === 'number') {
        headingDeg = (mov.headingDeg % 360 + 360) % 360;
        received.push(`uav.movement.headingDeg: ${mov.headingDeg}°`);
      } else {
        missing.push('uav.movement.headingDeg');
      }

      if (typeof mov.airSpeed_mps === 'number') {
        airSpeedMps = mov.airSpeed_mps;
        received.push(`uav.movement.airSpeed_mps: ${mov.airSpeed_mps} m/s`);
      }

      if (typeof mov.driftAngleDeg === 'number') {
        driftAngleDeg = mov.driftAngleDeg;
        received.push(`uav.movement.driftAngleDeg: ${mov.driftAngleDeg}°`);
      }

      if (typeof mov.verticalSpeed_mps === 'number') {
        verticalSpeedMps = mov.verticalSpeed_mps;
        received.push(`uav.movement.verticalSpeed_mps: ${mov.verticalSpeed_mps} m/s`);
      } else {
        // STRICT: Do NOT fake vertical speed as 0
        missing.push('uav.movement.verticalSpeed_mps (không tự giả định bằng 0)');
      }
    } else {
      missing.push('uav.movement (groundSpeed, heading)');
      missing.push('uav.movement.vertical_speed_mps (không tự giả định bằng 0)');
      inferred.push('uav.movement (giả định groundSpeed=0, heading=0)');
    }

    // System (battery, flight mode)
    let batteryPct: number | undefined = undefined;
    let flightMode: string | undefined = undefined;

    if (u.system) {
      if (typeof u.system.batteryPercent === 'number') {
        batteryPct = Math.min(100, Math.max(0, u.system.batteryPercent));
        received.push(`uav.system.batteryPercent: ${batteryPct}%`);
      }
      if (u.system.flightMode) {
        flightMode = u.system.flightMode;
        received.push(`uav.system.flightMode: "${flightMode}"`);
      }
    } else {
      missing.push('uav.system (batteryPercent, flightMode)');
    }

    // Sequence & Flight Plan checks
    let currentSeq: number;
    let isInferredSequence = true;
    if (typeof p.sequence === 'number' && Number.isInteger(p.sequence) && p.sequence >= 0) {
      currentSeq = p.sequence;
      isInferredSequence = false;
      received.push(`sequence: ${currentSeq} (nguồn)`);
    } else {
      missing.push('sequence (bản tin chưa có số thứ tự nguồn)');
      currentSeq = (this.receiveSequenceMap.get(u.id || 'UNKNOWN') || 0) + 1;
      this.receiveSequenceMap.set(u.id || 'UNKNOWN', currentSeq);
      inferred.push(`sequence (gán số thứ tự tiếp nhận nội bộ receive_sequence = ${currentSeq})`);
    }

    const resolvedFlightPlanId = p.flightPlanId || p.flight_plan_id;
    if (resolvedFlightPlanId && typeof resolvedFlightPlanId === 'string') {
      received.push(`flightPlanId: "${resolvedFlightPlanId}"`);
    } else {
      missing.push('flight_plan_id (chưa liên kết kế hoạch 4D)');
    }
    missing.push('schema_version');

    // Inferred status
    let inferredStatus: UAVTelemetryMessage['status'] = 'UNKNOWN';
    const upperMode = flightMode ? flightMode.toUpperCase() : '';
    const landedState = p.status?.landed_state ? p.status.landed_state.toUpperCase() : '';
    const inAirFlag = p.in_air ?? p.is_in_air ?? (landedState ? landedState === 'IN_AIR' : undefined);

    if (landedState === 'ON_GROUND' || inAirFlag === false) {
      inferredStatus = 'IDLE';
      inferred.push("status (suy ra 'IDLE' do đang ở mặt đất ON_GROUND)");
    } else if (landedState === 'TAKING_OFF' || upperMode.includes('TAKEOFF')) {
      inferredStatus = 'TAKEOFF';
      inferred.push("status (suy ra 'TAKEOFF' từ trạng thái cất cánh)");
    } else if (landedState === 'LANDING' || upperMode.includes('LAND')) {
      inferredStatus = 'LANDING';
      inferred.push("status (suy ra 'LANDING' từ trạng thái hạ cánh)");
    } else if (upperMode.includes('HOLD') || upperMode.includes('LOITER')) {
      inferredStatus = groundSpeedMps > 1.0 ? 'FLYING' : 'HOVER';
      inferred.push(`status (suy ra '${inferredStatus}' từ flightMode '${flightMode}')`);
    } else if (upperMode.includes('CONTROL') || upperMode.includes('MISSION') || upperMode.includes('OFFBOARD')) {
      inferredStatus = groundSpeedMps > 0.5 ? 'FLYING' : 'HOVER';
      inferred.push(`status (suy ra '${inferredStatus}' từ flightMode và groundSpeed)`);
    } else if (groundSpeedMps > 0.5) {
      inferredStatus = 'FLYING';
      inferred.push(`status (suy ra 'FLYING' do groundSpeed > 0)`);
    } else if (inAirFlag === true || altitudeM > 1.0) {
      inferredStatus = 'HOVER';
      inferred.push("status (suy ra 'HOVER' do đang trên không)");
    } else {
      inferredStatus = 'UNKNOWN';
    }

    if (errors.length > 0) {
      return { receivedFields: received, inferredFields: inferred, missingFields: missing, errors };
    }

    // Create normalized UAVPerformanceProfile based on mapped type
    const uavProfile: UAVPerformanceProfile = {
      uav_type: mappedType,
      model_name: u.callsign ? `${u.callsign} (${mappedType})` : `External ${mappedType} UAV`,
      manufacturer: 'External SITL / Gazebo Simulator',
      dimensions_m: mappedType === 'FIXED_WING' 
        ? { length: 2.1, wingspan_or_diameter: 3.2, height: 0.5 }
        : mappedType === 'VTOL'
        ? { length: 1.8, wingspan_or_diameter: 2.8, height: 0.6 }
        : { length: 0.8, wingspan_or_diameter: 0.9, height: 0.4 },
      mtow_kg: mappedType === 'FIXED_WING' ? 18.0 : mappedType === 'VTOL' ? 15.0 : 9.0,
      max_ground_speed_mps: Math.max(25, groundSpeedMps * 1.3),
      cruise_speed_mps: groundSpeedMps > 0 ? groundSpeedMps : 15,
      max_climb_rate_mps: 6.0,
      max_descent_rate_mps: 5.0,
      max_turn_rate_deg_s: mappedType === 'FIXED_WING' ? 35 : 90,
      max_flight_time_min: mappedType === 'FIXED_WING' ? 120 : 45,
      battery_capacity_mah: batteryPct ? batteryPct * 60 : undefined,
    };

    const telemetry: UAVTelemetryMessage = {
      schema_version: '1.0-external-adapter',
      type: 'uav.telemetry',
      sequence: currentSeq,
      is_inferred_sequence: isInferredSequence,
      timestamp: finalTimestamp,
      message_created_at: finalTimestamp,
      simulation_time_sec: derivedSimSec,
      uav_id: u.id!,
      callsign: u.callsign,
      flight_plan_id: resolvedFlightPlanId,
      position: {
        latitude: finalLat!,
        longitude: finalLon!,
        altitude_m: altitudeM,
        altitude_reference: altitudeRef, // Preserves AGL strictly
      },
      velocity: {
        ground_speed_mps: groundSpeedMps,
        vertical_speed_mps: verticalSpeedMps,
        heading_deg: headingDeg,
        air_speed_mps: airSpeedMps,
        drift_angle_deg: driftAngleDeg,
      },
      status: inferredStatus,
      flight_mode: flightMode,
      battery_pct: batteryPct,
      uav_profile: uavProfile,
      data_source_format: 'PHUOC_ASTM_F3411',
    };

    return {
      receivedFields: received,
      inferredFields: inferred,
      missingFields: missing,
      telemetry,
      errors: [],
    };
  }

  /**
   * Adapts raw Phuoc message (telemetry, environment, or airspace) into IngestibleMessage or array of messages
   */
  public static adapt(raw: unknown): IngestibleMessage | IngestibleMessage[] | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;

    // 1. Telemetry branch
    if (this.isPhuocTelemetry(raw)) {
      const analysis = this.analyzeAndAdapt(raw);
      if (analysis.telemetry && analysis.errors.length === 0) {
        return analysis.telemetry;
      }
      return null;
    }

    // 2. Environment / Airspace branch
    if (
      obj.messageType === 'ENVIRONMENT_STATE' ||
      obj.messageType === 'ENVIRONMENT_STATUS' ||
      obj.environment
    ) {
      const results: IngestibleMessage[] = [];
      const envData = (obj.environment || obj) as Record<string, unknown>;
      const windObj = (envData.wind || {}) as Record<string, unknown>;
      
      const windSpeed = typeof envData.windSpeed_mps === 'number'
        ? envData.windSpeed_mps
        : typeof windObj.speed_mps === 'number'
        ? windObj.speed_mps
        : 0;
      const windDir = typeof envData.windDirectionDeg === 'number'
        ? envData.windDirectionDeg
        : typeof windObj.directionDeg === 'number'
        ? windObj.directionDeg
        : 0;

      const envState: EnvironmentState = {
        timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
        wind_speed_mps: windSpeed,
        wind_direction_deg: windDir,
        temperature_c: typeof envData.temperatureC === 'number' ? envData.temperatureC : 28,
        visibility_km: typeof envData.visibilityKm === 'number' ? envData.visibilityKm : 10,
        weather_condition: (typeof envData.weatherCondition === 'string' && ['CLEAR','CLOUDY','RAIN','HIGH_WIND','FOG'].includes(envData.weatherCondition)) 
          ? (envData.weatherCondition as EnvironmentState['weather_condition'])
          : 'CLEAR',
      };
      results.push({ type: 'environment.state', payload: envState });

      // Unpack nested restricted zones from Phuoc's environment packet if present
      if (Array.isArray(envData.restrictedZones)) {
        for (const rz of envData.restrictedZones as Array<Record<string, unknown>>) {
          const altLimits = (rz.altitudeLimits || {}) as Record<string, unknown>;
          const minAlt = typeof altLimits.minAltitudeAGL_m === 'number' 
            ? altLimits.minAltitudeAGL_m 
            : typeof rz.minAltitude === 'number' 
            ? rz.minAltitude 
            : 0;
          const maxAlt = typeof altLimits.maxAltitudeAGL_m === 'number' 
            ? altLimits.maxAltitudeAGL_m 
            : typeof rz.maxAltitude === 'number' 
            ? rz.maxAltitude 
            : 500;

          const boundary: Array<{ latitude: number; longitude: number }> = [];
          const polygonCoords = rz.boundaryPolygonCoordinates || rz.polygonFlat;
          if (Array.isArray(polygonCoords)) {
            const coords = polygonCoords as number[];
            for (let i = 0; i < coords.length; i += 2) {
              if (coords[i + 1] !== undefined) {
                // Phuoc coordinates in polygonFlat are [lon, lat]
                boundary.push({ longitude: coords[i], latitude: coords[i + 1] });
              }
            }
          }

          if (boundary.length >= 3) {
            results.push({
              type: 'zone.update',
              payload: {
                zone_id: String(rz.zoneId || rz.id || `NFZ-PHUOC-${Date.now()}`),
                name: String(rz.name || 'Vùng cấm bay'),
                type: 'NFZ_AIRPORT',
                min_altitude_m: minAlt,
                max_altitude_m: maxAlt,
                boundary,
                color: (typeof rz.color === 'string') ? rz.color : '#ef4444',
                active: true,
                notes: 'Đồng bộ từ nguồn mô phỏng ngoài (External Simulator)',
              },
            });
          }
        }
      }

      return results.length === 1 ? results[0] : results;
    }

    // 3. Airspace restrictions standalone branch
    if (obj.messageType === 'AIRSPACE_RESTRICTIONS' || obj.restrictedZones) {
      const zoneData = (obj.zone || obj) as Record<string, unknown>;
      if (zoneData.boundary && Array.isArray(zoneData.boundary)) {
        const zone: RestrictedZone = {
          zone_id: String(zoneData.zone_id || zoneData.id || `NFZ-EXT-${Date.now()}`),
          name: String(zoneData.name || 'Vùng cấm bay từ nguồn ngoài'),
          type: 'NFZ_AIRPORT',
          min_altitude_m: typeof zoneData.min_altitude_m === 'number' ? zoneData.min_altitude_m : 0,
          max_altitude_m: typeof zoneData.max_altitude_m === 'number' ? zoneData.max_altitude_m : 500,
          boundary: zoneData.boundary as Array<{ latitude: number; longitude: number }>,
          color: '#ef4444',
          active: true,
          notes: 'Cập nhật từ nguồn không phận thời gian thực',
        };
        return { type: 'zone.update', payload: zone };
      }
    }

    return null;
  }
}

export const ExternalTelemetryAdapter = PhuocTelemetryAdapter;
