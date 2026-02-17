import { existsSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { UIMessage } from "ai";

export const ChatSourceSchema = z.enum(["text", "voice"]);
export type ChatSource = z.infer<typeof ChatSourceSchema>;

const UIMessageSchema = z.custom<UIMessage>((value) => {
  return Boolean(value) && typeof value === "object";
}, "Invalid UIMessage");

const ChatMessagesSchema = z.array(UIMessageSchema);

export const PersistedChatSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  source: ChatSourceSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastDeviceId: z.string().trim().min(1).optional(),
  messages: ChatMessagesSchema.default([]),
});
export type PersistedChat = z.infer<typeof PersistedChatSchema>;

const ChatsFileSchema = z.object({
  chats: z.array(PersistedChatSchema).default([]),
});
type ChatsFile = z.infer<typeof ChatsFileSchema>;

export interface ChatListItem {
  id: string;
  title?: string;
  source: ChatSource;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastDeviceId?: string;
}

export class ChatStore {
  private data: ChatsFile;
  private changeListeners = new Set<() => void>();

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      this.data = this.parseAndNormalize(JSON.parse(raw));
    } else {
      this.data = { chats: [] };
      this.save();
    }
  }

  onChanged(fn: () => void): void { this.changeListeners.add(fn); }
  offChanged(fn: () => void): void { this.changeListeners.delete(fn); }

  list(): ChatListItem[] {
    this.reload();
    return this.data.chats
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        source: chat.source,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        messageCount: chat.messages.length,
        lastDeviceId: chat.lastDeviceId,
      }));
  }

  get(id: string): PersistedChat | undefined {
    this.reload();
    return this.data.chats.find((chat) => chat.id === id);
  }

  create(args: {
    id?: string;
    title?: string;
    source: ChatSource;
    lastDeviceId?: string;
    messages?: UIMessage[];
  }): PersistedChat {
    this.reload();
    const id = args.id?.trim() || randomUUID();
    if (this.data.chats.some((chat) => chat.id === id)) {
      throw new Error(`Chat already exists: ${id}`);
    }
    const now = new Date().toISOString();
    const chat = PersistedChatSchema.parse({
      id,
      title: args.title,
      source: args.source,
      createdAt: now,
      updatedAt: now,
      lastDeviceId: args.lastDeviceId,
      messages: args.messages ?? [],
    });
    this.data.chats.push(chat);
    this.save();
    return chat;
  }

  ensure(args: {
    id: string;
    source: ChatSource;
    title?: string;
    lastDeviceId?: string;
    messages?: UIMessage[];
  }): PersistedChat {
    this.reload();
    const existing = this.data.chats.find((chat) => chat.id === args.id);
    if (existing) {
      return existing;
    }
    return this.create(args);
  }

  upsertHistory(args: {
    id: string;
    source: ChatSource;
    messages: UIMessage[];
    title?: string;
    lastDeviceId?: string;
  }): PersistedChat {
    this.reload();
    const existing = this.data.chats.find((chat) => chat.id === args.id);
    if (!existing) {
      return this.create(args);
    }
    existing.messages = ChatMessagesSchema.parse(args.messages);
    existing.updatedAt = new Date().toISOString();
    if (!existing.title && args.title) {
      existing.title = args.title;
    }
    if (args.lastDeviceId) {
      existing.lastDeviceId = args.lastDeviceId;
    }
    this.save();
    return existing;
  }

  appendMessage(args: {
    id: string;
    source: ChatSource;
    message: UIMessage;
    title?: string;
    lastDeviceId?: string;
  }): PersistedChat {
    this.reload();
    const existing = this.data.chats.find((chat) => chat.id === args.id);
    if (!existing) {
      return this.create({
        id: args.id,
        source: args.source,
        title: args.title,
        lastDeviceId: args.lastDeviceId,
        messages: [args.message],
      });
    }
    existing.messages.push(UIMessageSchema.parse(args.message));
    existing.updatedAt = new Date().toISOString();
    if (!existing.title && args.title) {
      existing.title = args.title;
    }
    if (args.lastDeviceId) {
      existing.lastDeviceId = args.lastDeviceId;
    }
    this.save();
    return existing;
  }

  touch(id: string, lastDeviceId?: string): PersistedChat {
    this.reload();
    const chat = this.data.chats.find((entry) => entry.id === id);
    if (!chat) throw new Error(`Chat not found: ${id}`);
    chat.updatedAt = new Date().toISOString();
    if (lastDeviceId) {
      chat.lastDeviceId = lastDeviceId;
    }
    this.save();
    return chat;
  }

  setTitle(id: string, title?: string): PersistedChat {
    this.reload();
    const chat = this.data.chats.find((entry) => entry.id === id);
    if (!chat) throw new Error(`Chat not found: ${id}`);
    chat.title = title?.trim() || undefined;
    chat.updatedAt = new Date().toISOString();
    this.save();
    return chat;
  }

  delete(id: string): boolean {
    this.reload();
    const idx = this.data.chats.findIndex((chat) => chat.id === id);
    if (idx < 0) return false;
    this.data.chats.splice(idx, 1);
    this.save();
    return true;
  }

  private reload(): void {
    if (!existsSync(this.filePath)) return;
    const raw = readFileSync(this.filePath, "utf-8");
    this.data = this.parseAndNormalize(JSON.parse(raw));
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + "\n");
    this.changeListeners.forEach((fn) => fn());
  }

  private parseAndNormalize(raw: unknown): ChatsFile {
    if (!raw || typeof raw !== "object") {
      return { chats: [] };
    }
    const root = raw as { chats?: unknown };
    const chats = Array.isArray(root.chats) ? root.chats : [];
    return ChatsFileSchema.parse({ chats });
  }
}

