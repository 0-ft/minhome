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
    <svg width="10" height="10" viewBox="0 0 10 10" tw="block">
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
    return (
      <div tw="flex flex-1 min-w-0 min-h-0 flex-col gap-1.5 overflow-visible">
        <div tw="text-[16px] font-bold leading-[1.2] break-words">No events for today</div>
      </div>
    );
  }

  return (
    <div tw="flex flex-1 min-w-0 min-h-0 flex-col gap-1.5 overflow-visible">
      <div tw="flex flex-col gap-1.5 overflow-visible">
        {events.map((event, idx) => {
          const { continuesFromPrev, continuesToNext } = getEventContinuation(event, day);
          return (
            <div key={`${event.start.toISOString()}-${idx}`} tw="flex items-stretch gap-1">
              {continuesFromPrev
                ? (
                    <div tw="flex items-center justify-center text-[12px] font-bold leading-[1] text-black w-[10px] min-w-[10px] overflow-visible">
                      <div tw="flex text-[12px] leading-[1]">{renderContinuationTriangle("left")}</div>
                    </div>
                  )
                : <div tw="w-[10px] min-w-[10px]" />}
              <div tw="border-l-2 border-black py-[5px] pl-[6px] flex flex-col gap-1 flex-1">
                <div tw="text-[14px] font-bold leading-[1.2]">{eventTimeLabelForAgenda(event, day)}</div>
                <div tw="text-[16px] font-bold leading-[1.2] break-words">{event.summary}</div>
                {config.show_location && event.location ? (
                  <div tw="text-[13px] font-medium leading-[1.2] break-words">{event.location}</div>
                ) : null}
              </div>
              {continuesToNext
                ? (
                    <div tw="flex items-center justify-end text-[12px] font-bold leading-[1] text-black w-[10px] min-w-[10px]">
                      <div tw="flex text-[12px] leading-[1] ml-[-2px]">{renderContinuationTriangle("right")}</div>
                    </div>
                  )
                : <div tw="w-[10px] min-w-[10px]" />}
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

  return (
    <div tw="flex flex-1 min-w-0 min-h-0 flex-col gap-1">
      {Array.from({ length: rows }, (_, rowIdx) => {
        const rowDays = days.slice(rowIdx * 7, rowIdx * 7 + 7);
        return (
          <div key={`row-${rowIdx}`} tw="flex flex-1 gap-1 min-h-0">
            {rowDays.map((day, dayIdx) => {
              const dayEvents = events
                .filter((event) => overlapsDay(event, day))
                .sort((a, b) => a.start.getTime() - b.start.getTime());
              const visible = dayEvents.slice(0, eventsPerCell);
              const hiddenCount = Math.max(0, dayEvents.length - visible.length);
              const outsideCurrentMonth = isMonth && day.getMonth() !== now.getMonth();

              return (
                <div key={`day-${rowIdx}-${dayIdx}`} tw="flex-1 p-1 flex flex-col gap-[3px] min-w-0 overflow-hidden bg-white">
                  <div
                    tw="flex justify-between items-center font-bold pb-[2px] min-h-[14px]"
                    style={{ fontSize: isMonth ? 10 : 12 }}
                  >
                    <div tw="flex">{WEEKDAY_SHORT_FORMATTER.format(day)}</div>
                    <div tw="flex">{DAY_NUMBER_FORMATTER.format(day)}</div>
                  </div>
                  <div tw="flex flex-col gap-[2px] min-w-0 overflow-hidden">
                    {visible.length > 0 ? (
                      <div tw="flex flex-col gap-[2px]">
                        {visible.map((event, eventIdx) => (
                          <div
                            key={`event-${eventIdx}`}
                            tw="leading-[1.2] font-medium px-[3px] py-[2px] whitespace-normal break-words overflow-hidden bg-white"
                            style={{ fontSize: isMonth ? 9 : 11 }}
                          >
                            {formatGridEventText(event, config.show_location)}
                          </div>
                        ))}
                        {hiddenCount > 0 ? (
                          <div
                            tw="leading-[1.2] font-bold p-0 whitespace-normal break-words overflow-hidden bg-white"
                            style={{ fontSize: isMonth ? 9 : 11 }}
                          >
                            {`+${hiddenCount} more`}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        tw="leading-[1.2] font-medium p-0 whitespace-normal break-words overflow-hidden bg-white"
                        style={{ fontSize: isMonth ? 9 : 11, opacity: outsideCurrentMonth ? 0.35 : 0.55 }}
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
      <div tw="font-sans flex flex-1 min-w-0 min-h-0 flex-col text-black gap-1.5">
        <div
          tw="text-[18px] font-bold leading-[1.1] pb-1 mb-[2px]"
          style={{ fontSize: titleFontSize }}
        >
          {title}
        </div>
        {subtitle ? <div tw="text-[12px] font-semibold mt-[-2px] mb-[2px]">{subtitle}</div> : null}
        <div tw="flex flex-1 min-h-0">
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
