import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { createRequire } from "module";
import { ImageResponse } from "@takumi-rs/image-response";
import type { ReactElement } from "react";
import type { CalendarService } from "../calendar/service.js";
import type { TileComponentConfig } from "./tiles.js";
import { createCalendarDisplayElement } from "./components/calendar-display.js";
import { createColorTestElement } from "./components/color-test.js";
import { type DisplayComponentResult, componentFailure } from "./components/component-result.js";
import { createErrorDisplayElement } from "./components/error-display.js";
import { createPolymarketGraphDisplayElement } from "./components/polymarket-graph-display.js";
import { createStringDisplayElement } from "./components/string-display.js";
import { createListDisplayElement, type ListProvider } from "./components/list-display.js";

const FONT_NAME = "Inter";
const FONT_MONO_NAME = "Inter Mono";
const require = createRequire(import.meta.url);
const INTER_VARIABLE_PACKAGE_ROOT = dirname(require.resolve("@fontsource-variable/inter/package.json"));

function interFileCandidates(stem: string): string[] {
  return [
    join(INTER_VARIABLE_PACKAGE_ROOT, "files", `${stem}.woff2`),
    join(INTER_VARIABLE_PACKAGE_ROOT, "files", `${stem}.woff`),
  ];
}

type FontFaceSpec = {
  names: string[];
  style: "normal" | "italic";
  candidates: string[];
  required?: boolean;
};

const FONT_FACE_SPECS: FontFaceSpec[] = [
  {
    names: [FONT_NAME, "sans-serif"],
    style: "normal",
    required: true,
    candidates: interFileCandidates("inter-latin-wght-normal"),
  },
  {
    names: [FONT_NAME, "sans-serif"],
    style: "italic",
    required: true,
    candidates: interFileCandidates("inter-latin-wght-italic"),
  },
  {
    names: [FONT_MONO_NAME, "monospace"],
    style: "normal",
    required: true,
    candidates: interFileCandidates("inter-latin-wght-normal"),
  },
];

let cachedFontFaces: Array<{
  name: string;
  data: ArrayBuffer;
  style: "normal" | "italic";
}> | null = null;

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  // Copy into a fresh ArrayBuffer so the return type is never SharedArrayBuffer.
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

function getFontFaces() {
  if (cachedFontFaces) return cachedFontFaces;

  const faces: Array<{
    name: string;
    data: ArrayBuffer;
    style: "normal" | "italic";
  }> = [];

  for (const spec of FONT_FACE_SPECS) {
    const candidate = spec.candidates.find((path) => existsSync(path));
    if (!candidate) {
      if (spec.required) {
        throw new Error(
          `Unable to find required display font (${spec.names.join(", ")} ${spec.style}).` +
          ` Tried: ${spec.candidates.join(", ")}`,
        );
      }
      continue;
    }
    const data = bufferToArrayBuffer(readFileSync(candidate));
    for (const name of spec.names) {
      faces.push({
        name,
        data,
        style: spec.style,
      });
    }
  }

  cachedFontFaces = faces;
  return cachedFontFaces;
}

export async function renderElementToPngBuffer(
  element: ReactElement,
  width: number,
  height: number,
): Promise<Buffer> {
  const imageResponse = new ImageResponse(element, {
    width,
    height,
    format: "png",
    fonts: getFontFaces(),
  });
  const rendered = await imageResponse.arrayBuffer();
  return Buffer.from(rendered);
}

function renderResultToElement(
  result: DisplayComponentResult,
): ReactElement {
  if (result.ok) {
    return result.element;
  }

  console.warn(
    `[display/render] Component error (${result.error.component}): ${result.error.message}` +
    `${result.error.detail ? ` (${result.error.detail})` : ""}`,
  );
  return createErrorDisplayElement(result.error);
}

export async function createComponentElement(
  component: TileComponentConfig,
  calendarService: CalendarService,
  listProvider: ListProvider,
): Promise<ReactElement> {
  switch (component.kind) {
    case "string_display":
      return renderResultToElement(createStringDisplayElement(component));
    case "color_test":
      return renderResultToElement(createColorTestElement(component));
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
      throw new Error(`Unsupported tile component: ${String(_exhaustive)}`);
    }
  }
}
