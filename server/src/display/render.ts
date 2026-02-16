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
import { createTodoDisplayElement, type TodoListProvider } from "./components/todo-display.js";

const FONT_NAME = "DejaVu Sans";
const FONT_MONO_NAME = "DejaVu Sans Mono";
type FontFaceSpec = {
  name?: string;
  weight: 400 | 700;
  style: "normal" | "italic";
  candidates: string[];
  required?: boolean;
};

const FONT_FACE_SPECS: FontFaceSpec[] = [
  {
    weight: 400,
    style: "normal",
    required: true,
    candidates: [
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    ],
  },
  {
    weight: 700,
    style: "normal",
    candidates: [
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    ],
  },
  {
    weight: 400,
    style: "italic",
    candidates: [
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
      "/usr/share/fonts/dejavu/DejaVuSans-Oblique.ttf",
    ],
  },
  {
    name: FONT_MONO_NAME,
    weight: 400,
    style: "normal",
    candidates: [
      "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
      "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
    ],
  },
];

let cachedFontFaces: Array<{
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal" | "italic";
}> | null = null;

function getFontFaces() {
  if (cachedFontFaces) return cachedFontFaces;

  const faces: Array<{
    name: string;
    data: Buffer;
    weight: 400 | 700;
    style: "normal" | "italic";
  }> = [];

  for (const spec of FONT_FACE_SPECS) {
    const candidate = spec.candidates.find((path) => existsSync(path));
    if (!candidate) {
      if (spec.required) {
        throw new Error(`Unable to find required display font. Tried: ${spec.candidates.join(", ")}`);
      }
      continue;
    }
    faces.push({
      name: spec.name ?? FONT_NAME,
      data: readFileSync(candidate),
      weight: spec.weight,
      style: spec.style,
    });
  }

  cachedFontFaces = faces;
  return cachedFontFaces;
}

export async function renderElementToPngBuffer(
  element: ReactElement,
  width: number,
  height: number,
): Promise<Buffer> {
  const svg = await satori(element, {
    width,
    height,
    fonts: getFontFaces(),
  });

  const resvg = new Resvg(svg);
  const pngData = resvg.render().asPng();
  return Buffer.from(pngData);
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
  calendarSourceProvider: CalendarSourceProvider,
  todoListProvider: TodoListProvider,
): Promise<ReactElement> {
  switch (component.kind) {
    case "string_display":
      return renderResultToElement(createStringDisplayElement(component));
    case "color_test":
      return renderResultToElement(createColorTestElement(component));
    case "calendar_display": {
      let result: DisplayComponentResult;
      try {
        result = await createCalendarDisplayElement(component, calendarSourceProvider);
      } catch (error) {
        result = componentFailure(
          component.kind,
          "Unhandled calendar render failure",
          error instanceof Error ? error.message : String(error),
        );
      }
      return renderResultToElement(result);
    }
    case "todo_display":
      return renderResultToElement(createTodoDisplayElement(component, todoListProvider));
    default: {
      const _exhaustive: never = component;
      throw new Error(`Unsupported tile component: ${String(_exhaustive)}`);
    }
  }
}
