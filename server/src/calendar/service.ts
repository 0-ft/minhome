import type { CalendarsConfig } from "../config/config.js";
import { GoogleCalendarProvider } from "./google-provider.js";
import { ICalProvider } from "./ical-provider.js";

export type CalendarEvent = {
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  allDay: boolean;
};

export type NewCalendarEvent = {
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  allDay?: boolean;
};

export interface CalendarProvider {
  getEvents(): Promise<CalendarEvent[]>;
  addEvent?(event: NewCalendarEvent): Promise<CalendarEvent>;
}

export type CalendarServiceOptions = {
  credentialsBaseDir?: string;
};

export class CalendarService {
  constructor(
    private readonly calendars: CalendarsConfig,
    private readonly options: CalendarServiceOptions = {},
  ) {}

  getIds(): string[] {
    return Object.keys(this.calendars);
  }

  getConfigs(): CalendarsConfig {
    return { ...this.calendars };
  }

  private getConfig(calendarId: string): CalendarsConfig[string] {
    const config = this.calendars[calendarId];
    if (!config) {
      throw new Error(`Calendar "${calendarId}" not configured`);
    }
    return config;
  }

  private createProvider(calendarId: string): CalendarProvider {
    const config = this.getConfig(calendarId);
    switch (config.type) {
      case "ical":
        return new ICalProvider(calendarId, config);
      case "google":
        return new GoogleCalendarProvider(calendarId, config, {
          credentialsBaseDir: this.options.credentialsBaseDir,
        });
      default: {
        const neverConfig: never = config;
        throw new Error(`Unsupported calendar source type: ${String(neverConfig)}`);
      }
    }
  }

  async getEvents(calendarIds: string[]): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    for (const calendarId of calendarIds) {
      const provider = this.createProvider(calendarId);
      const events = await provider.getEvents();
      allEvents.push(...events);
    }
    return allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  canWrite(calendarId: string): boolean {
    const provider = this.createProvider(calendarId);
    return typeof provider.addEvent === "function";
  }

  async addEvent(calendarId: string, event: NewCalendarEvent): Promise<CalendarEvent> {
    const provider = this.createProvider(calendarId);
    if (typeof provider.addEvent !== "function") {
      throw new Error(`Calendar "${calendarId}" is read-only`);
    }
    return provider.addEvent(event);
  }
}
