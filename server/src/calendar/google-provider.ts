import { isAbsolute, resolve } from "path";
import { google } from "googleapis";
import type { GoogleCalendarSourceConfig } from "../config/config.js";
import type { CalendarEvent, CalendarProvider, NewCalendarEvent } from "./service.js";

type GoogleCalendarProviderOptions = {
  credentialsBaseDir?: string;
};

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isFiniteDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function toCalendarEvent(event: {
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  summary?: string | null;
  location?: string | null;
  description?: string | null;
}): CalendarEvent | null {
  const startValue = event.start?.dateTime ?? event.start?.date;
  if (!startValue) return null;
  const start = new Date(startValue);
  if (!isFiniteDate(start)) return null;

  const endValue = event.end?.dateTime ?? event.end?.date;
  const parsedEnd = endValue ? new Date(endValue) : null;
  const end = parsedEnd && isFiniteDate(parsedEnd) ? parsedEnd : start;
  const summary = typeof event.summary === "string" && event.summary.trim().length > 0
    ? event.summary.trim()
    : "Untitled event";
  const location = typeof event.location === "string" && event.location.trim().length > 0
    ? event.location.trim()
    : undefined;
  const description = typeof event.description === "string" && event.description.trim().length > 0
    ? event.description.trim()
    : undefined;
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);

  return { start, end, summary, location, description, allDay };
}

export class GoogleCalendarProvider implements CalendarProvider {
  private readonly calendarApi;

  constructor(
    private readonly calendarId: string,
    private readonly config: GoogleCalendarSourceConfig,
    private readonly options: GoogleCalendarProviderOptions = {},
  ) {
    const credentialsPath = isAbsolute(config.credentials_file)
      ? config.credentials_file
      : resolve(this.options.credentialsBaseDir ?? process.cwd(), config.credentials_file);
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    this.calendarApi = google.calendar({ version: "v3", auth });
  }

  async getEvents(): Promise<CalendarEvent[]> {
    const items: CalendarEvent[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.calendarApi.events.list({
        calendarId: this.config.calendar_id,
        singleEvents: true,
        maxResults: 2500,
        pageToken,
      });
      const pageItems = response.data.items ?? [];
      for (const item of pageItems) {
        const parsed = toCalendarEvent(item);
        if (parsed) {
          items.push(parsed);
        }
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return items;
  }

  async addEvent(event: NewCalendarEvent): Promise<CalendarEvent> {
    const eventIsAllDay = Boolean(event.allDay);
    const requestBody = eventIsAllDay
      ? {
        summary: event.summary,
        location: event.location,
        description: event.description,
        start: { date: formatDateOnly(event.start) },
        end: { date: formatDateOnly(event.end) },
      }
      : {
        summary: event.summary,
        location: event.location,
        description: event.description,
        start: { dateTime: event.start.toISOString() },
        end: { dateTime: event.end.toISOString() },
      };

    const response = await this.calendarApi.events.insert({
      calendarId: this.config.calendar_id,
      requestBody,
    });
    const inserted = toCalendarEvent(response.data);
    if (!inserted) {
      throw new Error(`Calendar "${this.calendarId}" returned invalid event payload`);
    }
    return inserted;
  }
}
