import { useCallback, useMemo, useRef, useEffect, useState as useReactState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { Zap as ZapIcon } from "lucide-react";
import { useDevices, useConfig, useRefreshStates, useSetDevice, useDeviceEvent } from "../api.js";
import type { DeviceData, Entity } from "../types.js";

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
  entityId: string;
  position: [number, number, number];
  type: "ceiling" | "desk" | "table" | "floor";
}

export interface RoomSensorDef {
  deviceId: string;
  entityId: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  type: "motion" | "contact" | "temperature" | "generic";
  shape?: FurniturePrimitive;
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
  sensors?: RoomSensorDef[];
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

// ── Find entity for a room light ────────────────────────
function findEntityForLight(device: DeviceData | undefined, entityId: string): Entity | undefined {
  if (!device) return undefined;
  return device.entities?.find(e => e.key === entityId);
}

// ── Drag overlay (2D ring UI around orb during drag) ────
function DragOverlay({
  brightness,
  hue,
  saturation,
  hasColor,
  hasBrightness,
}: {
  brightness: number;
  hue: number;
  saturation: number;
  hasColor: boolean;
  hasBrightness: boolean;
}) {
  const pct = Math.round((brightness / 254) * 100);
  const R = 38;
  const circumference = 2 * Math.PI * R;
  const arcLength = (pct / 100) * circumference;

  // Arc colour: use the current hue if colour-capable, otherwise a warm white
  const arcColor = hasColor
    ? `hsl(${hue}, ${Math.max(saturation, 40)}%, 55%)`
    : `hsl(40, 60%, ${45 + pct * 0.25}%)`;

  return (
    <div style={{ pointerEvents: "none", userSelect: "none" }}>
      <svg viewBox="0 0 100 100" width={100} height={100} style={{ display: "block" }}>
        {/* Dark backdrop */}
        <circle cx="50" cy="50" r="46" fill="rgba(16,14,12,0.8)" />
        {/* Track ring */}
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
        {/* Brightness arc — fills clockwise from 12 o'clock */}
        {hasBrightness && pct > 0 && (
          <circle
            cx="50" cy="50" r={R}
            fill="none"
            stroke={arcColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            transform="rotate(-90 50 50)"
            style={{ filter: `drop-shadow(0 0 4px ${arcColor})` }}
          />
        )}
        {/* Percentage text */}
        <text
          x="50" y="52"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="14"
          fontFamily="'Space Mono', monospace"
          fill="rgba(255,255,255,0.85)"
        >
          {pct}%
        </text>
        {/* Drag direction hints */}
        <text
          x="50" y="92"
          textAnchor="middle"
          fontSize="7"
          fontFamily="'Space Mono', monospace"
          fill="rgba(255,255,255,0.3)"
        >
          {hasBrightness ? "↕ bright" : ""}{hasBrightness && hasColor ? "  " : ""}{hasColor ? "↔ colour" : ""}
        </text>
      </svg>
    </div>
  );
}

// ── Animated light orb (click to toggle, drag to adjust) ─
function LightOrb({
  light,
  device,
  onToggle,
  onDragSet,
  setOrbitEnabled,
}: {
  light: RoomLightDef;
  device?: DeviceData;
  onToggle: (deviceId: string, stateProperty: string, isOn: boolean) => void;
  onDragSet?: (deviceId: string, payload: Record<string, unknown>) => void;
  setOrbitEnabled?: (enabled: boolean) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [showLabel, setShowLabel] = useReactState(false);
  const hovered = useRef(false);

  const entity = useMemo(() => findEntityForLight(device, light.entityId), [device, light.entityId]);

  const label = useMemo(() => {
    if (entity) return entity.name;
    if (device) return device.name;
    return light.deviceId;
  }, [entity, device, light.deviceId]);

  // ── Server state ─────────────────────────────────────
  const { isOn, brightness, colorTemp, stateProperty, colorHue, colorSaturation, colorMode } = useMemo(() => {
    if (!entity) return { isOn: false, brightness: 0, colorTemp: 370, stateProperty: "state", colorHue: 0, colorSaturation: 100, colorMode: undefined as string | undefined };

    const { features, state } = entity;
    const on = state?.[features.stateProperty] === "ON";
    const br =
      features.brightnessProperty &&
      typeof state?.[features.brightnessProperty] === "number"
        ? (state[features.brightnessProperty] as number)
        : 127;
    const ct =
      features.colorTempProperty &&
      typeof state?.[features.colorTempProperty] === "number"
        ? (state[features.colorTempProperty] as number)
        : 370;

    const colorObj = features.colorProperty && state?.[features.colorProperty] as { hue?: number; saturation?: number } | undefined;
    const hue = typeof colorObj?.hue === "number" ? colorObj.hue : 0;
    const sat = typeof colorObj?.saturation === "number" ? colorObj.saturation : 100;
    const colorModeProp = features.colorProperty ? features.colorProperty.replace("color", "color_mode") : undefined;
    const cm = colorModeProp && typeof state?.[colorModeProp] === "string" ? state[colorModeProp] as string : undefined;

    return { isOn: on, brightness: br, colorTemp: ct, stateProperty: features.stateProperty, colorHue: hue, colorSaturation: sat, colorMode: cm };
  }, [entity]);

  // ── Feature checks ───────────────────────────────────
  const hasBrightness = !!entity?.features.brightnessProperty;
  const hasColor = !!entity?.features.colorProperty;
  const canDrag = (hasBrightness || hasColor) && !!onDragSet;

  // ── Drag state ───────────────────────────────────────
  const [dragState, setDragState] = useReactState<{
    brightness: number;
    hue: number;
    saturation: number;
  } | null>(null);

  const dragRef = useRef({
    startX: 0, startY: 0,
    startBrightness: 0, startHue: 0, startSaturation: 0,
    hasMoved: false, sentOn: false,
  });
  const latestDragRef = useRef<{ brightness: number; hue: number; saturation: number } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Effective values (prefer drag state for instant feedback) ─
  const effectiveBrightness = dragState?.brightness ?? brightness;
  const effectiveHue = dragState?.hue ?? colorHue;
  const effectiveSat = dragState?.saturation ?? colorSaturation;
  const effectiveIsOn = dragState ? true : isOn;

  const targetColor = useMemo(() => {
    if (hasColor && (colorMode === "hs" || colorMode === "xy" || dragState)) {
      return new THREE.Color().setHSL(effectiveHue / 360, effectiveSat / 100, 0.5);
    }
    return miredToColor(colorTemp);
  }, [colorTemp, colorMode, effectiveHue, effectiveSat, hasColor, dragState]);

  const normalizedBr = effectiveBrightness / 254;
  const targetIntensity = effectiveIsOn ? normalizedBr * 4 : 0;
  const targetEmissive = effectiveIsOn ? 0.6 + normalizedBr * 1.4 : 0;
  const targetOpacity = effectiveIsOn ? 0.92 : 0.55;
  const radius = light.type === "ceiling" ? 0.1 : 0.06;

  // ── Smooth transition animation ──────────────────────
  const pointLightRef = useRef<THREE.PointLight>(null);
  const curColor = useRef(effectiveIsOn ? targetColor.clone() : new THREE.Color(LIGHT_OFF_COLOR));
  const curIntensity = useRef(targetIntensity);
  const curEmissive = useRef(targetEmissive);
  const curOpacity = useRef(targetOpacity);
  const LERP = 0.18;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;

    const tgtCol = effectiveIsOn ? targetColor : new THREE.Color(LIGHT_OFF_COLOR);
    curColor.current.lerp(tgtCol, LERP);
    curIntensity.current = THREE.MathUtils.lerp(curIntensity.current, targetIntensity, LERP);
    curEmissive.current = THREE.MathUtils.lerp(curEmissive.current, targetEmissive, LERP);
    curOpacity.current = THREE.MathUtils.lerp(curOpacity.current, targetOpacity, LERP);

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

    if (pointLightRef.current) {
      pointLightRef.current.color.copy(curColor.current);
      pointLightRef.current.intensity = curIntensity.current;
    }

    const targetScale = hovered.current ? 1.35 : 1;
    meshRef.current.scale.setScalar(THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.15));
  });

  // ── Pointer handling (drag + click) ──────────────────
  // Stable refs for values needed inside window event listeners
  const stableRef = useRef({ entity, stateProperty, isOn, brightness, colorHue, colorSaturation, hasBrightness, hasColor, onDragSet, onToggle, light });
  stableRef.current = { entity, stateProperty, isOn, brightness, colorHue, colorSaturation, hasBrightness, hasColor, onDragSet, onToggle, light };

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    const ne = e.nativeEvent as PointerEvent;
    const s = stableRef.current;

    dragRef.current = {
      startX: ne.clientX, startY: ne.clientY,
      startBrightness: s.brightness, startHue: s.colorHue, startSaturation: s.colorSaturation,
      hasMoved: false, sentOn: false,
    };

    if (canDrag) setOrbitEnabled?.(false);

    const onMove = (ev: PointerEvent) => {
      if (!canDrag) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;

      if (!dragRef.current.hasMoved && (Math.abs(dx) + Math.abs(dy)) > 5) {
        dragRef.current.hasMoved = true;
        document.body.style.cursor = "grabbing";
      }
      if (!dragRef.current.hasMoved) return;

      const cur = stableRef.current;
      const newBr = cur.hasBrightness
        ? Math.max(1, Math.min(254, Math.round(dragRef.current.startBrightness - dy * 1.5)))
        : dragRef.current.startBrightness;
      const newHue = cur.hasColor
        ? ((Math.round(dragRef.current.startHue + dx * 1.2) % 360) + 360) % 360
        : dragRef.current.startHue;

      const vals = { brightness: newBr, hue: newHue, saturation: dragRef.current.startSaturation };
      latestDragRef.current = vals;
      setDragState(vals);

      // Debounced live update
      clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        const c = stableRef.current;
        const payload: Record<string, unknown> = {};
        if (!c.isOn && !dragRef.current.sentOn) {
          payload[c.stateProperty] = "ON";
          dragRef.current.sentOn = true;
        }
        if (c.hasBrightness && c.entity?.features.brightnessProperty) {
          payload[c.entity.features.brightnessProperty] = newBr;
        }
        if (c.hasColor && c.entity?.features.colorProperty) {
          payload[c.entity.features.colorProperty] = { hue: newHue, saturation: dragRef.current.startSaturation };
        }
        c.onDragSet?.(c.light.deviceId, payload);
      }, 80);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setOrbitEnabled?.(true);
      document.body.style.cursor = hovered.current ? "pointer" : "";

      if (dragRef.current.hasMoved) {
        // Final commit with latest values
        clearTimeout(commitTimer.current);
        const latest = latestDragRef.current;
        const c = stableRef.current;
        if (latest && c.onDragSet) {
          const payload: Record<string, unknown> = {};
          if (!c.isOn && !dragRef.current.sentOn) {
            payload[c.stateProperty] = "ON";
          }
          if (c.hasBrightness && c.entity?.features.brightnessProperty) {
            payload[c.entity.features.brightnessProperty] = latest.brightness;
          }
          if (c.hasColor && c.entity?.features.colorProperty) {
            payload[c.entity.features.colorProperty] = { hue: latest.hue, saturation: latest.saturation };
          }
          c.onDragSet(c.light.deviceId, payload);
        }
        latestDragRef.current = null;
        setDragState(null);
      } else {
        // No drag — treat as click toggle
        const c = stableRef.current;
        c.onToggle(c.light.deviceId, c.stateProperty, c.isOn);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [canDrag, setOrbitEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(commitTimer.current), []);

  return (
    <group position={light.position}>
      {/* Drag overlay — shown while adjusting */}
      {dragState && (
        <Html center style={{ pointerEvents: "none" }}>
          <DragOverlay
            brightness={dragState.brightness}
            hue={dragState.hue}
            saturation={dragState.saturation}
            hasColor={hasColor}
            hasBrightness={hasBrightness}
          />
        </Html>
      )}

      {/* Visible orb — pointer down starts drag detection */}
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onPointerOver={(e) => { e.stopPropagation(); hovered.current = true; if (!dragState) setShowLabel(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { hovered.current = false; setShowLabel(false); if (!dragState) document.body.style.cursor = ""; }}
      >
        <sphereGeometry args={[radius, 16, 16]} />
        <meshStandardMaterial transparent />
      </mesh>

      {/* Name label on hover (hidden during drag) */}
      <Html position={[0, radius + 0.15, 0]} center style={{ pointerEvents: "none" }}>
        <div
          className={`px-2 py-0.5 rounded bg-blood-500/90 text-sand-50 text-[10px] font-mono whitespace-nowrap shadow-lg transition-all duration-200 ${
            showLabel && !dragState ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
          }`}
        >
          {label}
        </div>
      </Html>

      {/* Point light — always mounted so intensity can fade smoothly */}
      <pointLight
        ref={pointLightRef}
        intensity={0}
        distance={light.type === "ceiling" ? 14 : 7}
        decay={1.5}
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

// ── Sensor type → color map ─────────────────────────────
const SENSOR_COLORS: Record<RoomSensorDef["type"], string> = {
  motion: "#4a9eff",
  contact: "#4adb8a",
  temperature: "#ff8a4a",
  generic: "#a78bfa",
};

// ── Sensor event pop animation (2D lightning bolt) ──────
const EVENT_DURATION = 0.9; // seconds
const EVENT_COLOR = "#00e5ff";

function SensorEventPop({ startTime }: { startTime: number }) {
  const divRef = useRef<HTMLDivElement>(null);

  useFrame(({ clock }) => {
    if (!divRef.current) return;
    const elapsed = clock.getElapsedTime() - startTime;
    const t = Math.min(elapsed / EVENT_DURATION, 1);

    // Quick fade in (first 15%), hold, then fade out
    const fadeIn = Math.min(t / 0.15, 1);
    const fadeOut = t > 0.5 ? 1 - (t - 0.5) / 0.5 : 1;
    const opacity = fadeIn * fadeOut;

    // Small bounce: rise up then settle
    const bounce = t < 0.3
      ? t / 0.3             // rise
      : 1 - Math.sin((t - 0.3) / 0.7 * Math.PI) * 0.3; // settle with overshoot
    const y = -bounce * 12; // px upward

    divRef.current.style.opacity = String(Math.max(0, opacity));
    divRef.current.style.transform = `translateY(${y}px) scale(${0.8 + fadeIn * 0.2})`;
  });

  return (
    <Html position={[0, 0.08, 0]} center style={{ pointerEvents: "none" }}>
      <div
        ref={divRef}
        style={{ opacity: 0, willChange: "transform, opacity" }}
        className="flex items-center justify-center drop-shadow-[0_0_6px_rgba(0,229,255,0.7)]"
      >
        <ZapIcon size={18} color={EVENT_COLOR} fill={EVENT_COLOR} strokeWidth={2} />
      </div>
    </Html>
  );
}

// ── Find entity for a room sensor ───────────────────────
function findEntityForSensor(device: DeviceData | undefined, entityId: string): Entity | undefined {
  if (!device) return undefined;
  return device.entities?.find(e => e.key === entityId);
}

// ── Animated sensor with ripple ─────────────────────────
function SensorOrb({
  sensor,
  device,
}: {
  sensor: RoomSensorDef;
  device?: DeviceData;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [showLabel, setShowLabel] = useReactState(false);
  const hovered = useRef(false);

  const entity = useMemo(() => findEntityForSensor(device, sensor.entityId), [device, sensor.entityId]);

  const label = useMemo(() => {
    if (entity) return entity.name;
    if (device) return device.name;
    return sensor.deviceId;
  }, [entity, device, sensor.deviceId]);

  // Build a display string for the label
  const stateDisplay = useMemo(() => {
    if (!entity?.sensorProperties || !entity.state) return "";
    const parts: string[] = [];
    for (const sp of entity.sensorProperties) {
      const val = entity.state[sp.property];
      if (val !== undefined && val !== null) {
        if (typeof val === "boolean") {
          parts.push(`${sp.name}: ${val ? "yes" : "no"}`);
        } else {
          parts.push(`${sp.name}: ${val}${sp.unit ?? ""}`);
        }
      }
    }
    return parts.join(" · ");
  }, [entity]);

  // Ripple state
  const [ripples, setRipples] = useReactState<number[]>([]);
  const clockRef = useRef(0);

  // The set of MQTT property names we care about for this sensor
  const sensorProps = useMemo(() => {
    if (!entity?.sensorProperties) return new Set<string>();
    return new Set(entity.sensorProperties.map(sp => sp.property));
  }, [entity?.sensorProperties]);

  // Store the clock time each frame so we can reference it outside useFrame
  useFrame(({ clock }) => {
    clockRef.current = clock.getElapsedTime();

    // Hover scale for default orb
    if (meshRef.current) {
      const targetScale = hovered.current ? 1.35 : 1;
      meshRef.current.scale.setScalar(THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.15));
    }
  });

  // Subscribe to raw WebSocket state_change events → spawn ripple on any
  // incoming MQTT message that contains a relevant sensor property
  useDeviceEvent(sensor.deviceId, useCallback((state: Record<string, unknown>) => {
    if (sensorProps.size === 0) return;
    const hasRelevant = Object.keys(state).some(k => sensorProps.has(k));
    if (hasRelevant) {
      setRipples(prev => [...prev, clockRef.current]);
    }
  }, [sensorProps]));

  // Clean up finished ripples
  useEffect(() => {
    if (ripples.length === 0) return;
    const timer = setTimeout(() => {
      const now = clockRef.current;
      setRipples(prev => prev.filter(t => now - t < EVENT_DURATION));
    }, EVENT_DURATION * 1000 + 100);
    return () => clearTimeout(timer);
  }, [ripples]);

  const color = SENSOR_COLORS[sensor.type];

  return (
    <group position={sensor.position} rotation={sensor.rotation}>
      {/* Visual body — custom shape or default orb */}
      {sensor.shape ? (
        <FurniturePrimitiveMesh item={sensor.shape} />
      ) : (
        <mesh
          ref={meshRef}
          onPointerOver={(e) => { e.stopPropagation(); hovered.current = true; setShowLabel(true); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { hovered.current = false; setShowLabel(false); document.body.style.cursor = ""; }}
        >
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshStandardMaterial color={color} transparent opacity={0.7} emissive={color} emissiveIntensity={0.3} />
        </mesh>
      )}

      {/* Hover interaction overlay for custom shapes */}
      {sensor.shape && (
        <mesh
          visible={false}
          onPointerOver={(e) => { e.stopPropagation(); hovered.current = true; setShowLabel(true); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { hovered.current = false; setShowLabel(false); document.body.style.cursor = ""; }}
        >
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshBasicMaterial />
        </mesh>
      )}

      {/* Name + state label on hover */}
      <Html position={[0, 0.2, 0]} center style={{ pointerEvents: "none" }}>
        <div
          className={`px-2 py-0.5 rounded bg-blood-500/90 text-sand-50 text-[10px] font-mono whitespace-nowrap shadow-lg transition-all duration-200 ${
            showLabel ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
          }`}
        >
          {label}{stateDisplay ? ` — ${stateDisplay}` : ""}
        </div>
      </Html>

      {/* Event pop animations */}
      {ripples.map((t) => (
        <SensorEventPop key={t} startTime={t} />
      ))}
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
  onDragSet,
  orbitTarget,
  cameraRef,
}: {
  roomConfig: RoomConfig;
  deviceMap: Map<string, DeviceData>;
  onToggle: (deviceId: string, stateProperty: string, isOn: boolean) => void;
  onDragSet?: (deviceId: string, payload: Record<string, unknown>) => void;
  orbitTarget?: [number, number, number];
  cameraRef?: React.MutableRefObject<GetCameraState | null>;
}) {
  const { dimensions, floor, furniture, lights, sensors, camera } = roomConfig;
  const controlsRef = useRef<any>(null);

  // Disable orbit controls while a light orb is being dragged
  const setOrbitEnabled = useCallback((enabled: boolean) => {
    if (controlsRef.current) controlsRef.current.enabled = enabled;
  }, []);

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
          onDragSet={onDragSet}
          setOrbitEnabled={setOrbitEnabled}
        />
      ))}

      {(sensors ?? []).map((sensor, i) => (
        <SensorOrb
          key={`sensor-${sensor.deviceId}-${sensor.entityId ?? i}`}
          sensor={sensor}
          device={deviceMap.get(sensor.deviceId)}
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
  return { ...room, sensors: room.sensors ?? [] };
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

  const onDragSet = useCallback(
    (deviceId: string, payload: Record<string, unknown>) =>
      setDevice.mutate({ id: deviceId, payload }),
    [setDevice],
  );

  return {
    deviceMap,
    roomConfig,
    onToggle,
    onDragSet,
    isLoading: devicesLoading || configLoading,
  };
}

// ── Exported view ───────────────────────────────────────
export function RoomView() {
  const { deviceMap, roomConfig, onToggle, onDragSet, isLoading } = useRoomData();

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
          onDragSet={onDragSet}
        />
      </Canvas>
    </div>
  );
}
