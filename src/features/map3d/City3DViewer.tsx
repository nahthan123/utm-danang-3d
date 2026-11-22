import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useMonitoringStore } from '../../stores/useMonitoringStore';
import { useTacticalStore } from '../../stores/useTacticalStore';
import { ChevronDown, ChevronUp, Compass, Crosshair, Eye, ShieldAlert } from 'lucide-react';
import {
  ArticulatedUavHandle,
  buildArticulatedUav,
  buildDaNangCityEnvironment,
  createOrUpdateLabelSprite,
  wgs84ToThree,
} from './threeBuilders';
import { UAVType } from '../../types/telemetry';
import { ObservedUAVState } from '../../types/monitoring';

interface UavRuntimeEntry {
  uavId: string;
  uavType: UAVType | undefined;
  handle: ArticulatedUavHandle;
  targetPos: THREE.Vector3;
  visualPos: THREE.Vector3;
  targetYawRad: number;
  visualYawRad: number;
  labelSprite: THREE.Sprite;
  labelCacheKey: string;
  dropLine: THREE.Line;
  groundRing: THREE.Mesh;
  trailLine: THREE.Line;
}

function getStatusHex(uav: ObservedUAVState, isConflicting: boolean): string {
  if (isConflicting) return '#ef4444';
  if (uav.plan_deviation && !uav.plan_deviation.within_corridor) return '#f97316';
  if (uav.data_quality.freshness === 'STALE' || uav.data_quality.freshness === 'LOST') return '#ef4444';
  if (uav.data_quality.freshness === 'DEGRADED') return '#eab308';
  return '#22d3ee';
}

function getAltitudeTier(altM: number): string {
  if (altM < 85) return 'T1';
  if (altM <= 130) return 'T2';
  return 'T3';
}

function shortestAngleLerp(current: number, target: number, t: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

export const City3DViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const [hudExpanded, setHudExpanded] = useState(true);
  const [followSelected, setFollowSelected] = useState(false);
  const [heroScaleMode, setHeroScaleMode] = useState(true);

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
    cameraTarget,
    conflictDemoActive,
    selectUav,
    focusUav,
    startConflictDemo,
    stopConflictDemo,
  } = useMonitoringStore();

  const { conflicts, previewedOption } = useTacticalStore();

  // Live refs accessible inside rAF without re-initializing WebGL
  const followRef = useRef(followSelected);
  const heroScaleRef = useRef(heroScaleMode);
  const selectedIdRef = useRef(selectedUavId);
  const uavStatesRef = useRef(uavStates);

  useEffect(() => {
    followRef.current = followSelected;
    heroScaleRef.current = heroScaleMode;
    selectedIdRef.current = selectedUavId;
    uavStatesRef.current = uavStates;
  }, [followSelected, heroScaleMode, selectedUavId, uavStates]);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cityGroupRef = useRef<THREE.Group | null>(null);
  const zonesGroupRef = useRef<THREE.Group | null>(null);
  const plansGroupRef = useRef<THREE.Group | null>(null);
  const tacticalGroupRef = useRef<THREE.Group | null>(null);
  const uavLayerGroupRef = useRef<THREE.Group | null>(null);
  const uavMapRef = useRef<Map<string, UavRuntimeEntry>>(new Map());

  const flyCameraPreset = (pos: THREE.Vector3, target: THREE.Vector3) => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    setFollowSelected(false);
    cam.position.copy(pos);
    ctrl.target.copy(target);
    ctrl.update();
  };

  // 1. Mount Three.js Scene, Lighting, Da Nang 3D Urban Environment & Animation Loop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 1024;
    const height = container.clientHeight || 640;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#07101f');
    scene.fog = new THREE.FogExp2('#07101f', 0.00012);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 2, 24000);
    // Low oblique urban showcase angle right above Dragon Bridge & Han River
    camera.position.set(-480, 310, 580);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 28;
    controls.maxDistance = 8500;
    controls.target.set(90, 55, -260);
    controls.update();
    controlsRef.current = controls;

    // Atmospheric Lighting
    const hemi = new THREE.HemisphereLight('#93c5fd', '#0f172a', 0.95);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight('#f8fafc', 1.65);
    sun.position.set(1100, 1750, 750);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 6500;
    const d = 2600;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const rimLight = new THREE.DirectionalLight('#38bdf8', 0.5);
    rimLight.position.set(-1400, 700, -1100);
    scene.add(rimLight);

    // Build Da Nang Urban 3D Environment
    const cityGroup = buildDaNangCityEnvironment();
    scene.add(cityGroup);
    cityGroupRef.current = cityGroup;

    const zonesGroup = new THREE.Group();
    const plansGroup = new THREE.Group();
    const tacticalGroup = new THREE.Group();
    const uavLayerGroup = new THREE.Group();
    scene.add(zonesGroup, plansGroup, tacticalGroup, uavLayerGroup);
    zonesGroupRef.current = zonesGroup;
    plansGroupRef.current = plansGroup;
    tacticalGroupRef.current = tacticalGroup;
    uavLayerGroupRef.current = uavLayerGroup;

    // ResizeObserver handles sidebar open/close cleanly
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, entry.contentRect.width);
        const h = Math.max(1, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    // Click picking on 3D UAVs (ignore orbit drags)
    const raycaster = new THREE.Raycaster();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (ev: PointerEvent) => {
      pointerDownPos = { x: ev.clientX, y: ev.clientY };
    };
    const onPointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - pointerDownPos.x, ev.clientY - pointerDownPos.y);
      if (moved > 5) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(uavLayerGroup.children, true);
      for (const hit of hits) {
        const uavId = hit.object.userData?.uavId;
        if (typeof uavId === 'string') {
          selectUav(uavId);
          return;
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Smooth 60fps Animation Loop
    let rafId = 0;
    let lastTime = performance.now();
    const prevFollowPos = new THREE.Vector3();
    let hasPrevFollow = false;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);

      uavMapRef.current.forEach((entry) => {
        const alpha = 1 - Math.exp(-dt * 5.5);
        entry.visualPos.lerp(entry.targetPos, alpha);
        entry.visualYawRad = shortestAngleLerp(entry.visualYawRad, entry.targetYawRad, alpha);

        entry.handle.root.position.copy(entry.visualPos);
        entry.handle.root.rotation.y = entry.visualYawRad;

        // Spin propellers continuously
        for (const rotor of entry.handle.rotors) {
          rotor.rotation.y += dt * 26;
        }
        entry.handle.strobeMat.color.setHex(pulse > 0.5 ? 0x38bdf8 : 0xfacc15);

        // Adaptive 3D scale so UAVs stay crisp both nearby and in city overview
        const camDist = camera.position.distanceTo(entry.visualPos);
        const targetScale = heroScaleRef.current
          ? Math.min(34, Math.max(9, camDist * 0.027))
          : Math.min(15, Math.max(4, camDist * 0.011));
        entry.handle.root.scale.setScalar(targetScale);

        // Sync vertical drop-line, ground halo ring & floating label height
        const linePositions = entry.dropLine.geometry.attributes.position as THREE.BufferAttribute;
        linePositions.setXYZ(0, entry.visualPos.x, entry.visualPos.y, entry.visualPos.z);
        linePositions.setXYZ(1, entry.visualPos.x, 1.2, entry.visualPos.z);
        linePositions.needsUpdate = true;

        entry.groundRing.position.set(entry.visualPos.x, 1.3, entry.visualPos.z);
        const ringPulse = 1 + pulse * 0.16;
        entry.groundRing.scale.set(ringPulse, ringPulse, 1);

        entry.labelSprite.position.set(
          entry.visualPos.x,
          entry.visualPos.y + targetScale * 2.1 + 14,
          entry.visualPos.z
        );
        const labelScale = Math.min(240, Math.max(70, camDist * 0.13));
        entry.labelSprite.scale.set(labelScale, labelScale * 0.28, 1);
      });

      // Optional Follow-Selected-UAV camera tracking
      if (followRef.current) {
        const targetId = selectedIdRef.current || Object.keys(uavStatesRef.current)[0];
        const entry = targetId ? uavMapRef.current.get(targetId) : undefined;
        if (entry) {
          if (!hasPrevFollow) {
            prevFollowPos.copy(entry.visualPos);
            hasPrevFollow = true;
          } else {
            const delta = entry.visualPos.clone().sub(prevFollowPos);
            camera.position.add(delta);
            controls.target.lerp(entry.visualPos, 1 - Math.exp(-dt * 8));
            prevFollowPos.copy(entry.visualPos);
          }
        }
      } else {
        hasPrevFollow = false;
      }

      controls.update();
      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    const uavEntries = uavMapRef.current;

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      uavEntries.clear();

      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else if (mat) {
          mat.dispose();
        }
      });

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [selectUav]);

  // 2. Toggle 3D City Environment visibility
  useEffect(() => {
    if (cityGroupRef.current) {
      cityGroupRef.current.visible = show3DCity;
    }
  }, [show3DCity]);

  // 3. Respond to store cameraTarget (focusUav / resetCamera / focusDaNang3DView)
  useEffect(() => {
    if (!cameraTarget || !cameraRef.current || !controlsRef.current) return;
    const targetWorld = wgs84ToThree(cameraTarget.latitude, cameraTarget.longitude, 0);
    const camHeight = cameraTarget.altitude_m > 3000 ? 1850 : Math.min(480, Math.max(150, cameraTarget.altitude_m * 0.95));
    const offsetDist = cameraTarget.altitude_m > 3000 ? 2200 : 280;

    cameraRef.current.position.set(
      targetWorld.x - offsetDist * 0.75,
      camHeight,
      targetWorld.z + offsetDist * 0.9
    );
    controlsRef.current.target.set(targetWorld.x, Math.min(80, camHeight * 0.2), targetWorld.z);
    controlsRef.current.update();
  }, [cameraTarget]);

  // 4. Render 3D Restricted Airspace Geofence Walls (NFZ)
  useEffect(() => {
    const group = zonesGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }

    if (!showZones) return;

    restrictedZones.forEach((zone) => {
      if (zone.boundary.length < 3) return;
      const pts = zone.boundary.map((b) => wgs84ToThree(b.latitude, b.longitude, 0));
      const minY = Math.max(1, zone.min_altitude_m);
      const maxY = Math.max(minY + 20, zone.max_altitude_m);
      const zoneColor = zone.color || '#ef4444';

      // Extruded wall faces around perimeter
      const wallVerts: number[] = [];
      const wallIdx: number[] = [];
      const topLinePts: THREE.Vector3[] = [];

      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const baseIdx = i * 4;

        wallVerts.push(a.x, minY, a.z, b.x, minY, b.z, b.x, maxY, b.z, a.x, maxY, a.z);
        wallIdx.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);

        topLinePts.push(new THREE.Vector3(a.x, maxY, a.z), new THREE.Vector3(b.x, maxY, b.z));
        topLinePts.push(new THREE.Vector3(a.x, minY, a.z), new THREE.Vector3(a.x, maxY, a.z));
      }

      const wallGeo = new THREE.BufferGeometry();
      wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
      wallGeo.setIndex(wallIdx);
      wallGeo.computeVertexNormals();

      const wallMat = new THREE.MeshBasicMaterial({
        color: zoneColor,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      group.add(new THREE.Mesh(wallGeo, wallMat));

      const wireGeo = new THREE.BufferGeometry().setFromPoints(topLinePts);
      group.add(
        new THREE.LineSegments(
          wireGeo,
          new THREE.LineBasicMaterial({ color: zoneColor, transparent: true, opacity: 0.85 })
        )
      );
    });
  }, [restrictedZones, showZones]);

  // 5. Render Planned 4D Flight Corridors & Waypoint Beacons
  useEffect(() => {
    const group = plansGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    if (!showPlans) return;

    Object.values(flightPlans).forEach((plan) => {
      if (plan.status === 'CANCELLED' || plan.status === 'COMPLETED') return;
      const color = plan.color || '#06b6d4';
      const pts = plan.waypoints.map((wp) => wgs84ToThree(wp.latitude, wp.longitude, wp.altitude_m));
      if (pts.length < 2) return;

      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineDashedMaterial({
        color,
        dashSize: 28,
        gapSize: 14,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.computeLineDistances();
      group.add(line);

      const wpGeo = new THREE.SphereGeometry(7.5, 10, 10);
      const wpMat = new THREE.MeshBasicMaterial({ color });
      const poleMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 });

      pts.forEach((p) => {
        const sphere = new THREE.Mesh(wpGeo, wpMat);
        sphere.position.copy(p);
        group.add(sphere);

        const poleGeo = new THREE.BufferGeometry().setFromPoints([p, new THREE.Vector3(p.x, 1, p.z)]);
        group.add(new THREE.Line(poleGeo, poleMat));
      });
    });
  }, [flightPlans, showPlans]);

  // 6. Sync Live / Demo UAV 3D Entities & Trails
  useEffect(() => {
    const layer = uavLayerGroupRef.current;
    if (!layer) return;

    const currentIds = new Set(Object.keys(uavStates));

    // Remove departed UAVs
    uavMapRef.current.forEach((entry, id) => {
      if (!currentIds.has(id)) {
        layer.remove(entry.handle.root, entry.labelSprite, entry.dropLine, entry.groundRing, entry.trailLine);
        uavMapRef.current.delete(id);
      }
    });

    const conflictingIds = new Set<string>();
    conflicts.forEach((c) => {
      conflictingIds.add(c.uav_a_id);
      conflictingIds.add(c.uav_b_id);
    });

    Object.values(uavStates).forEach((uav) => {
      const targetPos = wgs84ToThree(uav.position.latitude, uav.position.longitude, uav.position.altitude_m);
      const targetYawRad = -((uav.velocity.heading_deg ?? 0) * Math.PI) / 180;
      const isConflicting = conflictingIds.has(uav.uav_id);
      const accentHex = getStatusHex(uav, isConflicting);
      const isSelected = selectedUavId === uav.uav_id;
      const tier = getAltitudeTier(uav.position.altitude_m);
      const labelTitle = isConflicting ? `⚠ ${uav.callsign || uav.uav_id}` : uav.callsign || uav.uav_id;
      const labelSub = `${Math.round(uav.position.altitude_m)}m ${uav.position.altitude_reference} (${tier}) • ${Math.round(uav.velocity.ground_speed_mps)}m/s`;
      const cacheKey = `${labelTitle}|${labelSub}|${accentHex}|${isSelected}`;

      let entry = uavMapRef.current.get(uav.uav_id);
      if (!entry) {
        const handle = buildArticulatedUav(uav.uav_id, uav.uav_profile?.uav_type, accentHex);
        handle.root.position.copy(targetPos);
        handle.root.rotation.y = targetYawRad;

        const labelSprite = createOrUpdateLabelSprite(undefined, labelTitle, labelSub, accentHex, isSelected);
        labelSprite.position.set(targetPos.x, targetPos.y + 30, targetPos.z);

        const dropGeo = new THREE.BufferGeometry().setFromPoints([
          targetPos.clone(),
          new THREE.Vector3(targetPos.x, 1.2, targetPos.z),
        ]);
        const dropLine = new THREE.Line(
          dropGeo,
          new THREE.LineBasicMaterial({ color: accentHex, transparent: true, opacity: 0.6 })
        );

        const groundRing = new THREE.Mesh(
          new THREE.RingGeometry(14, 20, 28),
          new THREE.MeshBasicMaterial({
            color: accentHex,
            transparent: true,
            opacity: 0.72,
            side: THREE.DoubleSide,
          })
        );
        groundRing.rotation.x = -Math.PI / 2;
        groundRing.position.set(targetPos.x, 1.3, targetPos.z);

        const trailLine = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: accentHex, transparent: true, opacity: 0.9 })
        );

        layer.add(handle.root, labelSprite, dropLine, groundRing, trailLine);
        entry = {
          uavId: uav.uav_id,
          uavType: uav.uav_profile?.uav_type,
          handle,
          targetPos: targetPos.clone(),
          visualPos: targetPos.clone(),
          targetYawRad,
          visualYawRad: targetYawRad,
          labelSprite,
          labelCacheKey: cacheKey,
          dropLine,
          groundRing,
          trailLine,
        };
        uavMapRef.current.set(uav.uav_id, entry);
      } else {
        entry.targetPos.copy(targetPos);
        entry.targetYawRad = targetYawRad;
        entry.handle.accentMat.color.set(accentHex);
        entry.handle.accentMat.emissive.set(accentHex);
        (entry.dropLine.material as THREE.LineBasicMaterial).color.set(accentHex);
        (entry.groundRing.material as THREE.MeshBasicMaterial).color.set(isSelected ? '#facc15' : accentHex);

        if (entry.labelCacheKey !== cacheKey) {
          createOrUpdateLabelSprite(entry.labelSprite, labelTitle, labelSub, accentHex, isSelected);
          entry.labelCacheKey = cacheKey;
        }
      }

      // Live Trail Geometry
      entry.trailLine.visible = showTrails && uav.trail.length > 1;
      if (entry.trailLine.visible) {
        const trailPts = uav.trail.map((pt) => wgs84ToThree(pt.latitude, pt.longitude, pt.altitude_m));
        entry.trailLine.geometry.dispose();
        entry.trailLine.geometry = new THREE.BufferGeometry().setFromPoints(trailPts);
        (entry.trailLine.material as THREE.LineBasicMaterial).color.set(accentHex);
      }
    });
  }, [uavStates, selectedUavId, showTrails, conflicts]);

  // 7. Render Tactical Conflicts & Resolution Preview Trajectory
  useEffect(() => {
    const group = tacticalGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    conflicts.forEach((c) => {
      const cpa = wgs84ToThree(
        c.uav_a_position_at_cpa.latitude,
        c.uav_a_position_at_cpa.longitude,
        c.uav_a_position_at_cpa.altitude_m
      );

      // Inner red danger core + outer wireframe shockwave sphere
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(18, 18, 18),
        new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.42 })
      );
      core.position.copy(cpa);
      group.add(core);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(28, 16, 12),
        new THREE.MeshBasicMaterial({ color: '#f87171', wireframe: true, transparent: true, opacity: 0.72 })
      );
      halo.position.copy(cpa);
      group.add(halo);

      // CPA vertical drop-line to river/ground
      const cpaDropGeo = new THREE.BufferGeometry().setFromPoints([
        cpa.clone(),
        new THREE.Vector3(cpa.x, 1.5, cpa.z),
      ]);
      group.add(
        new THREE.Line(
          cpaDropGeo,
          new THREE.LineBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.65 })
        )
      );

      // Floating CPA warning sprite
      const cpaBadge = createOrUpdateLabelSprite(
        undefined,
        `⚠ CPA XUNG ĐỘT (${c.time_to_cpa_seconds}s)`,
        `Khoảng cách: ${c.cpa_horizontal_distance_m}m • ΔZ: ${c.cpa_vertical_distance_m}m`,
        '#ef4444',
        false
      );
      cpaBadge.position.set(cpa.x, cpa.y + 42, cpa.z);
      cpaBadge.scale.set(145, 42, 1);
      group.add(cpaBadge);

      const uavA = uavStates[c.uav_a_id];
      const uavB = uavStates[c.uav_b_id];
      if (uavA && uavB) {
        const posA = wgs84ToThree(uavA.position.latitude, uavA.position.longitude, uavA.position.altitude_m);
        const posB = wgs84ToThree(uavB.position.latitude, uavB.position.longitude, uavB.position.altitude_m);
        const linkGeo = new THREE.BufferGeometry().setFromPoints([posA, posB]);
        const linkMat = new THREE.LineDashedMaterial({
          color: '#ef4444',
          dashSize: 12,
          gapSize: 6,
        });
        const linkLine = new THREE.Line(linkGeo, linkMat);
        linkLine.computeLineDistances();
        group.add(linkLine);
      }
    });

    if (previewedOption && previewedOption.projected_trajectory.length > 1) {
      const pts = previewedOption.projected_trajectory.map((pt) =>
        wgs84ToThree(pt.latitude, pt.longitude, pt.altitude_m)
      );
      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeo = new THREE.TubeGeometry(curve, 40, 2.6, 8, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: '#10b981',
        transparent: true,
        opacity: 0.85,
      });
      group.add(new THREE.Mesh(tubeGeo, tubeMat));

      const nodeGeo = new THREE.SphereGeometry(5.5, 10, 10);
      const nodeMat = new THREE.MeshBasicMaterial({ color: '#34d399' });
      pts.forEach((pt) => {
        const orb = new THREE.Mesh(nodeGeo, nodeMat);
        orb.position.copy(pt);
        group.add(orb);
      });
    }
  }, [conflicts, previewedOption, uavStates]);

  const activeUavs = Object.values(uavStates);

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-[#07101f]">
      {/* WebGL Three.js Canvas Mount */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top-Left Compact 3D Airspace HUD */}
      <div className="absolute top-4 left-4 z-10 w-68 bg-slate-950/85 backdrop-blur-md border border-slate-700/70 rounded-lg shadow-xl overflow-hidden text-xs">
        <button
          onClick={() => setHudExpanded(!hudExpanded)}
          className="w-full px-3 py-2 flex items-center justify-between bg-slate-900/90 border-b border-slate-800 text-left hover:bg-slate-800/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionStatus === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
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
                  onClick={() => {
                    focusUav(u.uav_id);
                  }}
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
                    {Math.round(u.velocity.ground_speed_mps)}m/s
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Top-Right 3D Controls & Camera Presets */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-slate-900/90 backdrop-blur-md p-2.5 rounded-lg border border-slate-700/60 shadow-xl w-56">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">
          Góc nhìn 3D
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => flyCameraPreset(new THREE.Vector3(-480, 310, 580), new THREE.Vector3(90, 55, -260))}
            className="flex items-center justify-center gap-1 py-1.5 px-2 text-[11px] font-medium text-cyan-300 bg-cyan-950/70 hover:bg-cyan-900/80 rounded border border-cyan-700/70 transition-all"
          >
            <Compass className="w-3 h-3" />
            Cầu Rồng
          </button>
          <button
            onClick={() => flyCameraPreset(new THREE.Vector3(-1750, 1280, 2250), new THREE.Vector3(150, 40, -650))}
            className="py-1.5 px-2 text-[11px] font-medium text-slate-200 bg-slate-800/90 hover:bg-slate-700 rounded border border-slate-700 transition-all"
          >
            Toàn cảnh
          </button>
        </div>

        <button
          onClick={() => {
            if (!followSelected && !selectedUavId && activeUavs.length > 0) {
              selectUav(activeUavs[0].uav_id);
            }
            setFollowSelected(!followSelected);
          }}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-[11px] font-semibold rounded border transition-all ${
            followSelected
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm'
              : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>{followSelected ? 'Đang bám theo UAV' : 'Bám theo UAV'}</span>
        </button>

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
            Đô thị Đà Nẵng &amp; Cầu
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

        <button
          onClick={() => setHeroScaleMode(!heroScaleMode)}
          className="mt-0.5 flex items-center justify-center gap-1.5 py-1 px-2 text-[10px] font-mono text-slate-300 bg-slate-950/70 hover:bg-slate-800 rounded border border-slate-800 transition-all"
        >
          <Eye className="w-3 h-3 text-cyan-400" />
          Cỡ UAV: {heroScaleMode ? 'Nổi bật (MVP)' : 'Gọn hơn'}
        </button>

        <div className="border-t border-slate-800 my-0.5" />

        <button
          onClick={() => (conflictDemoActive ? stopConflictDemo() : startConflictDemo())}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-[11px] font-semibold rounded border transition-all ${
            conflictDemoActive
              ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400 shadow-md shadow-rose-950 animate-pulse'
              : 'bg-rose-950/70 hover:bg-rose-900/80 text-rose-200 border-rose-700/80'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>{conflictDemoActive ? 'Dừng Kịch bản Xung đột' : 'Mô phỏng Xung đột 3D'}</span>
        </button>
      </div>

      {/* Bottom Interaction Hint */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-slate-950/80 border border-slate-800/90 text-[10px] font-mono text-slate-400 pointer-events-none backdrop-blur-sm">
        Kéo trái: Xoay 360° • Kéo phải: Dịch chuyển • Cuộn: Zoom • Click UAV để theo dõi
      </div>
    </div>
  );
};
