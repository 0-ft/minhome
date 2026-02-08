import { useCallback, useMemo, useRef, useEffect, useState as useReactState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { useDevices, useConfig, useRefreshStates, useSetDevice } from "../api.js";
import type { DeviceData } from "../types.js";
import { extractControls } from "../types.js";

// ── Types matching server config/room.ts ─────────────────
export interface RoomDimensions {
  width: number;
  height: number;
  depth: number;
}

export type FurniturePrimitive =
  | { type: "box"; name?: string; position: [number, number, number]; rotation?: [number, number, number]; size: [number, number, number]; color: string }
  | { type: "cylinder"; name?: string; position: [number, number, number]; rotation?: [number, number, number]; radius: number; height: number; color: string }
  | { type: "extrude"; name?: string; position: [number, number, number]; rotation?: [number, number, number]; points: [number, number][]; depth: number; color: string };

export type FurnitureGroup = { type: "group"; name: string; items: FurniturePrimitive[] };

export type FurnitureItem = FurniturePrimitive | FurnitureGroup;

export interface RoomLightDef {
  deviceId: string;
  entityId?: string;
  position: [number, number, number];
  type: "ceiling" | "desk" | "table" | "floor";
}

export interface CameraConfig {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export interface RoomConfig {
  dimensions: RoomDimensions;
  floor: string;
  furniture: FurnitureItem[];
  lights: RoomLightDef[];
  camera?: CameraConfig;
}

// Default off-state light colour
const LIGHT_OFF_COLOR = "#3a3530";

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
function Room({ dimensions, floorColor }: { dimensions: RoomDimensions; floorColor: string }) {
  return (
    <group>
      {/* Floor */}
      <mesh
        position={[dimensions.width / 2, 0, dimensions.depth / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[dimensions.width, dimensions.depth]} />
        <meshStandardMaterial color={floorColor} />
      </mesh>
    </group>
  );
}

// ── Single furniture primitive mesh ─────────────────────
function FurniturePrimitiveMesh({ item }: { item: FurniturePrimitive }) {
  const rotation: [number, number, number] | undefined = item.rotation;

  switch (item.type) {
    case "box":
      return (
        <mesh
          position={item.position}
          rotation={rotation}
          castShadow
          receiveShadow
        >
          <boxGeometry args={item.size} />
          <meshStandardMaterial color={item.color} />
        </mesh>
      );

    case "cylinder":
      return (
        <mesh
          position={item.position}
          rotation={rotation}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[item.radius, item.radius, item.height, 16]} />
          <meshStandardMaterial color={item.color} />
        </mesh>
      );

    case "extrude": {
      const shape = useMemo(() => {
        const s = new THREE.Shape();
        const pts = item.points;
        s.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          s.lineTo(pts[i][0], pts[i][1]);
        }
        s.closePath();
        return s;
      }, [item.points]);

      return (
        <mesh
          position={item.position}
          rotation={rotation}
          castShadow
          receiveShadow
        >
          <extrudeGeometry args={[shape, { depth: item.depth, bevelEnabled: false }]} />
          <meshStandardMaterial color={item.color} />
        </mesh>
      );
    }
  }
}

// ── Single furniture entry (primitive or group) ─────────
function FurniturePiece({ item }: { item: FurnitureItem }) {
  if (item.type === "group") {
    return (
      <group>
        {item.items.map((child, i) => (
          <FurniturePrimitiveMesh key={i} item={child} />
        ))}
      </group>
    );
  }
  return <FurniturePrimitiveMesh item={item} />;
}

// ── All furniture from config ───────────────────────────
function Furniture({ items }: { items: FurnitureItem[] }) {
  return (
    <group>
      {items.map((item, i) => (
        <FurniturePiece key={i} item={item} />
      ))}
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

  const targetColor = useMemo(() => miredToColor(colorTemp), [colorTemp]);
  const normalizedBr = brightness / 254;
  const targetIntensity = isOn ? normalizedBr * 3 : 0;
  const targetEmissive = isOn ? 0.6 + normalizedBr * 1.4 : 0;
  const targetOpacity = isOn ? 0.92 : 0.55;
  const radius = light.type === "ceiling" ? 0.1 : 0.06;

  // Smooth transition refs — lerp toward targets each frame (~150ms at 60fps)
  const pointLightRef = useRef<THREE.PointLight>(null);
  const curColor = useRef(isOn ? targetColor.clone() : new THREE.Color(LIGHT_OFF_COLOR));
  const curIntensity = useRef(targetIntensity);
  const curEmissive = useRef(targetEmissive);
  const curOpacity = useRef(targetOpacity);
  const LERP = 0.18;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;

    // Lerp color, intensity, emissive, opacity toward targets
    const tgtCol = isOn ? targetColor : new THREE.Color(LIGHT_OFF_COLOR);
    curColor.current.lerp(tgtCol, LERP);
    curIntensity.current = THREE.MathUtils.lerp(curIntensity.current, targetIntensity, LERP);
    curEmissive.current = THREE.MathUtils.lerp(curEmissive.current, targetEmissive, LERP);
    curOpacity.current = THREE.MathUtils.lerp(curOpacity.current, targetOpacity, LERP);

    // Apply to orb material
    mat.color.copy(curColor.current);
    if (curEmissive.current > 0.01) {
      mat.emissive.copy(curColor.current);
      const pulse = 1 + Math.sin(clock.getElapsedTime() * 2) * 0.08;
      mat.emissiveIntensity = curEmissive.current * pulse;
    } else {
      mat.emissive.setScalar(0);
      mat.emissiveIntensity = 0;
    }
    mat.opacity = curOpacity.current;

    // Apply to point light
    if (pointLightRef.current) {
      pointLightRef.current.color.copy(curColor.current);
      pointLightRef.current.intensity = curIntensity.current;
    }

    // Hover scale
    const targetScale = hovered.current ? 1.35 : 1;
    meshRef.current.scale.setScalar(THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.15));
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
        <meshStandardMaterial transparent />
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

      {/* Point light — always mounted so intensity can fade smoothly */}
      <pointLight
        ref={pointLightRef}
        intensity={0}
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
    </group>
  );
}

// ── Camera state getter type ────────────────────────────
export type GetCameraState = () => CameraConfig;

// ── Scene (inside Canvas) ───────────────────────────────
export function Scene({
  roomConfig,
  deviceMap,
  onToggle,
  orbitTarget,
  cameraRef,
}: {
  roomConfig: RoomConfig;
  deviceMap: Map<string, DeviceData>;
  onToggle: (deviceId: string, stateProperty: string, isOn: boolean) => void;
  orbitTarget?: [number, number, number];
  cameraRef?: React.MutableRefObject<GetCameraState | null>;
}) {
  const { dimensions, floor, furniture, lights, camera } = roomConfig;
  const controlsRef = useRef<any>(null);

  // Wire up camera state getter — reads from OrbitControls + camera
  useEffect(() => {
    if (!cameraRef) return;
    cameraRef.current = () => {
      const ctrl = controlsRef.current;
      if (!ctrl) return { position: [0, 0, 0], target: [0, 0, 0], zoom: 100 };
      const cam = ctrl.object as THREE.OrthographicCamera;
      return {
        position: cam.position.toArray() as [number, number, number],
        target: ctrl.target.toArray() as [number, number, number],
        zoom: cam.zoom,
      };
    };
  }, [cameraRef]);

  const defaultTarget: [number, number, number] = orbitTarget ?? [dimensions.width / 2, 0.5, dimensions.depth / 2];
  const initialTarget = camera?.target ?? defaultTarget;

  return (
    <>
      <color attach="background" args={["#100e0c"]} />
      <ambientLight intensity={0.25} color="#f5efe6" />
      <directionalLight position={[4, 6, 2]} intensity={0.15} color="#fff8ee" />

      <Room dimensions={dimensions} floorColor={floor} />
      <Furniture items={furniture} />

      {lights.map((light, i) => (
        <LightOrb
          key={`${light.deviceId}-${light.entityId ?? i}`}
          light={light}
          device={deviceMap.get(light.deviceId)}
          onToggle={onToggle}
        />
      ))}

      <OrbitControls
        ref={controlsRef}
        target={initialTarget}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={2}
        maxDistance={14}
        enableDamping
        dampingFactor={0.12}
      />
    </>
  );
}

// ── Helper to parse room config from API response ───────
function parseRoomConfig(config: unknown): RoomConfig | null {
  const c = config as Record<string, unknown> | undefined;
  const room = c?.room as RoomConfig | undefined;
  if (!room?.dimensions || !room?.floor || !room?.furniture || !room?.lights) return null;
  return room;
}

// ── Shared data hook for room views ─────────────────────
export function useRoomData() {
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

  const roomConfig = useMemo(() => parseRoomConfig(config), [config]);

  const onToggle = useCallback(
    (deviceId: string, stateProperty: string, isOn: boolean) =>
      setDevice.mutate({ id: deviceId, payload: { [stateProperty]: isOn ? "OFF" : "ON" } }),
    [setDevice],
  );

  return {
    deviceMap,
    roomConfig,
    onToggle,
    isLoading: devicesLoading || configLoading,
  };
}

// ── Exported view ───────────────────────────────────────
export function RoomView() {
  const { deviceMap, roomConfig, onToggle, isLoading } = useRoomData();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-sand-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading room…
      </div>
    );
  }

  if (!roomConfig) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-sand-500 font-mono">
        Room not configured
      </div>
    );
  }

  const cam = roomConfig.camera;

  return (
    <div className="w-full h-full min-h-[500px] rounded-xl overflow-hidden bg-sand-200/60 border border-sand-300">
      <Canvas
        orthographic
        camera={{
          position: cam?.position ?? [2.7, 5.5, 8],
          zoom: cam?.zoom ?? 100,
        }}
        shadows={{ type: THREE.VSMShadowMap }}
      >
        <Scene
          roomConfig={roomConfig}
          deviceMap={deviceMap}
          onToggle={onToggle}
        />
      </Canvas>
    </div>
  );
}
