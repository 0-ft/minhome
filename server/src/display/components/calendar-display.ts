import { createElement, type CSSProperties } from "react";
import { z } from "zod";
import {
  CalendarViewOptions,
  getCalendarEventsForView,
  type CalendarEvent,
} from "./calendar-events.js";
import {
  componentFailure,
  componentSuccess,
  type DisplayComponentResult,
} from "./component-result.js";

export const CalendarDisplayComponentConfigSchema = z.object({
  kind: z.literal("calendar_display"),
  source_url: z.string().url(),
  view: z.enum(CalendarViewOptions).default("week"),
  title: z.string().trim().min(1).optional(),
  max_events: z.number().int().positive().default(8),
  show_location: z.boolean().default(false),
  border_width: z.number().positive().optional(),
  padding: z.number().nonnegative().optional(),
});

export type CalendarDisplayComponentConfig = z.infer<typeof CalendarDisplayComponentConfigSchema>;

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_NUMBER_FORMATTER = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const WEEKDAY_SHORT_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: "short" });

function getDefaultTitle(view: CalendarDisplayComponentConfig["view"]): string {
  return view === "day" ? "Today" : view === "week" ? "This week" : "This month";
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

function endOfEventForDayMath(event: CalendarEvent): Date {
  // Treat all-day end dates as exclusive by default so date-only ranges render correctly.
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

function getEventBadges(
  event: CalendarEvent,
  day: Date,
): string[] {
  const badges: string[] = [];
  const multiDay = isMultiDayEvent(event);
  if (event.allDay) badges.push("ALL DAY");
  if (multiDay) badges.push("MULTI-DAY");

  const dayStart = startOfDay(day);
  const nextDay = addDays(dayStart, 1);
  if (multiDay && event.start < dayStart) badges.push("CONT");
  if (multiDay && event.end > nextDay) badges.push("->");

  return badges;
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
  day: Date,
  showLocation: boolean,
): string {
  const badges = getEventBadges(event, day);
  const timePrefix = event.allDay ? "" : `${TIME_FORMATTER.format(event.start)} `;
  const locationSuffix = showLocation && event.location ? ` (${event.location})` : "";
  const badgePrefix = badges.length > 0 ? `[${badges.join(", ")}] ` : "";
  return `${badgePrefix}${timePrefix}${event.summary}${locationSuffix}`;
}

function renderBadge(text: string): ReturnType<typeof createElement> {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #000",
    padding: "1px 4px",
    fontSize: 9,
    fontWeight: 700,
    lineHeight: 1,
    minHeight: 14,
    backgroundColor: "#fff",
  };
  return createElement("div", { key: `badge-${text}`, style }, text);
}

function renderAgenda(
  events: CalendarEvent[],
  config: CalendarDisplayComponentConfig,
  width: number,
  height: number,
): ReturnType<typeof createElement> {
  const day = new Date();
  const outerStyle: CSSProperties = {
    width,
    height,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "hidden",
  };

  const eventListStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflow: "hidden",
  };

  const eventCardStyle: CSSProperties = {
    border: "1px solid #000",
    padding: "6px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    backgroundColor: "#fff",
  };

  const metaRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
    minHeight: 14,
  };

  const timeStyle: CSSProperties = {
    fontSize: Math.max(10, Math.round(Math.min(width, height) * 0.03)),
    fontWeight: 700,
    lineHeight: 1.2,
    flex: 1,
  };

  const badgesStyle: CSSProperties = {
    display: "flex",
    gap: 3,
    flexWrap: "wrap",
  };

  const summaryStyle: CSSProperties = {
    fontSize: Math.max(12, Math.round(Math.min(width, height) * 0.035)),
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: "normal",
    wordBreak: "break-word",
  };

  const locationStyle: CSSProperties = {
    fontSize: Math.max(10, Math.round(Math.min(width, height) * 0.028)),
    fontWeight: 500,
    lineHeight: 1.2,
    whiteSpace: "normal",
    wordBreak: "break-word",
  };

  if (events.length === 0) {
    return createElement(
      "div",
      { style: outerStyle },
      createElement("div", { style: summaryStyle }, "No events for today"),
    );
  }

  const cards = events.map((event, idx) => {
    const badges = getEventBadges(event, day);
    return createElement("div", { key: `${event.start.toISOString()}-${idx}`, style: eventCardStyle }, [
      createElement("div", { key: "meta", style: metaRowStyle }, [
        createElement("div", { key: "time", style: timeStyle }, eventTimeLabelForAgenda(event, day)),
        createElement(
          "div",
          { key: "badges", style: badgesStyle },
          badges.map((badge) => renderBadge(badge)),
        ),
      ]),
      createElement("div", { key: "summary", style: summaryStyle }, event.summary),
      config.show_location && event.location
        ? createElement("div", { key: "location", style: locationStyle }, event.location)
        : null,
    ]);
  });

  return createElement("div", { style: outerStyle }, createElement("div", { style: eventListStyle }, cards));
}

function renderGrid(
  events: CalendarEvent[],
  config: CalendarDisplayComponentConfig,
  width: number,
  height: number,
): ReturnType<typeof createElement> {
  const now = new Date();
  const days = getDaySlots(config.view, now);
  const isMonth = config.view === "month";
  const rows = isMonth ? 6 : 1;
  const eventsPerCell = isMonth ? 2 : 3;

  const gridStyle: CSSProperties = {
    width,
    height,
    display: "flex",
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
    border: "1px solid #000",
    padding: 4,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: "#fff",
  };

  const cellHeaderStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: Math.max(9, Math.round(Math.min(width, height) * (isMonth ? 0.015 : 0.02))),
    fontWeight: 700,
    borderBottom: "1px solid #000",
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
    fontSize: Math.max(8, Math.round(Math.min(width, height) * (isMonth ? 0.013 : 0.018))),
    lineHeight: 1.2,
    fontWeight: 500,
    border: "1px solid #000",
    padding: "2px 3px",
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflow: "hidden",
    backgroundColor: "#fff",
  };

  return createElement(
    "div",
    { style: gridStyle },
    Array.from({ length: rows }, (_, rowIdx) => {
      const rowDays = days.slice(rowIdx * 7, rowIdx * 7 + 7);
      return createElement(
        "div",
        { key: `row-${rowIdx}`, style: rowStyle },
        rowDays.map((day, dayIdx) => {
          const dayEvents = events
            .filter((event) => overlapsDay(event, day))
            .sort((a, b) => a.start.getTime() - b.start.getTime());
          const visible = dayEvents.slice(0, eventsPerCell);
          const hiddenCount = Math.max(0, dayEvents.length - visible.length);
          const outsideCurrentMonth = isMonth && day.getMonth() !== now.getMonth();

          return createElement("div", { key: `day-${rowIdx}-${dayIdx}`, style: cellStyle }, [
            createElement("div", { key: "header", style: cellHeaderStyle }, [
              createElement(
                "div",
                { key: "weekday" },
                WEEKDAY_SHORT_FORMATTER.format(day),
              ),
              createElement(
                "div",
                { key: "day-number" },
                DAY_NUMBER_FORMATTER.format(day),
              ),
            ]),
            createElement(
              "div",
              { key: "events", style: listStyle },
              visible.length > 0
                ? [
                    ...visible.map((event, eventIdx) =>
                      createElement(
                        "div",
                        { key: `event-${eventIdx}`, style: eventStyle },
                        formatGridEventText(event, day, config.show_location),
                      )),
                    hiddenCount > 0
                      ? createElement(
                          "div",
                          {
                            key: "more",
                            style: {
                              ...eventStyle,
                              border: "0",
                              padding: "0",
                              fontWeight: 700,
                            },
                          },
                          `+${hiddenCount} more`,
                        )
                      : null,
                  ]
                : createElement(
                    "div",
                    {
                      style: {
                        ...eventStyle,
                        border: "0",
                        padding: "0",
                        opacity: outsideCurrentMonth ? 0.35 : 0.55,
                      },
                    },
                    outsideCurrentMonth ? "" : "No events",
                  ),
            ),
          ]);
        }),
      );
    }),
  );
}

export async function createCalendarDisplayElement(
  config: CalendarDisplayComponentConfig,
  width: number,
  height: number,
): Promise<DisplayComponentResult> {
  try {
    const events = await getCalendarEventsForView({
      sourceUrl: config.source_url,
      view: config.view,
      maxEvents: config.max_events,
    });

    const borderWidth = Math.max(1, Math.round(config.border_width ?? 2));
    const padding = Math.max(0, Math.round(config.padding ?? 10));
    const titleFontSize = Math.max(14, Math.round(Math.min(width, height) * 0.08));

    const wrapperStyle: CSSProperties = {
      width,
      height,
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
      border: `${borderWidth}px solid #000`,
      backgroundColor: "#fff",
      color: "#000",
      padding,
      fontFamily: "DejaVu Sans",
      gap: 6,
    };

    const titleStyle: CSSProperties = {
      fontSize: titleFontSize,
      fontWeight: 700,
      lineHeight: 1.1,
      borderBottom: "1px solid #000",
      paddingBottom: 4,
      marginBottom: 2,
    };

    const subtitleStyle: CSSProperties = {
      fontSize: Math.max(10, Math.round(Math.min(width, height) * 0.03)),
      fontWeight: 600,
      marginTop: -2,
      marginBottom: 2,
    };

    const title = config.title ?? getDefaultTitle(config.view);
    const now = new Date();
    const subtitle =
      config.view === "day"
        ? MONTH_DAY_FORMATTER.format(now)
        : config.view === "week"
          ? `${DATE_FORMATTER.format(startOfWeek(now))} - ${DATE_FORMATTER.format(addDays(startOfWeek(now), 6))}`
          : `${now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;

    const body =
      config.view === "day"
        ? renderAgenda(events, config, width - (padding * 2), height - (padding * 2) - titleFontSize - 20)
        : renderGrid(events, config, width - (padding * 2), height - (padding * 2) - titleFontSize - 20);

    return componentSuccess(
      createElement("div", { style: wrapperStyle }, [
        createElement("div", { key: "title", style: titleStyle }, title),
        createElement("div", { key: "subtitle", style: subtitleStyle }, subtitle),
        createElement(
          "div",
          { key: "body", style: { display: "flex", flex: 1, minHeight: 0 } },
          body,
        ),
      ]),
    );
  } catch (error) {
    return componentFailure(
      "calendar_display",
      "Unable to load calendar",
      error instanceof Error ? error.message : String(error),
    );
  }
}
