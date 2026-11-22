import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useMonitoringStore } from '../../stores/useMonitoringStore';
import { useTacticalStore } from '../../stores/useTacticalStore';
import {
  DANANG_3D_BRIDGES,
  DANANG_3D_BUILDINGS,
  DANANG_3D_TERRAIN_BLOCKS,
  DANANG_VERTIPORT_PADS,
} from '../../data/danang3DEnvironment';
import { UAVType } from '../../types/telemetry';
import { ChevronDown, ChevronUp, Compass } from 'lucide-react';

function metersOffsetDegrees(latDeg: number, dxMeters: number, dyMeters: number) {
  const metersPerDegLat = 111319.5;
  const metersPerDegLon = 111319.5 * Math.cos((latDeg * Math.PI) / 180);
  return {
    dLat: dyMeters / metersPerDegLat,
    dLon: dxMeters / metersPerDegLon,
  };
}

function getUavModelUri(uavType?: UAVType): string {
  if (uavType === 'FIXED_WING') return '/models/uav_fixed_wing.glb';
  if (uavType === 'VTOL') return '/models/uav_vtol.glb';
  return '/models/uav_multirotor.glb';
}

export const CesiumViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  const [hudExpanded, setHudExpanded] = useState(true);

  // Entities maps to sync with Cesium primitives
  const uavEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const dropLineEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const footprintEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const trailEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const planEntitiesRef = useRef<Map<string, Cesium.Entity[]>>(new Map());
  const zoneEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const cityEntitiesRef = useRef<Cesium.Entity[]>([]);
  const tacticalEntitiesRef = useRef<Cesium.Entity[]>([]);
  const previewTrajectoryEntityRef = useRef<Cesium.Entity | null>(null);

  // Store selectors
  const {
    mode,
    connectionStatus,
    uavStates,
    selectedUavId,
    flightPlans,
    restrictedZones,
    showZones,
    showPlans,
    showTrails,
    show3DCity,
    mapStyle,
    cameraTarget,
    cesiumIonToken,
    selectUav,
    focusUav,
  } = useMonitoringStore();

  const { conflicts, previewedOption } = useTacticalStore();

  // 1. Initialize Cesium Viewer
  useEffect(() => {
    if (!containerRef.current) return;

    if (cesiumIonToken) {
      Cesium.Ion.defaultAccessToken = cesiumIonToken;
    }

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      vrButton: false,
      fullscreenButton: false,
      requestRenderMode: false,
      shadows: true,
      terrainProvider: undefined,
    });

    viewerRef.current = viewer;

    // Atmosphere & 3D scene settings
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0B101B');
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#050811');
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 25;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 500000;

    // Initial Camera positioning in angled 3D view over Da Nang Han River & Dragon Bridge
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(108.221, 16.050, 1450),
      orientation: {
        heading: Cesium.Math.toRadians(14),
        pitch: Cesium.Math.toRadians(-32),
        roll: 0,
      },
      duration: 1.0,
    });

    // Handle Click Picking on UAVs
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const pickedObject = viewer.scene.pick(movement.position);
      if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.name) {
        const name = String(pickedObject.id.name);
        if (name.toUpperCase().startsWith('UAV-')) {
          selectUav(name);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // 2. Switch Map Imagery Layers
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.imageryLayers.removeAll();

    try {
      if (mapStyle === 'DARK') {
        const darkProvider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 16,
        });
        viewer.imageryLayers.addImageryProvider(darkProvider);
      } else if (mapStyle === 'SATELLITE') {
        const satelliteProvider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
        });
        viewer.imageryLayers.addImageryProvider(satelliteProvider);
      } else {
        const osmProvider = new Cesium.OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
        });
        viewer.imageryLayers.addImageryProvider(osmProvider);
      }
    } catch (e) {
      console.warn('[Cesium Imagery Provider Fallback Error]:', e);
    }
  }, [mapStyle]);

  // 3. Camera Target Smooth FlyTo
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !cameraTarget) return;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        cameraTarget.longitude,
        cameraTarget.latitude,
        cameraTarget.altitude_m
      ),
      orientation: {
        heading: Cesium.Math.toRadians(cameraTarget.heading_deg ?? 12),
        pitch: Cesium.Math.toRadians(cameraTarget.altitude_m > 3000 ? -42 : -26),
        roll: 0,
      },
      duration: 1.1,
    });
  }, [cameraTarget]);

  // 3b. Render Stylized 3D Da Nang City (Buildings, Bridges, Vertiports, Mountain Blocks)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    cityEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    cityEntitiesRef.current = [];

    if (!show3DCity) return;

    // 3D Terrain Blocks (Son Tra & Ngu Hanh Son)
    DANANG_3D_TERRAIN_BLOCKS.forEach((tb) => {
      const sw = metersOffsetDegrees(tb.latitude, -tb.radiusXM, -tb.radiusYM);
      const ne = metersOffsetDegrees(tb.latitude, tb.radiusXM, tb.radiusYM);
      const positions = Cesium.Cartesian3.fromDegreesArray([
        tb.longitude + sw.dLon, tb.latitude + sw.dLat,
        tb.longitude + ne.dLon, tb.latitude + sw.dLat,
        tb.longitude + ne.dLon, tb.latitude + ne.dLat,
        tb.longitude + sw.dLon, tb.latitude + ne.dLat,
      ]);
      const entity = viewer.entities.add({
        name: tb.name,
        polygon: {
          hierarchy: positions,
          height: 0,
          extrudedHeight: tb.heightM,
          material: Cesium.Color.fromCssColorString(tb.color).withAlpha(0.72),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#a3e635').withAlpha(0.25),
        },
      });
      cityEntitiesRef.current.push(entity);
    });

    // 3D Buildings
    DANANG_3D_BUILDINGS.forEach((bld) => {
      const halfW = bld.widthM / 2;
      const halfD = bld.depthM / 2;
      const sw = metersOffsetDegrees(bld.latitude, -halfW, -halfD);
      const ne = metersOffsetDegrees(bld.latitude, halfW, halfD);
      const positions = Cesium.Cartesian3.fromDegreesArray([
        bld.longitude + sw.dLon, bld.latitude + sw.dLat,
        bld.longitude + ne.dLon, bld.latitude + sw.dLat,
        bld.longitude + ne.dLon, bld.latitude + ne.dLat,
        bld.longitude + sw.dLon, bld.latitude + ne.dLat,
      ]);

      const entity = viewer.entities.add({
        name: bld.name,
        polygon: {
          hierarchy: positions,
          height: 0,
          extrudedHeight: bld.heightM,
          material: Cesium.Color.fromCssColorString(bld.color).withAlpha(0.84),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.45),
        },
      });
      cityEntitiesRef.current.push(entity);
    });

    // 3D Han River Bridges
    DANANG_3D_BRIDGES.forEach((brg) => {
      const bridgeColor = Cesium.Color.fromCssColorString(brg.color);
      const deckEntity = viewer.entities.add({
        name: brg.name,
        corridor: {
          positions: Cesium.Cartesian3.fromDegreesArray([
            brg.startLon,
            brg.startLat,
            brg.endLon,
            brg.endLat,
          ]),
          width: brg.widthM,
          height: brg.deckHeightM - 3,
          extrudedHeight: brg.deckHeightM,
          material: bridgeColor.withAlpha(0.9),
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.35),
        },
      });
      cityEntitiesRef.current.push(deckEntity);

      // Center landmark pylon / arch beacon
      if (brg.pylonHeightM) {
        const midLat = (brg.startLat + brg.endLat) / 2;
        const midLon = (brg.startLon + brg.endLon) / 2;
        const pylonEntity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(midLon, midLat, brg.pylonHeightM / 2),
          cylinder: {
            length: brg.pylonHeightM,
            topRadius: 3.5,
            bottomRadius: 6,
            material: bridgeColor.withAlpha(0.95),
          },
          label: {
            text: brg.name,
            font: 'bold 10px Inter, sans-serif',
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#0B101B').withAlpha(0.75),
            pixelOffset: new Cesium.Cartesian2(0, -16),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 7000),
          },
        });
        cityEntitiesRef.current.push(pylonEntity);
      }
    });

    // 3D Vertiport Landing Pads
    DANANG_VERTIPORT_PADS.forEach((pad) => {
      const padColor = Cesium.Color.fromCssColorString(pad.color);
      const padEntity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pad.longitude, pad.latitude, 1.5),
        ellipse: {
          semiMajorAxis: pad.radiusM,
          semiMinorAxis: pad.radiusM,
          height: 0.5,
          extrudedHeight: 2.5,
          material: padColor.withAlpha(0.75),
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
          outlineWidth: 2,
        },
        label: {
          text: pad.name,
          font: '10px Inter, sans-serif',
          fillColor: padColor,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0B101B').withAlpha(0.8),
          pixelOffset: new Cesium.Cartesian2(0, -14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5000),
        },
      });
      cityEntitiesRef.current.push(padEntity);
    });
  }, [show3DCity]);

  // 4. Render 3D Restricted Airspace / Geofence Zones (Extruded Polygons)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    zoneEntitiesRef.current.forEach((entity) => viewer.entities.remove(entity));
    zoneEntitiesRef.current.clear();

    if (!showZones) return;

    restrictedZones.forEach((zone) => {
      const positions = zone.boundary.map((b) =>
        Cesium.Cartesian3.fromDegrees(b.longitude, b.latitude)
      );

      const zoneColor = Cesium.Color.fromCssColorString(zone.color || '#ef4444').withAlpha(0.24);
      const outlineColor = Cesium.Color.fromCssColorString(zone.color || '#ef4444').withAlpha(0.9);

      const zoneEntity = viewer.entities.add({
        id: `ZONE-${zone.zone_id}`,
        name: zone.name,
        polygon: {
          hierarchy: positions,
          extrudedHeight: zone.max_altitude_m,
          height: zone.min_altitude_m,
          material: zoneColor,
          outline: true,
          outlineColor: outlineColor,
          outlineWidth: 2,
        },
      });

      zoneEntitiesRef.current.set(zone.zone_id, zoneEntity);
    });
  }, [restrictedZones, showZones]);

  // 5. Render Planned Flight Paths (Waypoints & 3D Corridors)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    planEntitiesRef.current.forEach((entities) => entities.forEach((e) => viewer.entities.remove(e)));
    planEntitiesRef.current.clear();

    if (!showPlans) return;

    Object.values(flightPlans).forEach((plan) => {
      if (plan.status === 'CANCELLED' || plan.status === 'COMPLETED') return;
      const createdEntities: Cesium.Entity[] = [];
      const planPositions = plan.waypoints.map((wp) =>
        Cesium.Cartesian3.fromDegrees(wp.longitude, wp.latitude, wp.altitude_m)
      );

      const planColor = Cesium.Color.fromCssColorString(plan.color || '#06b6d4');

      const lineEntity = viewer.entities.add({
        polyline: {
          positions: planPositions,
          width: 3,
          material: new Cesium.PolylineDashMaterialProperty({
            color: planColor,
            dashLength: 16.0,
          }),
        },
      });
      createdEntities.push(lineEntity);

      plan.waypoints.forEach((wp) => {
        const wpEntity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(wp.longitude, wp.latitude, wp.altitude_m),
          point: {
            pixelSize: 6,
            color: planColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1.5,
          },
          label: {
            text: `${wp.id}: ${wp.name}`,
            font: '10px Roboto, sans-serif',
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#0B101B').withAlpha(0.75),
            pixelOffset: new Cesium.Cartesian2(0, -14),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000),
          },
        });
        createdEntities.push(wpEntity);
      });

      planEntitiesRef.current.set(plan.plan_id, createdEntities);
    });
  }, [flightPlans, showPlans]);

  // 6. Render UAV 3D Models (.glb), Altitude Drop-Lines, Ground Footprints, and Flight Trails
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const currentUavIds = new Set(Object.keys(uavStates));

    const cleanupRemoved = (map: Map<string, Cesium.Entity>) => {
      map.forEach((entity, id) => {
        if (!currentUavIds.has(id)) {
          viewer.entities.remove(entity);
          map.delete(id);
        }
      });
    };

    cleanupRemoved(uavEntitiesRef.current);
    cleanupRemoved(dropLineEntitiesRef.current);
    cleanupRemoved(footprintEntitiesRef.current);
    cleanupRemoved(trailEntitiesRef.current);

    Object.values(uavStates).forEach((uav) => {
      const isSelected = selectedUavId === uav.uav_id;
      const posCartesian = Cesium.Cartesian3.fromDegrees(
        uav.position.longitude,
        uav.position.latitude,
        uav.position.altitude_m
      );
      const groundCartesian = Cesium.Cartesian3.fromDegrees(
        uav.position.longitude,
        uav.position.latitude,
        0.5
      );

      // Compass heading (0 deg = North) -> Cesium ENU HPR (0 rad = East, CW = +)
      const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians((uav.velocity.heading_deg ?? 0) - 90),
        0,
        0
      );
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(posCartesian, hpr);

      let pinColor = Cesium.Color.CYAN;
      if (uav.data_quality.freshness === 'DEGRADED') pinColor = Cesium.Color.YELLOW;
      if (uav.data_quality.freshness === 'STALE' || uav.data_quality.freshness === 'LOST') pinColor = Cesium.Color.RED;
      if (uav.plan_deviation && !uav.plan_deviation.within_corridor) pinColor = Cesium.Color.ORANGE;

      const modelUri = getUavModelUri(uav.uav_profile?.uav_type);
      const labelText = `${uav.callsign || uav.uav_id} [${Math.round(uav.position.altitude_m)}m ${uav.position.altitude_reference}]`;

      // 6a. 3D UAV Model Entity
      let entity = uavEntitiesRef.current.get(uav.uav_id);
      if (!entity) {
        entity = viewer.entities.add({
          id: `UAV-ENTITY-${uav.uav_id}`,
          name: uav.uav_id,
          position: posCartesian,
          orientation: orientation as any,
          model: {
            uri: modelUri,
            scale: 7,
            minimumPixelSize: isSelected ? 54 : 42,
            maximumScale: 45,
            color: pinColor,
            colorBlendMode: Cesium.ColorBlendMode.MIX,
            colorBlendAmount: 0.3,
            silhouetteColor: isSelected ? Cesium.Color.YELLOW : pinColor,
            silhouetteSize: isSelected ? 2.5 : 1.0,
          },
          label: {
            text: labelText,
            font: 'bold 11px Inter, sans-serif',
            fillColor: isSelected ? Cesium.Color.YELLOW : Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#0B101B').withAlpha(0.85),
            pixelOffset: new Cesium.Cartesian2(0, -28),
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          },
        });
        uavEntitiesRef.current.set(uav.uav_id, entity);
      } else {
        entity.position = posCartesian as any;
        entity.orientation = orientation as any;
        if (entity.model) {
          entity.model.uri = modelUri as any;
          entity.model.minimumPixelSize = (isSelected ? 54 : 42) as any;
          entity.model.color = pinColor as any;
          entity.model.silhouetteColor = (isSelected ? Cesium.Color.YELLOW : pinColor) as any;
          entity.model.silhouetteSize = (isSelected ? 2.5 : 1.0) as any;
        }
        if (entity.label) {
          entity.label.text = labelText as any;
          entity.label.fillColor = (isSelected ? Cesium.Color.YELLOW : Cesium.Color.WHITE) as any;
        }
      }

      // 6b. Altitude Drop-Line (Visual 3D height anchor to ground)
      let dropEntity = dropLineEntitiesRef.current.get(uav.uav_id);
      if (!dropEntity) {
        dropEntity = viewer.entities.add({
          polyline: {
            positions: [groundCartesian, posCartesian],
            width: 1.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: pinColor.withAlpha(0.55),
              dashLength: 8.0,
            }),
          },
        });
        dropLineEntitiesRef.current.set(uav.uav_id, dropEntity);
      } else {
        dropEntity.polyline!.positions = [groundCartesian, posCartesian] as any;
      }

      // 6c. Ground Footprint Ring
      let fpEntity = footprintEntitiesRef.current.get(uav.uav_id);
      if (!fpEntity) {
        fpEntity = viewer.entities.add({
          position: groundCartesian,
          ellipse: {
            semiMajorAxis: 18,
            semiMinorAxis: 18,
            height: 0.5,
            material: pinColor.withAlpha(0.18),
            outline: true,
            outlineColor: pinColor.withAlpha(0.75),
            outlineWidth: 1.5,
          },
        });
        footprintEntitiesRef.current.set(uav.uav_id, fpEntity);
      } else {
        fpEntity.position = groundCartesian as any;
        if (fpEntity.ellipse) {
          fpEntity.ellipse.material = new Cesium.ColorMaterialProperty(pinColor.withAlpha(0.18));
          fpEntity.ellipse.outlineColor = new Cesium.ConstantProperty(pinColor.withAlpha(0.75));
        }
      }

      // 6d. Past Trail Polyline
      if (showTrails && uav.trail.length > 1) {
        const trailPositions = uav.trail.map((p) =>
          Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude_m)
        );

        let trailEntity = trailEntitiesRef.current.get(uav.uav_id);
        if (!trailEntity) {
          trailEntity = viewer.entities.add({
            polyline: {
              positions: trailPositions,
              width: 2.5,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.25,
                color: pinColor.withAlpha(0.8),
              }),
            },
          });
          trailEntitiesRef.current.set(uav.uav_id, trailEntity);
        } else {
          trailEntity.polyline!.positions = trailPositions as any;
        }
      } else {
        const trailEntity = trailEntitiesRef.current.get(uav.uav_id);
        if (trailEntity) {
          viewer.entities.remove(trailEntity);
          trailEntitiesRef.current.delete(uav.uav_id);
        }
      }
    });
  }, [uavStates, selectedUavId, showTrails]);

  // 7. Tactical Conflict & Resolution Trajectory Rendering
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    tacticalEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    tacticalEntitiesRef.current = [];

    conflicts.forEach((c) => {
      const uavA = uavStates[c.uav_a_id];
      const uavB = uavStates[c.uav_b_id];

      const cpaPos = Cesium.Cartesian3.fromDegrees(
        c.uav_a_position_at_cpa.longitude,
        c.uav_a_position_at_cpa.latitude,
        c.uav_a_position_at_cpa.altitude_m
      );

      const cpaEntity = viewer.entities.add({
        position: cpaPos,
        point: {
          pixelSize: 14,
          color: Cesium.Color.RED.withAlpha(0.9),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: `CPA XUNG ĐỘT: ${c.time_to_cpa_seconds}s (${c.cpa_horizontal_distance_m}m)`,
          font: 'bold 11px JetBrains Mono, monospace',
          fillColor: Cesium.Color.fromCssColorString('#F87171'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(15, 23, 42, 0.85)'),
        },
      });
      tacticalEntitiesRef.current.push(cpaEntity);

      if (uavA && uavB) {
        const posA = Cesium.Cartesian3.fromDegrees(
          uavA.position.longitude,
          uavA.position.latitude,
          uavA.position.altitude_m
        );
        const posB = Cesium.Cartesian3.fromDegrees(
          uavB.position.longitude,
          uavB.position.latitude,
          uavB.position.altitude_m
        );

        const lineEntity = viewer.entities.add({
          polyline: {
            positions: [posA, posB],
            width: 2.0,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#EF4444'),
              dashLength: 12.0,
            }),
          },
        });
        tacticalEntitiesRef.current.push(lineEntity);
      }
    });

    if (previewTrajectoryEntityRef.current) {
      viewer.entities.remove(previewTrajectoryEntityRef.current);
      previewTrajectoryEntityRef.current = null;
    }

    if (previewedOption && previewedOption.projected_trajectory.length > 0) {
      const positions = previewedOption.projected_trajectory.map((pt) =>
        Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude, pt.altitude_m)
      );

      const trajEntity = viewer.entities.add({
        polyline: {
          positions,
          width: 3.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            color: Cesium.Color.fromCssColorString('#10B981'),
          }),
        },
      });
      previewTrajectoryEntityRef.current = trajEntity;
    }
  }, [conflicts, previewedOption, uavStates]);

  const activeUavs = Object.values(uavStates);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* Cesium Canvas Container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Compact 3D Telemetry HUD Overlay (Top-Left of Viewport) */}
      <div className="absolute top-4 left-4 z-10 w-72 bg-slate-950/85 backdrop-blur-md border border-slate-700/70 rounded-lg shadow-xl overflow-hidden text-xs">
        <button
          onClick={() => setHudExpanded(!hudExpanded)}
          className="w-full px-3 py-2 flex items-center justify-between bg-slate-900/90 border-b border-slate-800 text-left hover:bg-slate-800/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionStatus === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-amber-400'
              }`}
            />
            <span className="font-mono font-bold text-[11px] text-slate-200 uppercase tracking-wide">
              3D Airspace HUD ({mode})
            </span>
          </div>
          {hudExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>

        {hudExpanded && (
          <div className="p-2.5 space-y-1.5 font-mono text-[10px]">
            {activeUavs.length === 0 ? (
              <div className="text-slate-500 py-1">Chưa có UAV hoạt động...</div>
            ) : (
              activeUavs.map((u) => (
                <button
                  key={u.uav_id}
                  onClick={() => focusUav(u.uav_id)}
                  className={`w-full flex items-center justify-between px-2 py-1 rounded border text-left transition-all ${
                    selectedUavId === u.uav_id
                      ? 'bg-cyan-950/70 border-cyan-500/60 text-cyan-200'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span className="font-bold truncate">{u.uav_id}</span>
                  <span className="text-cyan-400">
                    {Math.round(u.position.altitude_m)}m {u.position.altitude_reference}
                  </span>
                  <span className="text-slate-400">
                    {u.position.latitude.toFixed(4)}, {u.position.longitude.toFixed(4)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Map Control Buttons Overlay (Top-Right of Map) */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-slate-900/90 backdrop-blur-md p-2.5 rounded-lg border border-slate-700/60 shadow-xl w-56">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">
          Kiểu bản đồ
        </div>
        <div className="grid grid-cols-3 gap-1">
          <button
            onClick={() => useMonitoringStore.getState().setMapStyle('DARK')}
            className={`px-2 py-1 text-[11px] rounded font-medium transition-all ${
              mapStyle === 'DARK'
                ? 'bg-cyan-500 text-slate-950 shadow-md font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Dark
          </button>
          <button
            onClick={() => useMonitoringStore.getState().setMapStyle('SATELLITE')}
            className={`px-2 py-1 text-[11px] rounded font-medium transition-all ${
              mapStyle === 'SATELLITE'
                ? 'bg-cyan-500 text-slate-950 shadow-md font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Vệ tinh
          </button>
          <button
            onClick={() => useMonitoringStore.getState().setMapStyle('STREET')}
            className={`px-2 py-1 text-[11px] rounded font-medium transition-all ${
              mapStyle === 'STREET'
                ? 'bg-cyan-500 text-slate-950 shadow-md font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Đường phố
          </button>
        </div>

        <div className="border-t border-slate-800 my-0.5" />

        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">
          Lớp hiển thị 3D
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-xs text-slate-300 px-0.5 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={show3DCity}
              onChange={() => useMonitoringStore.getState().toggleLayer('city3d')}
              className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
            />
            Thành phố 3D &amp; Cầu
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300 px-0.5 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={showZones}
              onChange={() => useMonitoringStore.getState().toggleLayer('zones')}
              className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
            />
            Vùng hạn chế 3D (NFZ)
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300 px-0.5 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={showPlans}
              onChange={() => useMonitoringStore.getState().toggleLayer('plans')}
              className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
            />
            Kế hoạch bay dự kiến
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300 px-0.5 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={showTrails}
              onChange={() => useMonitoringStore.getState().toggleLayer('trails')}
              className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
            />
            Vệt bay thực tế (Trails)
          </label>
        </div>

        <div className="border-t border-slate-800 my-0.5" />

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => useMonitoringStore.getState().focusDaNang3DView()}
            className="flex items-center justify-center gap-1 py-1.5 px-2 text-[11px] font-medium text-cyan-300 bg-cyan-950/70 hover:bg-cyan-900/80 rounded border border-cyan-700/70 text-center transition-all"
          >
            <Compass className="w-3 h-3" />
            3D Sông Hàn
          </button>
          <button
            onClick={() => useMonitoringStore.getState().resetCameraToDaNang()}
            className="py-1.5 px-2 text-[11px] font-medium text-slate-200 bg-slate-800/90 hover:bg-slate-700 rounded border border-slate-700 text-center transition-all"
          >
            Toàn cảnh
          </button>
        </div>
      </div>
    </div>
  );
};
