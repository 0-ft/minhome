import type { CSSProperties, ReactElement } from "react";
import { z } from "zod";
import {
  CalendarSource,
  type CalendarEvent,
  type CalendarSourceProvider,
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

  const outerStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "column",
    gap: 6,
    overflow: "visible",
  };

  const eventListStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "visible",
  };

  const eventRowShellStyle: CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    gap: 4,
  };

  const eventRowStyle: CSSProperties = {
    borderLeft: "2px solid #000",
    padding: "5px 0 5px 6px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: 1,
  };

  const eventArrowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1,
    color: EINK_FOREGROUND,
  };

  const eventArrowLeftStyle: CSSProperties = {
    ...eventArrowStyle,
    width: 6,
    minWidth: 6,
    justifyContent: "flex-start",
    overflow: "visible",
  };

  const eventArrowRightStyle: CSSProperties = {
    ...eventArrowStyle,
    width: 10,
    minWidth: 10,
    justifyContent: "flex-end",
  };

  const eventArrowLeftSpacerStyle: CSSProperties = {
    width: 6,
    minWidth: 6,
  };

  const eventArrowRightSpacerStyle: CSSProperties = {
    width: 10,
    minWidth: 10,
  };

  const eventArrowGlyphWrapStyle: CSSProperties = {
    display: "flex",
    fontSize: 12,
    lineHeight: 1,
  };

  const eventArrowGlyphLeftStyle: CSSProperties = {
    ...eventArrowGlyphWrapStyle,
    transform: "translateX(-4px)",
  };

  const eventArrowGlyphRightStyle: CSSProperties = {
    ...eventArrowGlyphWrapStyle,
    marginLeft: -2,
  };

  const timeStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.2,
  };

  const summaryStyle: CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: "normal",
    wordBreak: "break-word",
  };

  const locationStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.2,
    whiteSpace: "normal",
    wordBreak: "break-word",
  };

  if (events.length === 0) {
    return (
      <div style={outerStyle}>
        <div style={summaryStyle}>No events for today</div>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <div style={eventListStyle}>
        {events.map((event, idx) => {
          const { continuesFromPrev, continuesToNext } = getEventContinuation(event, day);
          return (
            <div key={`${event.start.toISOString()}-${idx}`} style={eventRowShellStyle}>
              {continuesFromPrev
                ? (
                    <div style={eventArrowLeftStyle}>
                      <div style={eventArrowGlyphLeftStyle}>{renderContinuationTriangle("left")}</div>
                    </div>
                  )
                : <div style={eventArrowLeftSpacerStyle} />}
              <div style={eventRowStyle}>
                <div style={timeStyle}>{eventTimeLabelForAgenda(event, day)}</div>
                <div style={summaryStyle}>{event.summary}</div>
                {config.show_location && event.location ? (
                  <div style={locationStyle}>{event.location}</div>
                ) : null}
              </div>
              {continuesToNext
                ? (
                    <div style={eventArrowRightStyle}>
                      <div style={eventArrowGlyphRightStyle}>{renderContinuationTriangle("right")}</div>
                    </div>
                  )
                : <div style={eventArrowRightSpacerStyle} />}
            </div>
          );
        })}
      </div>
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

  const gridStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "column",
    gap: 4,
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    gap: 4,
    minHeight: 0,
  };

  const cellStyle: CSSProperties = {
    flex: 1,
    padding: 4,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: EINK_BACKGROUND,
  };

  const cellHeaderStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: isMonth ? 10 : 12,
    fontWeight: 700,
    paddingBottom: 2,
    minHeight: 14,
  };

  const listStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
    overflow: "hidden",
  };

  const eventStyle: CSSProperties = {
    fontSize: isMonth ? 9 : 11,
    lineHeight: 1.2,
    fontWeight: 500,
    padding: "2px 3px",
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflow: "hidden",
    backgroundColor: EINK_BACKGROUND,
  };

  const rowItemsStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  };

  const dayLabelStyle: CSSProperties = {
    display: "flex",
  };

  return (
    <div style={gridStyle}>
      {Array.from({ length: rows }, (_, rowIdx) => {
        const rowDays = days.slice(rowIdx * 7, rowIdx * 7 + 7);
        return (
          <div key={`row-${rowIdx}`} style={rowStyle}>
            {rowDays.map((day, dayIdx) => {
              const dayEvents = events
                .filter((event) => overlapsDay(event, day))
                .sort((a, b) => a.start.getTime() - b.start.getTime());
              const visible = dayEvents.slice(0, eventsPerCell);
              const hiddenCount = Math.max(0, dayEvents.length - visible.length);
              const outsideCurrentMonth = isMonth && day.getMonth() !== now.getMonth();

              return (
                <div key={`day-${rowIdx}-${dayIdx}`} style={cellStyle}>
                  <div style={cellHeaderStyle}>
                    <div style={dayLabelStyle}>{WEEKDAY_SHORT_FORMATTER.format(day)}</div>
                    <div style={dayLabelStyle}>{DAY_NUMBER_FORMATTER.format(day)}</div>
                  </div>
                  <div style={listStyle}>
                    {visible.length > 0 ? (
                      <div style={rowItemsStyle}>
                        {visible.map((event, eventIdx) => (
                          <div key={`event-${eventIdx}`} style={eventStyle}>
                            {formatGridEventText(event, config.show_location)}
                          </div>
                        ))}
                        {hiddenCount > 0 ? (
                          <div
                            style={{
                              ...eventStyle,
                              border: "0",
                              padding: "0",
                              fontWeight: 700,
                            }}
                          >
                            {`+${hiddenCount} more`}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        style={{
                          ...eventStyle,
                          border: "0",
                          padding: "0",
                          opacity: outsideCurrentMonth ? 0.35 : 0.55,
                        }}
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
  calendarSourceProvider: CalendarSourceProvider,
): Promise<DisplayComponentResult> {
  try {
    const calendarSource = new CalendarSource(config.calendar_ids, calendarSourceProvider);
    const now = new Date();
    const sourceEvents = await calendarSource.getEvents();
    const events = getViewEvents(sourceEvents, config.view, config.max_events, now);

    const titleFontSize = 18;

    const wrapperStyle: CSSProperties = {
      display: "flex",
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      flexDirection: "column",
      color: EINK_FOREGROUND,
      fontFamily: "DejaVu Sans",
      gap: 6,
    };

    const titleStyle: CSSProperties = {
      fontSize: titleFontSize,
      fontWeight: 700,
      lineHeight: 1.1,
      paddingBottom: 4,
      marginBottom: 2,
    };

    const subtitleStyle: CSSProperties = {
      fontSize: 12,
      fontWeight: 600,
      marginTop: -2,
      marginBottom: 2,
    };

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
      <div style={wrapperStyle}>
        <div style={titleStyle}>{title}</div>
        {subtitle ? <div style={subtitleStyle}>{subtitle}</div> : null}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {body}
        </div>
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
