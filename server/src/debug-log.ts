/**
 * Debug log — JSONL file-backed store that captures server events.
 * Each entry is appended as a single JSON line to `debug.jsonl`.
 * Events are also emitted in real time for WebSocket streaming.
 *
 * When the file exceeds the configured max size, the oldest half of
 * entries are dropped to bring it back under the limit.
 */

import { EventEmitter } from "events";
import { appendFileSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";

// ── Types ────────────────────────────────────────────────

export type DebugLogType =
  | "chat_request"
  | "chat_response"
  | "chat_tool_call"
  | "chat_tool_result"
  | "voice_session_start"
  | "voice_session_end"
  | "voice_speech"
  | "voice_transcript"
  | "voice_tool_call"
  | "voice_tool_result"
  | "voice_audio"
  | "voice_error"
  | "mqtt_state_change"
  | "mqtt_message"
  | "automation_fired"
  | "automation_created"
  | "automation_updated"
  | "automation_deleted"
  | "api_request"
  | "device_control"
  | "display_setup"
  | "display_poll"
  | "display_log"
  | "display_image"
  | "error";

export interface DebugLogEntry {
  id: number;
  timestamp: string;
  type: DebugLogType;
  summary: string;
  data?: unknown;
}

// ── JSONL-backed log ─────────────────────────────────────

const MAX_RETURN = 2000;
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

class DebugLog extends EventEmitter {
  private filePath: string | null = null;
  private nextId = 1;
  private maxSizeBytes = DEFAULT_MAX_SIZE_BYTES;

  /**
   * Initialise with the path to the JSONL file.
   * Must be called once at startup before any add() calls.
   * @param maxSizeMB Maximum file size in MB before old entries are pruned.
   */
  init(filePath: string, maxSizeMB?: number): void {
    this.filePath = filePath;
    if (maxSizeMB != null && maxSizeMB > 0) {
      this.maxSizeBytes = maxSizeMB * 1024 * 1024;
    }

    if (existsSync(filePath)) {
      // Recover nextId from last line
      const raw = readFileSync(filePath, "utf-8");
      const lines = raw.trimEnd().split("\n").filter(Boolean);
      if (lines.length > 0) {
        try {
          const last: DebugLogEntry = JSON.parse(lines[lines.length - 1]);
          this.nextId = last.id + 1;
        } catch {
          // Corrupted last line — just start from length + 1
          this.nextId = lines.length + 1;
        }
      }
      console.log(`[debug-log] Loaded ${lines.length} existing entries (nextId=${this.nextId}, maxSize=${this.maxSizeBytes / 1024 / 1024}MB)`);
    } else {
      writeFileSync(filePath, "");
      console.log(`[debug-log] Created ${filePath}`);
    }
  }

  /** Append a new log entry to the JSONL file. */
  add(type: DebugLogType, summary: string, data?: unknown): DebugLogEntry {
    const entry: DebugLogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      type,
      summary,
      data,
    };

    if (this.filePath) {
      try {
        appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
        this.pruneIfNeeded();
      } catch (err) {
        console.error("[debug-log] Failed to write entry:", err);
      }
    }

    this.emit("entry", entry);
    return entry;
  }

  /**
   * Read entries from the file, optionally filtered.
   * Returns at most MAX_RETURN entries in chronological order (oldest first).
   */
  getAll(filter?: { type?: DebugLogType; since?: number }): DebugLogEntry[] {
    if (!this.filePath || !existsSync(this.filePath)) return [];

    const raw = readFileSync(this.filePath, "utf-8");
    const lines = raw.trimEnd().split("\n").filter(Boolean);

    let entries: DebugLogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip corrupted lines
      }
    }

    if (filter?.type) {
      entries = entries.filter((e) => e.type === filter.type);
    }
    if (filter?.since) {
      entries = entries.filter((e) => e.id > filter.since!);
    }

    // Return only the last MAX_RETURN entries
    if (entries.length > MAX_RETURN) {
      entries = entries.slice(-MAX_RETURN);
    }

    return entries;
  }

  /** Truncate the log file and reset the counter. */
  clear(): void {
    if (this.filePath) {
      writeFileSync(this.filePath, "");
    }
    this.nextId = 1;
  }

  // ── Private ──────────────────────────────────────────

  /** If the file exceeds maxSizeBytes, drop the oldest half of entries. */
  private pruneIfNeeded(): void {
    if (!this.filePath) return;
    try {
      const stats = statSync(this.filePath);
      if (stats.size <= this.maxSizeBytes) return;

      console.log(`[debug-log] File size ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds limit ${(this.maxSizeBytes / 1024 / 1024).toFixed(0)}MB — pruning old entries`);

      const raw = readFileSync(this.filePath, "utf-8");
      const lines = raw.trimEnd().split("\n").filter(Boolean);
      // Keep the newest half
      const keep = lines.slice(Math.floor(lines.length / 2));
      writeFileSync(this.filePath, keep.join("\n") + "\n");

      console.log(`[debug-log] Pruned ${lines.length - keep.length} entries, ${keep.length} remain`);
    } catch (err) {
      console.error("[debug-log] Prune failed:", err);
    }
  }
}

// ── Singleton ────────────────────────────────────────────

export const debugLog = new DebugLog();
