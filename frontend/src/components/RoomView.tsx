import { useMemo, useRef, useEffect, useState as useReactState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { useDevices, useConfig, useRefreshStates, useSetDevice } from "../api.js";
import type { DeviceData } from "../types.js";
import { extractControls } from "../types.js";

// ── Room dimensions ──────────────────────────────────────
export const ROOM_W = 5.4;
const ROOM_H = 2.5;
export const ROOM_D = 3;
// ── Palette (muted earth tones) ─────────────────────────
const C = {
  floor: "#cdc0ae",
  wall: "#ddd5c8",
  bed: "#8b7355",
  bedding: "#b8a690",
  desk: "#a69880",
  shelving: "#7d6f5c",
  drawers: "#9b8c76",
  lightOff: "#666",
};

export interface RoomLightDef {
  deviceId: string;
  entityId?: string;
  position: [number, number, number];
  type: "ceiling" | "desk" | "table" | "floor";
}

// ── Color temp (mired) → warm/cool white ────────────────
function miredToColor(mired: number): THREE.Color {
  const t = Math.max(0, Math.min(1, (mired - 142) / (500 - 142)));
  return new THREE.Color(
    1.0,
    Math.max(0.55, 0.95 - t * 0.35),
    Math.max(0.25, 0.85 - t * 0.55),
  );
}

// ── Room shell ──────────────────────────────────────────
function Room() {
  const wireframeGeo = useMemo(() => new THREE.BoxGeometry(ROOM_W, ROOM_H, ROOM_D), []);
  const wireframeEdges = useMemo(() => new THREE.EdgesGeometry(wireframeGeo), [wireframeGeo]);

  return (
    <group>
      {/* Floor */}
      <mesh position={[ROOM_W / 2, 0, ROOM_D / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color={C.floor} />
      </mesh>

      {/* Wireframe outline of room (hidden for now) */}
      {/* <lineSegments geometry={wireframeEdges} position={[ROOM_W / 2, ROOM_H / 2, ROOM_D / 2]}>
        <lineBasicMaterial color="#d6625c" transparent opacity={0.3} />
      </lineSegments> */}
    </group>
  );
}

// ── Furniture ───────────────────────────────────────────
function Furniture() {
  return (
    <group>
      {/* ── Bed (NW) 1.5 × 2m, h≈0.45 ── */}
      {/* Frame */}
      <mesh position={[0.75, 0.18, 1.0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.36, 2.0]} />
        <meshStandardMaterial color={C.bed} />
      </mesh>
      {/* Mattress / bedding */}
      <mesh position={[0.75, 0.4, 1.05]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.1, 1.85]} />
        <meshStandardMaterial color={C.bedding} />
      </mesh>
      {/* Headboard */}
      <mesh position={[0.75, 0.5, 0.04]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.65, 0.06]} />
        <meshStandardMaterial color={C.bed} />
      </mesh>

      {/* ── Desk (N edge) 2.0 × 0.6m, top at 0.75m ── */}
      {/* Top surface */}
      <mesh position={[2.8, 0.73, 0.3]} castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.04, 0.6]} />
        <meshStandardMaterial color={C.desk} />
      </mesh>
      {/* Legs */}
      {[
        [1.84, 0.08],
        [3.76, 0.08],
        [1.84, 0.52],
        [3.76, 0.52],
      ].map(([x, z], i) => (
        <mesh key={`dleg${i}`} position={[x, 0.355, z]} castShadow receiveShadow>
          <boxGeometry args={[0.04, 0.71, 0.04]} />
          <meshStandardMaterial color={C.desk} />
        </mesh>
      ))}

      {/* ── Shelving NE 0.85 × 0.55m, h=1.9m, 4 posts + 5 shelves ── */}
      {/* Four corner posts (0.03 × 0.03 × 1.9m) */}
      {[
        [4.565, 0.02],
        [5.385, 0.02],
        [4.565, 0.53],
        [5.385, 0.53],
      ].map(([x, z], i) => (
        <mesh key={`nepost${i}`} position={[x, 0.95, z]} castShadow receiveShadow>
          <boxGeometry args={[0.03, 1.9, 0.03]} />
          <meshStandardMaterial color={C.shelving} />
        </mesh>
      ))}
      {/* 5 shelves (bottom, 3 middle, top) — each 6cm thick */}
      {[0.03, 0.49, 0.95, 1.41, 1.87].map((y, i) => (
        <mesh key={`neshelf${i}`} position={[4.975, y, 0.275]} castShadow receiveShadow>
          <boxGeometry args={[0.85, 0.06, 0.55]} />
          <meshStandardMaterial color={C.shelving} />
        </mesh>
      ))}

      {/* ── Drawers (center S) 0.77 × 0.39m, h≈0.41m ── */}
      <mesh position={[2.7, 0.205, 2.805]} castShadow receiveShadow>
        <boxGeometry args={[0.77, 0.41, 0.39]} />
        <meshStandardMaterial color={C.drawers} />
      </mesh>

      {/* ── Small shelving (W of drawers) 0.40 × 0.35m, h≈0.57m ── */}
      <mesh position={[2.115, 0.285, 2.825]} castShadow receiveShadow>
        <boxGeometry args={[0.4, 0.57, 0.35]} />
        <meshStandardMaterial color={C.shelving} />
      </mesh>
    </group>
  );
}

// ── Animated light orb ──────────────────────────────────
function LightOrb({
  light,
  device,
  onToggle,
}: {
  light: RoomLightDef;
  device?: DeviceData;
  onToggle: (deviceId: string, stateProperty: string, isOn: boolean) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [showLabel, setShowLabel] = useReactState(false);
  const hovered = useRef(false);

  const label = useMemo(() => {
    if (!device) return light.deviceId;
    if (light.entityId && device.entities?.[light.entityId]) return device.entities[light.entityId];
    return device.name;
  }, [device, light.deviceId, light.entityId]);

  const { isOn, brightness, colorTemp, stateProperty } = useMemo(() => {
    if (!device) return { isOn: false, brightness: 0, colorTemp: 370, stateProperty: "state" };
    const controls = extractControls(device.exposes);
    const ctrl = light.entityId
      ? controls.find((c) => c.endpoint === light.entityId)
      : controls[0];
    if (!ctrl) return { isOn: false, brightness: 0, colorTemp: 370, stateProperty: "state" };

    const on = device.state?.[ctrl.stateProperty] === "ON";
    const br =
      ctrl.brightnessProperty &&
      typeof device.state?.[ctrl.brightnessProperty] === "number"
        ? (device.state[ctrl.brightnessProperty] as number)
        : 127;
    const ct =
      ctrl.colorTempProperty &&
      typeof device.state?.[ctrl.colorTempProperty] === "number"
        ? (device.state[ctrl.colorTempProperty] as number)
        : 370;

    return { isOn: on, brightness: br, colorTemp: ct, stateProperty: ctrl.stateProperty };
  }, [device, light.entityId]);

  const lightColor = useMemo(() => miredToColor(colorTemp), [colorTemp]);
  const normalizedBr = brightness / 254;
  const intensity = isOn ? normalizedBr * 3 : 0;
  const emissiveStr = isOn ? 0.6 + normalizedBr * 1.4 : 0;
  const radius = light.type === "ceiling" ? 0.1 : 0.06;

  // Gentle pulse when on + hover expand
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    if (isOn) {
      const pulse = 1 + Math.sin(clock.getElapsedTime() * 2) * 0.08;
      mat.emissiveIntensity = emissiveStr * pulse;
    } else {
      mat.emissiveIntensity = 0;
    }
    const targetScale = hovered.current ? 1.35 : 1;
    const s = meshRef.current.scale.x;
    const next = THREE.MathUtils.lerp(s, targetScale, 0.15);
    meshRef.current.scale.setScalar(next);
  });

  return (
    <group position={light.position}>
      {/* Visible orb — click to toggle */}
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onToggle(light.deviceId, stateProperty, isOn); }}
        onPointerOver={(e) => { e.stopPropagation(); hovered.current = true; setShowLabel(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { hovered.current = false; setShowLabel(false); document.body.style.cursor = ""; }}
      >
        <sphereGeometry args={[radius, 16, 16]} />
        <meshStandardMaterial
          color={isOn ? lightColor : C.lightOff}
          emissive={isOn ? lightColor : new THREE.Color(0, 0, 0)}
          emissiveIntensity={emissiveStr}
          transparent
          opacity={isOn ? 0.92 : 0.35}
        />
      </mesh>

      {/* Name label on hover */}
      <Html position={[0, radius + 0.15, 0]} center style={{ pointerEvents: "none" }}>
        <div
          className={`px-2 py-0.5 rounded bg-blood-500/90 text-sand-50 text-[10px] font-mono whitespace-nowrap shadow-lg transition-all duration-200 ${
            showLabel ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
          }`}
        >
          {label}
        </div>
      </Html>

      {/* Point light */}
      {isOn && (
        <pointLight
          color={lightColor}
          intensity={intensity}
          distance={light.type === "ceiling" ? 8 : 3.5}
          decay={2}
          castShadow
          shadow-mapSize-width={512}
          shadow-mapSize-height={512}
          shadow-camera-near={0.1}
          shadow-camera-far={10}
          shadow-radius={8}
          shadow-blurSamples={25}
        />
      )}
    </group>
  );
}

// ── Scene (inside Canvas) ───────────────────────────────
export function Scene({
  roomLights,
  deviceMap,
  onToggle,
  orbitTarget,
}: {
  roomLights: RoomLightDef[];
  deviceMap: Map<string, DeviceData>;
  onToggle: (deviceId: string, stateProperty: string, isOn: boolean) => void;
  orbitTarget?: [number, number, number];
}) {
  return (
    <>
      <color attach="background" args={["#100e0c"]} />
      <ambientLight intensity={0.25} color="#f5efe6" />
      <directionalLight position={[4, 6, 2]} intensity={0.15} color="#fff8ee" />

      <Room />
      <Furniture />

      {roomLights.map((light, i) => (
        <LightOrb
          key={`${light.deviceId}-${light.entityId ?? i}`}
          light={light}
          device={deviceMap.get(light.deviceId)}
          onToggle={onToggle}
        />
      ))}

      <OrbitControls
        target={orbitTarget ?? [ROOM_W / 2, 0.5, ROOM_D / 2]}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={2}
        maxDistance={14}
        enableDamping
        dampingFactor={0.12}
      />
    </>
  );
}

// ── Exported view ───────────────────────────────────────
export function RoomView() {
  const { data: devices, isLoading: devicesLoading } = useDevices();
  const { data: config, isLoading: configLoading } = useConfig();
  const refreshStates = useRefreshStates();
  const setDevice = useSetDevice();

  const hasRefreshed = useRef(false);
  useEffect(() => {
    if (!hasRefreshed.current) {
      hasRefreshed.current = true;
      refreshStates.mutate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const deviceMap = useMemo(() => {
    const map = new Map<string, DeviceData>();
    if (devices && Array.isArray(devices)) {
      for (const d of devices as DeviceData[]) map.set(d.id, d);
    }
    return map;
  }, [devices]);

  const roomLights: RoomLightDef[] = useMemo(
    () => (config as Record<string, unknown>)?.room
      ? ((config as Record<string, unknown>).room as { lights: RoomLightDef[] }).lights ?? []
      : [],
    [config],
  );

  if (devicesLoading || configLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-sand-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading room…
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[500px] rounded-xl overflow-hidden bg-sand-200/60 border border-sand-300">
      <Canvas orthographic camera={{ position: [2.7, 5.5, 8], zoom: 100 }} shadows={{ type: THREE.VSMShadowMap }}>
        <Scene
          roomLights={roomLights}
          deviceMap={deviceMap}
          onToggle={(deviceId, stateProperty, isOn) =>
            setDevice.mutate({ id: deviceId, payload: { [stateProperty]: isOn ? "OFF" : "ON" } })
          }
        />
      </Canvas>
    </div>
  );
}

