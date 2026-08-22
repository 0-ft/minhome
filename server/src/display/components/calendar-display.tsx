import type { ReactElement } from "react";
import { z } from "zod";
import {
  CalendarService,
  type CalendarEvent,
} from "../../calendar/service.js";
import {
  componentFailure,
  componentSuccess,
  type DisplayComponentResult,
} from "./component-result.js";

const CalendarDisplayViewOptions = ["day", "week", "month"] as const;
type CalendarDisplayView = (typeof CalendarDisplayViewOptions)[number];

export const CalendarDisplayComponentConfigSchema = z.object({
  kind: z.literal("calendar_display"),
  calendar_ids: z.array(z.string().trim().min(1)).min(1),
  view: z.enum(CalendarDisplayViewOptions).default("week"),
  title: z.string().trim().min(1).optional(),
  max_events: z.number().int().positive().default(8),
  show_location: z.boolean().default(false),
});

export type CalendarDisplayComponentConfig = z.infer<typeof CalendarDisplayComponentConfigSchema>;

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_TITLE_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_NUMBER_FORMATTER = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const WEEKDAY_SHORT_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: "short" });

const EINK_BACKGROUND = "#fff";
const EINK_FOREGROUND = "#000";

function getDefaultTitle(view: CalendarDisplayComponentConfig["view"]): string {
  return view === "week" ? "This week" : "This month";
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const offsetToMonday = (day + 6) % 7;
  return addDays(startOfDay(date), -offsetToMonday);
}

function startOfMonthGrid(date: Date): Date {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  return startOfWeek(monthStart);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function getBoundsForView(view: CalendarDisplayView, now: Date): { start: Date; end: Date } {
  if (view === "day") {
    const start = startOfDay(now);
    const end = addDays(start, 1);
    return { start, end };
  }

  if (view === "week") {
    const start = startOfWeek(now);
    const end = addDays(start, 7);
    return { start, end };
  }

  const start = startOfMonth(now);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function overlapsWindow(event: CalendarEvent, start: Date, end: Date): boolean {
  return event.start < end && event.end >= start;
}

function getViewEvents(
  events: CalendarEvent[],
  view: CalendarDisplayView,
  maxEvents: number,
  now: Date,
): CalendarEvent[] {
  const { start, end } = getBoundsForView(view, now);
  return events
    .filter((event) => overlapsWindow(event, start, end))
    .slice(0, Math.max(1, maxEvents));
}

function endOfEventForDayMath(event: CalendarEvent): Date {
  if (event.allDay) {
    return new Date(event.end.getTime() - 1);
  }
  return event.end;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isMultiDayEvent(event: CalendarEvent): boolean {
  const effectiveEnd = endOfEventForDayMath(event);
  return !isSameDay(event.start, effectiveEnd);
}

function overlapsDay(event: CalendarEvent, day: Date): boolean {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return event.start < dayEnd && event.end > dayStart;
}

function getDaySlots(view: CalendarDisplayComponentConfig["view"], now: Date): Date[] {
  if (view === "week") {
    const start = startOfWeek(now);
    return Array.from({ length: 7 }, (_, idx) => addDays(start, idx));
  }
  if (view === "month") {
    const start = startOfMonthGrid(now);
    return Array.from({ length: 42 }, (_, idx) => addDays(start, idx));
  }
  return [];
}

function getEventContinuation(
  event: CalendarEvent,
  day: Date,
): { continuesFromPrev: boolean; continuesToNext: boolean } {
  const dayStart = startOfDay(day);
  const nextDay = addDays(dayStart, 1);
  return {
    continuesFromPrev: event.start < dayStart,
    continuesToNext: event.end > nextDay,
  };
}

function eventTimeLabelForAgenda(event: CalendarEvent, day: Date): string {
  if (event.allDay) return "All day";

  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const startsToday = event.start >= dayStart;
  const endsToday = event.end <= dayEnd;

  if (startsToday && endsToday) {
    return `${TIME_FORMATTER.format(event.start)} - ${TIME_FORMATTER.format(event.end)}`;
  }
  if (!startsToday && endsToday) {
    return `Until ${TIME_FORMATTER.format(event.end)}`;
  }
  if (startsToday && !endsToday) {
    return `From ${TIME_FORMATTER.format(event.start)}`;
  }
  return "In progress";
}

function formatGridEventText(
  event: CalendarEvent,
  showLocation: boolean,
): string {
  const timePrefix = event.allDay ? "" : `${TIME_FORMATTER.format(event.start)} `;
  const locationSuffix = showLocation && event.location ? ` (${event.location})` : "";
  return `${timePrefix}${event.summary}${locationSuffix}`;
}

function renderContinuationTriangle(direction: "left" | "right"): ReactElement {
  const points = direction === "left"
    ? "8.5,1 1.5,5 8.5,9"
    : "1.5,1 8.5,5 1.5,9";

  return (
    <svg width="10" height="10" viewBox="0 0 10 10" style={{ display: "block" }}>
      <polygon points={points} fill={EINK_FOREGROUND} />
    </svg>
  );
}

function renderAgenda(
  events: CalendarEvent[],
  config: CalendarDisplayComponentConfig,
): ReactElement {
  const day = new Date();

  if (events.length === 0) {
    return <span className="description">No events for today</span>;
  }

  // Each event is a framework `item`: the `meta` slot carries the continuation
  // marker, so the framework owns the rule, spacing and type scale.
  return (
    <div className="flex flex--col gap--small">
      {events.map((event, idx) => {
        const { continuesFromPrev, continuesToNext } = getEventContinuation(event, day);
        return (
          <div className="item" key={`${event.start.toISOString()}-${idx}`}>
            <div className="meta">
              {continuesFromPrev ? renderContinuationTriangle("left") : null}
            </div>
            <div className="content">
              <span className="label label--small">{eventTimeLabelForAgenda(event, day)}</span>
              <span className="title title--small">{event.summary}</span>
              {config.show_location && event.location ? (
                <span className="description">{event.location}</span>
              ) : null}
              {continuesToNext ? (
                <span className="label label--small">{renderContinuationTriangle("right")}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderGrid(
  events: CalendarEvent[],
  config: CalendarDisplayComponentConfig,
): ReactElement {
  const now = new Date();
  const days = getDaySlots(config.view, now);
  const isMonth = config.view === "month";
  const rows = isMonth ? 6 : 1;
  const eventsPerCell = isMonth ? 2 : 3;

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", gap: 4 }}>
      {Array.from({ length: rows }, (_, rowIdx) => {
        const rowDays = days.slice(rowIdx * 7, rowIdx * 7 + 7);
        return (
          <div key={`row-${rowIdx}`} style={{ display: "flex", flex: 1, gap: 4, minHeight: 0 }}>
            {rowDays.map((day, dayIdx) => {
              const dayEvents = events
                .filter((event) => overlapsDay(event, day))
                .sort((a, b) => a.start.getTime() - b.start.getTime());
              const visible = dayEvents.slice(0, eventsPerCell);
              const hiddenCount = Math.max(0, dayEvents.length - visible.length);
              const outsideCurrentMonth = isMonth && day.getMonth() !== now.getMonth();

              return (
                <div key={`day-${rowIdx}-${dayIdx}`} style={{ flex: 1, padding: 4, display: "flex", flexDirection: "column", gap: 3, minWidth: 0, overflow: "hidden" }}>
                  <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, paddingBottom: 2, minHeight: 14, fontSize: isMonth ? 10 : 12 }}
                  >
                    <div>{WEEKDAY_SHORT_FORMATTER.format(day)}</div>
                    <div>{DAY_NUMBER_FORMATTER.format(day)}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, overflow: "hidden" }}>
                    {visible.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {visible.map((event, eventIdx) => (
                          <div
                            key={`event-${eventIdx}`}
                            style={{ lineHeight: 1.2, padding: "2px 3px", overflowWrap: "anywhere", overflow: "hidden", fontSize: isMonth ? 9 : 11 }}
                          >
                            {formatGridEventText(event, config.show_location)}
                          </div>
                        ))}
                        {hiddenCount > 0 ? (
                          <div
                            style={{ lineHeight: 1.2, fontWeight: 700, overflowWrap: "anywhere", overflow: "hidden", fontSize: isMonth ? 9 : 11 }}
                          >
                            {`+${hiddenCount} more`}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        style={{ lineHeight: 1.2, overflowWrap: "anywhere", overflow: "hidden", fontSize: isMonth ? 9 : 11, opacity: outsideCurrentMonth ? 0.35 : 0.55 }}
                      >
                        {outsideCurrentMonth ? "" : "No events"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export async function createCalendarDisplayElement(
  config: CalendarDisplayComponentConfig,
  calendarService: CalendarService,
): Promise<DisplayComponentResult> {
  try {
    const now = new Date();
    const sourceEvents = await calendarService.getEvents(config.calendar_ids);
    const events = getViewEvents(sourceEvents, config.view, config.max_events, now);

    const titleFontSize = 18;

    const title =
      config.view === "day"
        ? DAY_TITLE_FORMATTER.format(now)
        : config.title ?? getDefaultTitle(config.view);
    const subtitle =
      config.view === "day"
        ? null
        : config.view === "week"
          ? `${DATE_FORMATTER.format(startOfWeek(now))} - ${DATE_FORMATTER.format(addDays(startOfWeek(now), 6))}`
          : `${now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;

    const body =
      config.view === "day"
        ? renderAgenda(events, config)
        : renderGrid(events, config);

    return componentSuccess(
      <div className="flex flex--col gap--small">
        <span className="title title--small">{title}</span>
        {subtitle ? <span className="label label--small">{subtitle}</span> : null}
        {body}
      </div>,
    );
  } catch (error) {
    return componentFailure(
      "calendar_display",
      "Unable to load calendar",
      error instanceof Error ? error.message : String(error),
    );
  }
}
