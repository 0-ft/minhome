import ical from "node-ical";

export type CalendarEvent = {
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  allDay: boolean;
};

export type CalendarSourceConfig = {
  source_url: string;
};

export interface CalendarSourceProvider {
  getCalendarSource(calendarId: string): CalendarSourceConfig | undefined;
  getCalendars(): Record<string, CalendarSourceConfig>;
}

function isDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function parseEvent(value: unknown): CalendarEvent | null {
  if (!value || typeof value !== "object") return null;

  const entry = value as Record<string, unknown>;
  if (entry.type !== "VEVENT") return null;
  if (!isDate(entry.start)) return null;

  const start = entry.start;
  const end = isDate(entry.end) ? entry.end : start;
  const summary = typeof entry.summary === "string" && entry.summary.trim().length > 0
    ? entry.summary.trim()
    : "Untitled event";
  const location = typeof entry.location === "string" && entry.location.trim().length > 0
    ? entry.location.trim()
    : undefined;
  const allDay = entry.datetype === "date";

  return { start, end, summary, location, allDay };
}

export class CalendarSource {
  static listCalendars(sourceProvider: CalendarSourceProvider): Record<string, CalendarSourceConfig> {
    return sourceProvider.getCalendars();
  }

  static listCalendarIds(sourceProvider: CalendarSourceProvider): string[] {
    return Object.keys(this.listCalendars(sourceProvider));
  }

  static getCalendarSourceConfig(
    sourceProvider: CalendarSourceProvider,
    calendarId: string,
  ): CalendarSourceConfig | undefined {
    return sourceProvider.getCalendarSource(calendarId);
  }

  constructor(
    private readonly calendarIds: string[],
    private readonly sourceProvider: CalendarSourceProvider,
  ) {}

  getIds(): string[] {
    return [...this.calendarIds];
  }

  getConfigs(): Record<string, CalendarSourceConfig> {
    const missingIds: string[] = [];
    const configs: Record<string, CalendarSourceConfig> = {};

    for (const calendarId of this.calendarIds) {
      const config = CalendarSource.getCalendarSourceConfig(this.sourceProvider, calendarId);
      if (!config) {
        missingIds.push(calendarId);
        continue;
      }
      configs[calendarId] = config;
    }

    if (missingIds.length > 0) {
      throw new Error(`Calendar(s) not configured: ${missingIds.join(", ")}`);
    }

    return configs;
  }

  async getEvents(): Promise<CalendarEvent[]> {
    const configs = this.getConfigs();
    const allEvents: CalendarEvent[] = [];

    for (const [calendarId, source] of Object.entries(configs)) {
      const response = await fetch(source.source_url, {
        headers: {
          Accept: "text/calendar, text/plain, */*",
        },
      });

      if (!response.ok) {
        throw new Error(`Calendar "${calendarId}" request failed (${response.status})`);
      }

      const icsText = await response.text();
      const parsed = ical.parseICS(icsText);
      const events = Object.values(parsed)
        .map(parseEvent)
        .filter((event): event is CalendarEvent => event !== null);
      allEvents.push(...events);
    }

    return allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
}
