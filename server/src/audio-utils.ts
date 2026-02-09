/**
 * Shared audio utilities for WAV header generation, PCM resampling,
 * and fan-out streaming (one source → many readers).
 */

const OUTPUT_SAMPLE_RATE = 48000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

/**
 * Create a WAV header for streaming audio.
 * Uses 0x7FFFFFFF for file/data size to support indefinite streaming.
 */
export function createStreamingWavHeader(): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const enc = new TextEncoder();

  // RIFF header
  const riff = enc.encode("RIFF");
  new Uint8Array(header, 0, 4).set(riff);
  view.setUint32(4, 0x7fffffff, true); // large file size for streaming
  const wave = enc.encode("WAVE");
  new Uint8Array(header, 8, 4).set(wave);

  // fmt sub-chunk
  const fmt = enc.encode("fmt ");
  new Uint8Array(header, 12, 4).set(fmt);
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, OUTPUT_SAMPLE_RATE, true);
  view.setUint32(28, OUTPUT_SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // data sub-chunk
  const data = enc.encode("data");
  new Uint8Array(header, 36, 4).set(data);
  view.setUint32(40, 0x7fffffff, true); // large data size for streaming

  return new Uint8Array(header);
}

/**
 * Resample 24kHz 16-bit PCM to 48kHz using 2× linear interpolation.
 * Exact integer ratio (2:1) so no library needed.
 */
export function resample24to48(pcm24: Buffer): Uint8Array {
  // Only process complete 16-bit samples (drop any trailing odd byte)
  const sampleCount = Math.floor(pcm24.length / 2);
  if (sampleCount === 0) return new Uint8Array(0);

  const output = new ArrayBuffer(sampleCount * 4); // 2× samples, 2 bytes each
  const out = new DataView(output);

  for (let i = 0; i < sampleCount; i++) {
    const sample = pcm24.readInt16LE(i * 2);
    const nextSample = i + 1 < sampleCount ? pcm24.readInt16LE((i + 1) * 2) : sample;
    out.setInt16(i * 4, sample, true);
    out.setInt16(i * 4 + 2, Math.round((sample + nextSample) / 2), true);
  }

  return new Uint8Array(output);
}

// ---------------------------------------------------------------------------
// SharedAudioSource — fan-out a single ReadableStream to many consumers
// ---------------------------------------------------------------------------

/**
 * Consumes a source ReadableStream once and allows multiple downstream
 * readers to each get their own ReadableStream that replays already-received
 * chunks then follows the live tail.
 *
 * Usage:
 *   const src = new SharedAudioSource(ttsStream);
 *   // Each HTTP request calls src.createReader() to get a fresh stream.
 */
export class SharedAudioSource {
  private chunks: Uint8Array[] = [];
  private done = false;
  private waiters: Array<() => void> = [];
  private ttl: ReturnType<typeof setTimeout> | undefined;

  constructor(source: ReadableStream<Uint8Array>, ttlMs = 60_000) {
    this._consume(source);
    // Auto-cleanup after ttlMs so we don't leak memory
    this.ttl = setTimeout(() => this.dispose(), ttlMs);
  }

  private async _consume(source: ReadableStream<Uint8Array>) {
    const reader = source.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.chunks.push(value);
        this._wake();
      }
    } catch (err) {
      console.error("[SharedAudioSource] consume error:", err);
    } finally {
      this.done = true;
      this._wake();
    }
  }

  private _wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }

  /** Create a new ReadableStream that replays buffered chunks then follows live. */
  createReader(): ReadableStream<Uint8Array> {
    let pos = 0;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        // Wait until there's a chunk available or the source is done
        while (pos >= this.chunks.length && !this.done) {
          await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        if (pos < this.chunks.length) {
          controller.enqueue(this.chunks[pos++]);
        } else {
          controller.close();
        }
      },
    });
  }

  dispose() {
    if (this.ttl) clearTimeout(this.ttl);
    this.chunks = [];
    this.done = true;
    this._wake();
  }
}
