import { randomUUID } from "node:crypto";
import type { MqttBridge } from "./mqtt.js";
import type { VibeEntitySetting } from "./config/vibes.js";
import { applySettings, captureVibeSettings, type ApplySettingsResult } from "./vibes.js";
import { debugLog } from "./debug-log.js";

/**
 * Temporary snapshots of every light and switch, for "try things, then put
 * them back" flows such as previewing vibes. Kept in memory only: a server
 * restart drops them (including any pending auto-restore).
 */

export type CheckpointExpiry = "restore" | "discard";

export const CHECKPOINT_DEFAULT_TTL_SECONDS = 60 * 60;
export const CHECKPOINT_MAX_TTL_SECONDS = 24 * 60 * 60;
const MAX_CHECKPOINTS = 50;

interface Checkpoint {
  id: string;
  label?: string;
  createdAt: string;
  ttlSeconds: number;
  expiresAt: number;
  onExpiry: CheckpointExpiry;
  settings: VibeEntitySetting[];
  timer: ReturnType<typeof setTimeout>;
}

/** What the API and tools return about a checkpoint. */
export interface CheckpointInfo {
  id: string;
  label?: string;
  createdAt: string;
  expiresAt: string;
  ttlSeconds: number;
  onExpiry: CheckpointExpiry;
  /** How many entities it holds a state for. */
  entityCount: number;
}

export interface RestoreCheckpointResult extends ApplySettingsResult {
  ok: true;
  checkpoint: string;
  at: string;
}

export class CheckpointStore {
  private checkpoints = new Map<string, Checkpoint>();

  constructor(private bridge: MqttBridge) {}

  /** Save the current state of every light and switch. */
  create(options: { ttlSeconds?: number; onExpiry?: CheckpointExpiry; label?: string } = {}): CheckpointInfo {
    // Bounded, so forgotten checkpoints can't pile up: drop the oldest
    while (this.checkpoints.size >= MAX_CHECKPOINTS) {
      const [oldestId] = this.checkpoints.keys();
      this.discard(oldestId);
    }
    const ttlSeconds = clampTtl(options.ttlSeconds);
    const checkpoint: Checkpoint = {
      id: randomUUID(),
      label: options.label,
      createdAt: new Date().toISOString(),
      ttlSeconds,
      expiresAt: 0,
      onExpiry: options.onExpiry ?? "discard",
      settings: captureVibeSettings(this.bridge),
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    this.schedule(checkpoint, ttlSeconds);
    this.checkpoints.set(checkpoint.id, checkpoint);
    return info(checkpoint);
  }

  list(): CheckpointInfo[] {
    return [...this.checkpoints.values()].map(info);
  }

  get(id: string): CheckpointInfo | undefined {
    const checkpoint = this.checkpoints.get(id);
    return checkpoint && info(checkpoint);
  }

  /** Push the expiry back by `ttlSeconds` (default: the checkpoint's own TTL) from now. */
  keepalive(id: string, ttlSeconds?: number): CheckpointInfo {
    const checkpoint = this.require(id);
    const ttl = ttlSeconds === undefined ? checkpoint.ttlSeconds : clampTtl(ttlSeconds);
    checkpoint.ttlSeconds = ttl;
    this.schedule(checkpoint, ttl);
    return info(checkpoint);
  }

  /**
   * Return every entity to its saved state and remove the checkpoint. Only
   * entities that changed get commands, unless `force` sends every one.
   */
  restore(id: string, options: { transition?: number; force?: boolean } = {}): RestoreCheckpointResult {
    const checkpoint = this.require(id);
    this.remove(checkpoint);
    const result: RestoreCheckpointResult = {
      ok: true,
      checkpoint: checkpoint.id,
      ...applySettings(this.bridge, checkpoint.settings, {
        offUnspecified: false,
        force: options.force ?? false,
        transition: options.transition,
      }),
      at: new Date().toISOString(),
    };
    debugLog.add("checkpoint_restored", `Checkpoint restored${checkpoint.label ? `: ${checkpoint.label}` : ""}`, result);
    return result;
  }

  /** Forget a checkpoint without changing anything. */
  discard(id: string): void {
    this.remove(this.require(id));
  }

  private require(id: string): Checkpoint {
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint) throw new Error("Checkpoint not found");
    return checkpoint;
  }

  private remove(checkpoint: Checkpoint): void {
    clearTimeout(checkpoint.timer);
    this.checkpoints.delete(checkpoint.id);
  }

  private schedule(checkpoint: Checkpoint, ttlSeconds: number): void {
    clearTimeout(checkpoint.timer);
    checkpoint.expiresAt = Date.now() + ttlSeconds * 1000;
    checkpoint.timer = setTimeout(() => {
      if (!this.checkpoints.has(checkpoint.id)) return;
      if (checkpoint.onExpiry === "restore") {
        this.restore(checkpoint.id);
      } else {
        this.remove(checkpoint);
      }
    }, ttlSeconds * 1000);
    checkpoint.timer.unref?.();
  }
}

function clampTtl(ttlSeconds: number | undefined): number {
  if (ttlSeconds === undefined || !Number.isFinite(ttlSeconds)) return CHECKPOINT_DEFAULT_TTL_SECONDS;
  return Math.min(CHECKPOINT_MAX_TTL_SECONDS, Math.max(1, ttlSeconds));
}

function info(checkpoint: Checkpoint): CheckpointInfo {
  return {
    id: checkpoint.id,
    ...(checkpoint.label ? { label: checkpoint.label } : {}),
    createdAt: checkpoint.createdAt,
    expiresAt: new Date(checkpoint.expiresAt).toISOString(),
    ttlSeconds: checkpoint.ttlSeconds,
    onExpiry: checkpoint.onExpiry,
    entityCount: checkpoint.settings.length,
  };
}
