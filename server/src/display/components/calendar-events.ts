import ical from "node-ical";

export const CalendarViewOptions = ["day", "week", "month"] as const;
export type CalendarView = (typeof CalendarViewOptions)[number];

export type CalendarEvent = {
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  allDay: boolean;
};

type CalendarQuery = {
  sourceUrl: string;
  view: CalendarView;
  maxEvents: number;
  now?: Date;
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const offsetToMonday = (day + 6) % 7;
  const start = startOfDay(date);
  start.setDate(start.getDate() - offsetToMonday);
  return start;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function getBounds(view: CalendarView, now: Date): { start: Date; end: Date } {
  if (view === "day") {
    const start = startOfDay(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  if (view === "week") {
    const start = startOfWeek(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  const start = startOfMonth(now);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
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

function overlapsWindow(event: CalendarEvent, start: Date, end: Date): boolean {
  return event.start < end && event.end >= start;
}

export async function getCalendarEventsForView({
  sourceUrl,
  view,
  maxEvents,
  now = new Date(),
}: CalendarQuery): Promise<CalendarEvent[]> {
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "text/calendar, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`Calendar request failed (${response.status})`);
  }

  const icsText = await response.text();
  const parsed = ical.parseICS(icsText);

  const { start, end } = getBounds(view, now);
  const events = Object.values(parsed)
    .map(parseEvent)
    .filter((event): event is CalendarEvent => event !== null)
    .filter((event) => overlapsWindow(event, start, end))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return events.slice(0, Math.max(1, maxEvents));
}
