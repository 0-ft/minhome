import ical from "node-ical";
import type { ICalCalendarSourceConfig } from "../config/config.js";
import type { CalendarEvent, CalendarProvider } from "./service.js";

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
  const description = typeof entry.description === "string" && entry.description.trim().length > 0
    ? entry.description.trim()
    : undefined;
  const allDay = entry.datetype === "date";

  return { start, end, summary, location, description, allDay };
}

export class ICalProvider implements CalendarProvider {
  constructor(
    private readonly calendarId: string,
    private readonly config: ICalCalendarSourceConfig,
  ) {}

  async getEvents(): Promise<CalendarEvent[]> {
    const response = await fetch(this.config.source_url, {
      headers: {
        Accept: "text/calendar, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`Calendar "${this.calendarId}" request failed (${response.status})`);
    }

    const icsText = await response.text();
    const parsed = ical.parseICS(icsText);
    return Object.values(parsed)
      .map(parseEvent)
      .filter((event): event is CalendarEvent => event !== null);
  }
}
