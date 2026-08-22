import type { ReactElement } from "react";
import type { CalendarService } from "../calendar/service.js";
import type { DisplayComponentConfig } from "./layout.js";
import { createCalendarDisplayElement } from "./components/calendar-display.js";
import { type DisplayComponentResult, componentFailure } from "./components/component-result.js";
import { createErrorDisplayElement } from "./components/error-display.js";
import { createPolymarketGraphDisplayElement } from "./components/polymarket-graph-display.js";
import { createStringDisplayElement } from "./components/string-display.js";
import { createListDisplayElement, type ListProvider } from "./components/list-display.js";

function renderResultToElement(result: DisplayComponentResult): ReactElement {
  if (result.ok) {
    return result.element;
  }

  console.warn(
    `[display/render] Component error (${result.error.component}): ${result.error.message}` +
    `${result.error.detail ? ` (${result.error.detail})` : ""}`,
  );
  return createErrorDisplayElement(result.error);
}

/** Build the element for one configured component, substituting an error card on failure. */
export async function createComponentElement(
  component: DisplayComponentConfig,
  calendarService: CalendarService,
  listProvider: ListProvider,
): Promise<ReactElement> {
  switch (component.kind) {
    case "string_display":
      return renderResultToElement(createStringDisplayElement(component));
    case "calendar_display": {
      let result: DisplayComponentResult;
      try {
        result = await createCalendarDisplayElement(component, calendarService);
      } catch (error) {
        result = componentFailure(
          component.kind,
          "Unhandled calendar render failure",
          error instanceof Error ? error.message : String(error),
        );
      }
      return renderResultToElement(result);
    }
    case "polymarket_graph_display": {
      let result: DisplayComponentResult;
      try {
        result = await createPolymarketGraphDisplayElement(component);
      } catch (error) {
        result = componentFailure(
          component.kind,
          "Unhandled polymarket graph render failure",
          error instanceof Error ? error.message : String(error),
        );
      }
      return renderResultToElement(result);
    }
    case "list_display":
      return renderResultToElement(createListDisplayElement(component, listProvider));
    default: {
      const _exhaustive: never = component;
      throw new Error(`Unsupported display component: ${String(_exhaustive)}`);
    }
  }
}
