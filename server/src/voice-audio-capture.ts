import { appendFile, mkdir, open, rename, writeFile } from "fs/promises";
import { join } from "path";

export interface VoiceAudioCaptureInfo {
  path: string;
  pcmBytes: number;
  sampleRate: number;
  durationSeconds: number;
}

interface VoiceAudioCaptureOptions {
  captureDir: string;
  sessionId: string;
  deviceId?: string;
  sampleRate?: number;
}

const PCM_16_BIT = 16;
const CHANNELS_MONO = 1;

export class VoiceAudioCapture {
  private totalPcmBytes = 0;
  private finalizedInfo: VoiceAudioCaptureInfo | null = null;
  private finalized = false;
  private started = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly sampleRate: number;
  private readonly captureDir: string;
  private readonly sessionId: string;
  private readonly deviceId?: string;
  private readonly partialPath: string;
  private readonly finalPath: string;

  constructor(options: VoiceAudioCaptureOptions) {
    this.sampleRate = options.sampleRate ?? 24_000;
    this.captureDir = options.captureDir;
    this.sessionId = options.sessionId;
    this.deviceId = options.deviceId;
    const filename = this.buildFilename();
    this.finalPath = join(this.captureDir, filename);
    this.partialPath = `${this.finalPath}.partial.wav`;
  }

  appendPcmChunk(chunk: Buffer): void {
    if (this.finalized || chunk.length === 0) return;
    const data = Buffer.from(chunk);
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureStarted();
      await appendFile(this.partialPath, data);
      this.totalPcmBytes += data.length;
      await this.updateHeader();
    });
  }

  async finalize(): Promise<VoiceAudioCaptureInfo | null> {
    if (this.finalized) return this.finalizedInfo;
    this.finalized = true;
    await this.writeQueue;
    if (this.totalPcmBytes === 0) {
      this.finalizedInfo = null;
      return null;
    }
    await this.updateHeader();
    await rename(this.partialPath, this.finalPath);

    const info: VoiceAudioCaptureInfo = {
      path: this.finalPath,
      pcmBytes: this.totalPcmBytes,
      sampleRate: this.sampleRate,
      durationSeconds: this.totalPcmBytes / bytesPerSecond(this.sampleRate, CHANNELS_MONO, PCM_16_BIT),
    };
    this.finalizedInfo = info;
    return info;
  }

  getPartialPath(): string {
    return this.partialPath;
  }

  private buildFilename(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const session = sanitizeForFilename(this.sessionId);
    const device = this.deviceId ? sanitizeForFilename(this.deviceId) : "unknown-device";
    return `${timestamp}_${device}_${session}.wav`;
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await mkdir(this.captureDir, { recursive: true });
    await writeFile(this.partialPath, createWavHeader({
      pcmBytes: 0,
      sampleRate: this.sampleRate,
      channels: CHANNELS_MONO,
      bitsPerSample: PCM_16_BIT,
    }));
  }

  private async updateHeader(): Promise<void> {
    const fd = await open(this.partialPath, "r+");
    try {
      const header = createWavHeader({
        pcmBytes: this.totalPcmBytes,
        sampleRate: this.sampleRate,
        channels: CHANNELS_MONO,
        bitsPerSample: PCM_16_BIT,
      });
      await fd.write(header, 0, header.length, 0);
    } finally {
      await fd.close();
    }
  }
}

function bytesPerSecond(sampleRate: number, channels: number, bitsPerSample: number): number {
  return sampleRate * channels * (bitsPerSample / 8);
}

function createWavHeader(args: {
  pcmBytes: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}): Buffer {
  const byteRate = bytesPerSecond(args.sampleRate, args.channels, args.bitsPerSample);
  const blockAlign = args.channels * (args.bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + args.pcmBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM header chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(args.channels, 22);
  header.writeUInt32LE(args.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(args.bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(args.pcmBytes, 40);

  return header;
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

