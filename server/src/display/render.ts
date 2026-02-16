import { existsSync, readFileSync } from "fs";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { ReactElement } from "react";
import type { CalendarSourceProvider } from "../calendar/service.js";
import type { TileComponentConfig } from "./tiles.js";
import { createCalendarDisplayElement } from "./components/calendar-display.js";
import { createColorTestElement } from "./components/color-test.js";
import { type DisplayComponentResult, componentFailure } from "./components/component-result.js";
import { createErrorDisplayElement } from "./components/error-display.js";
import { createStringDisplayElement } from "./components/string-display.js";

const FONT_NAME = "DejaVu Sans";
const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
];

let cachedFontData: Buffer | null = null;

function getFontData(): Buffer {
  if (cachedFontData) return cachedFontData;

  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate)) {
      cachedFontData = readFileSync(candidate);
      return cachedFontData;
    }
  }

  throw new Error(`Unable to find a display font. Tried: ${FONT_CANDIDATES.join(", ")}`);
}

async function renderElementToPngBuffer(
  element: ReactElement,
  width: number,
  height: number,
): Promise<Buffer> {
  const svg = await satori(element, {
    width,
    height,
    fonts: [
      {
        name: FONT_NAME,
        data: getFontData(),
        weight: 400,
        style: "normal",
      },
    ],
  });

  const resvg = new Resvg(svg);
  const pngData = resvg.render().asPng();
  return Buffer.from(pngData);
}

async function renderResultToPngBuffer(
  result: DisplayComponentResult,
  width: number,
  height: number,
): Promise<Buffer> {
  if (result.ok) {
    return renderElementToPngBuffer(result.element, width, height);
  }

  console.warn(
    `[display/render] Component error (${result.error.component}): ${result.error.message}` +
    `${result.error.detail ? ` (${result.error.detail})` : ""}`,
  );
  return renderElementToPngBuffer(
    createErrorDisplayElement(result.error, width, height),
    width,
    height,
  );
}

export async function renderComponentToPngBuffer(
  component: TileComponentConfig,
  calendarSourceProvider: CalendarSourceProvider,
  width: number,
  height: number,
): Promise<Buffer> {
  switch (component.kind) {
    case "string_display":
      return renderResultToPngBuffer(
        createStringDisplayElement(component, width, height),
        width,
        height,
      );
    case "color_test":
      return renderResultToPngBuffer(
        createColorTestElement(component, width, height),
        width,
        height,
      );
    case "calendar_display": {
      let result: DisplayComponentResult;
      try {
        result = await createCalendarDisplayElement(component, calendarSourceProvider, width, height);
      } catch (error) {
        result = componentFailure(
          component.kind,
          "Unhandled calendar render failure",
          error instanceof Error ? error.message : String(error),
        );
      }
      return renderResultToPngBuffer(result, width, height);
    }
    default: {
      const _exhaustive: never = component;
      throw new Error(`Unsupported tile component: ${String(_exhaustive)}`);
    }
  }
}
