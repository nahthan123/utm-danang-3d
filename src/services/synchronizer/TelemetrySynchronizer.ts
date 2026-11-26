import { UAVTelemetryMessage, FlightPlan } from '../../types/telemetry';
import { ObservedUAVState, DataQuality, FlightPlanDeviation } from '../../types/monitoring';
import { distanceToSegmentMeters } from '../../utils/coordinates';

export interface SynchronizerConfig {
  maxTrailPoints: number;        // Max points to keep in memory (e.g. 150)
  degradedThresholdMs: number;   // e.g. 2500ms
  staleThresholdMs: number;      // e.g. 6000ms
  lostThresholdMs: number;       // e.g. 15000ms
}

export const DEFAULT_SYNC_CONFIG: SynchronizerConfig = {
  maxTrailPoints: 150,
  degradedThresholdMs: 2500,
  staleThresholdMs: 6000,
  lostThresholdMs: 15000,
};

export class TelemetrySynchronizer {
  private config: SynchronizerConfig;

  constructor(config: Partial<SynchronizerConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  /**
   * Process a validated telemetry message and update or create ObservedUAVState.
   * STRICT PRINCIPLE: 'position' is the genuine raw physical observation from telemetry.
   * 'display_position' is strictly for visual rendering and must not be used as official state.
   */
  public processTelemetry(
    msg: UAVTelemetryMessage,
    existingState: ObservedUAVState | undefined,
    flightPlan: FlightPlan | undefined,
    receptionWallClock: Date = new Date(),
    isSimulationPaused: boolean = false
  ): {
    state: ObservedUAVState;
    isDuplicate: boolean;
    isOutOfOrder: boolean;
    gapDetected: number;
  } {
    const wallClockIso = receptionWallClock.toISOString();
    const messageCreatedTimeMs = new Date(msg.message_created_at || msg.timestamp).getTime();
    const wallClockMs = receptionWallClock.getTime();
    const latencyMs = Math.max(0, wallClockMs - messageCreatedTimeMs);

    // A cancelled/foreign plan or a different altitude datum cannot be used for corridor checks.
    const planMatchesUav = flightPlan
      ? flightPlan.uav_id === msg.uav_id ||
        (Boolean(flightPlan.callsign) &&
          (flightPlan.callsign === msg.uav_id || flightPlan.callsign === msg.callsign))
      : false;
    if (flightPlan && (flightPlan.status === 'CANCELLED' || flightPlan.status === 'COMPLETED'
      || !planMatchesUav
      || (flightPlan.altitude_reference && flightPlan.altitude_reference !== msg.position.altitude_reference))) {
      flightPlan = undefined;
    }

    // Initial state if first time seeing this UAV
    if (!existingState) {
      const dataQuality: DataQuality = {
        freshness: this.calculateFreshness(0),
        confidence: 'HIGH',
        sim_time_utc: msg.timestamp,
        message_created_at_utc: msg.message_created_at || msg.timestamp,
        received_at_wall_clock_utc: wallClockIso,
        freshness_age_ms: 0,
        latency_ms: latencyMs,
        last_sequence: msg.sequence,
        sequence_gap_count: 0,
        out_of_order_count: 0,
        is_stale: false,
        is_lost: false,
        is_invalid: false,
      };

      const planDeviation = (flightPlan && msg.flight_plan_id) ? this.calculate4DPlanDeviation(msg, flightPlan) : undefined;

      const newState: ObservedUAVState = {
        uav_id: msg.uav_id,
        flight_plan_id: msg.flight_plan_id,
        is_unlinked_plan: !msg.flight_plan_id,
        callsign: msg.callsign,
        status: msg.status,
        flight_mode: msg.flight_mode,
        battery_pct: msg.battery_pct,
        uav_profile: msg.uav_profile || flightPlan?.uav_profile,
        data_source_format: msg.data_source_format,
        is_inferred_sequence: msg.is_inferred_sequence,
        // Raw physical observation
        position: { ...msg.position },
        velocity: { ...msg.velocity },
        timestamp: msg.timestamp,
        // Display visual helper (can be smoothed later)
        display_position: { ...msg.position },
        display_heading_deg: msg.velocity.heading_deg,
        data_quality: dataQuality,
        plan_deviation: planDeviation,
        trail: [
          {
            latitude: msg.position.latitude,
            longitude: msg.position.longitude,
            altitude_m: msg.position.altitude_m,
            timestamp: msg.timestamp,
          },
        ],
      };

      return {
        state: newState,
        isDuplicate: false,
        isOutOfOrder: false,
        gapDetected: 0,
      };
    }

    // Sequence & Duplicate checks
    const lastSeq = existingState.data_quality.last_sequence;
    let isDuplicate = false;
    let isOutOfOrder = false;
    let gapDetected = 0;

    let outOfOrderCount = existingState.data_quality.out_of_order_count;
    let sequenceGapCount = existingState.data_quality.sequence_gap_count;

    if (!msg.is_inferred_sequence) {
      if (msg.sequence === lastSeq) {
        isDuplicate = true;
        return {
          state: {
            ...existingState,
            data_quality: {
              ...existingState.data_quality,
              received_at_wall_clock_utc: wallClockIso,
              freshness_age_ms: 0,
            },
          },
          isDuplicate: true,
          isOutOfOrder: false,
          gapDetected: 0,
        };
      } else if (msg.sequence < lastSeq) {
        isOutOfOrder = true;
        outOfOrderCount += 1;
      } else if (msg.sequence > lastSeq + 1) {
        gapDetected = msg.sequence - (lastSeq + 1);
        sequenceGapCount += gapDetected;
      }
    }

    // Freshness is 0ms right at arrival
    const freshness = this.calculateFreshness(0);
    let confidence: DataQuality['confidence'] = 'HIGH';
    if (isOutOfOrder) confidence = 'LOW';

    const updatedQuality: DataQuality = {
      freshness,
      confidence,
      sim_time_utc: msg.timestamp,
      message_created_at_utc: msg.message_created_at || msg.timestamp,
      received_at_wall_clock_utc: wallClockIso,
      freshness_age_ms: 0,
      latency_ms: latencyMs,
      last_sequence: Math.max(lastSeq, msg.sequence),
      sequence_gap_count: sequenceGapCount,
      out_of_order_count: outOfOrderCount,
      is_stale: false,
      is_lost: false,
      is_invalid: false,
    };

    // Calculate 4D Deviation against active flight plan (ONLY if a genuine flight plan exists)
    const planDeviation = (flightPlan && msg.flight_plan_id) ? this.calculate4DPlanDeviation(msg, flightPlan) : undefined;

    // Bounded trail history
    const updatedTrail = [
      ...existingState.trail,
      {
        latitude: msg.position.latitude,
        longitude: msg.position.longitude,
        altitude_m: msg.position.altitude_m,
        timestamp: msg.timestamp,
      },
    ];

    if (updatedTrail.length > this.config.maxTrailPoints) {
      updatedTrail.splice(0, updatedTrail.length - this.config.maxTrailPoints);
    }

    const updatedState: ObservedUAVState = {
      uav_id: msg.uav_id,
      flight_plan_id: msg.flight_plan_id,
      is_unlinked_plan: !msg.flight_plan_id,
      callsign: msg.callsign || existingState.callsign,
      status: msg.status,
      flight_mode: msg.flight_mode || existingState.flight_mode,
      battery_pct: msg.battery_pct !== undefined ? msg.battery_pct : existingState.battery_pct,
      uav_profile: msg.uav_profile || existingState.uav_profile || flightPlan?.uav_profile,
      data_source_format: msg.data_source_format || existingState.data_source_format,
      is_inferred_sequence: msg.is_inferred_sequence,
      // Raw physical observation directly updated
      position: { ...msg.position },
      velocity: { ...msg.velocity },
      timestamp: msg.timestamp,
      // Display position
      display_position: { ...msg.position },
      display_heading_deg: msg.velocity.heading_deg,
      data_quality: updatedQuality,
      plan_deviation: planDeviation,
      trail: updatedTrail,
    };

    return {
      state: updatedState,
      isDuplicate,
      isOutOfOrder,
      gapDetected,
    };
  }

  /**
   * Periodic check: updates freshness_age_ms and flags states as DEGRADED, STALE, or LOST.
   * If simulation is paused, we adjust status to prevent false alarm disconnects.
   */
  public evaluateLiveness(
    state: ObservedUAVState,
    currentWallClock: Date = new Date(),
    isSimulationPaused: boolean = false
  ): ObservedUAVState {
    const lastReceived = new Date(state.data_quality.received_at_wall_clock_utc).getTime();
    const now = currentWallClock.getTime();
    const elapsedMs = Math.max(0, now - lastReceived);

    if (isSimulationPaused) {
      // While simulation is paused, do not transition to STALE/LOST link alarm
      return {
        ...state,
        data_quality: {
          ...state.data_quality,
          freshness_age_ms: elapsedMs,
        },
      };
    }

    const freshness = this.calculateFreshness(elapsedMs);
    let confidence = state.data_quality.confidence;

    if (freshness === 'DEGRADED' && confidence === 'HIGH') confidence = 'MEDIUM';
    if (freshness === 'STALE') confidence = 'LOW';
    if (freshness === 'LOST') confidence = 'UNRELIABLE';

    return {
      ...state,
      data_quality: {
        ...state.data_quality,
        freshness,
        confidence,
        freshness_age_ms: elapsedMs,
        is_stale: freshness === 'STALE' || freshness === 'LOST',
        is_lost: freshness === 'LOST',
      },
    };
  }

  private calculateFreshness(elapsedMs: number): DataQuality['freshness'] {
    if (elapsedMs < this.config.degradedThresholdMs) return 'FRESH';
    if (elapsedMs < this.config.staleThresholdMs) return 'DEGRADED';
    if (elapsedMs < this.config.lostThresholdMs) return 'STALE';
    return 'LOST';
  }

  /**
   * Calculates 4D Trajectory Deviation (Cross-track, Vertical, and Time Dimension)
   */
  public calculate4DPlanDeviation(
    msg: UAVTelemetryMessage,
    plan: FlightPlan
  ): FlightPlanDeviation {
    if (!plan.waypoints || plan.waypoints.length < 2) {
      return {
        cross_track_error_m: 0,
        vertical_deviation_m: 0,
        time_deviation_s: 0,
        within_spatial_corridor: true,
        within_time_corridor: true,
        within_corridor: true,
        current_segment_index: 0,
      };
    }

    let minCrossTrack = Number.MAX_VALUE;
    let closestSegmentIdx = 0;
    let plannedAlt = plan.waypoints[0].altitude_m;
    let bestRatio = 0;

    for (let i = 0; i < plan.waypoints.length - 1; i++) {
      const wpA = plan.waypoints[i];
      const wpB = plan.waypoints[i + 1];

      const dist = distanceToSegmentMeters(
        msg.position.latitude,
        msg.position.longitude,
        wpA.latitude,
        wpA.longitude,
        wpB.latitude,
        wpB.longitude
      );

      if (dist < minCrossTrack) {
        minCrossTrack = dist;
        closestSegmentIdx = i;

        // Accurate linear interpolation of planned altitude along segment A -> B
        const totalSegmentDist = distanceToSegmentMeters(
          wpB.latitude,
          wpB.longitude,
          wpA.latitude,
          wpA.longitude,
          wpB.latitude,
          wpB.longitude
        );
        const distFromA = distanceToSegmentMeters(
          msg.position.latitude,
          msg.position.longitude,
          wpA.latitude,
          wpA.longitude,
          wpA.latitude,
          wpA.longitude
        );
        bestRatio = totalSegmentDist > 0 ? Math.min(1, Math.max(0, distFromA / totalSegmentDist)) : 0;
        plannedAlt = wpA.altitude_m + bestRatio * (wpB.altitude_m - wpA.altitude_m);
      }
    }

    const verticalDelta = Math.abs(msg.position.altitude_m - plannedAlt);
    const withinHorizontal = minCrossTrack <= plan.corridor_width_m;
    const withinVertical = verticalDelta <= plan.altitude_corridor_m;
    const withinSpatial = withinHorizontal && withinVertical;

    // 4D Temporal calculation: linearly interpolate planned time along segment A -> B
    const wpA = plan.waypoints[closestSegmentIdx];
    const wpB = plan.waypoints[closestSegmentIdx + 1] || wpA;

    let timeDeviationSec = 0;
    let withinTime = true;

    if (wpA.planned_time_utc && wpB.planned_time_utc) {
      const timeAMs = new Date(wpA.planned_time_utc).getTime();
      const timeBMs = new Date(wpB.planned_time_utc).getTime();

      // Estimate planned ETA at this projected point along segment
      const plannedTimeAtPointMs = timeAMs + bestRatio * (timeBMs - timeAMs);
      const currentSimTimeMs = new Date(msg.timestamp).getTime();

      // Difference in seconds: + positive = running late, - negative = running early
      timeDeviationSec = Math.round((currentSimTimeMs - plannedTimeAtPointMs) / 1000);
      const tolerance = wpB.time_tolerance_s || plan.time_tolerance_s || 30;
      withinTime = Math.abs(timeDeviationSec) <= tolerance;
    }

    return {
      cross_track_error_m: Math.round(minCrossTrack * 10) / 10,
      vertical_deviation_m: Math.round(verticalDelta * 10) / 10,
      time_deviation_s: timeDeviationSec,
      within_spatial_corridor: withinSpatial,
      within_time_corridor: withinTime,
      within_corridor: withinSpatial && withinTime,
      current_segment_index: closestSegmentIdx,
    };
  }
}
