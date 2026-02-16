import { createElement, type CSSProperties, type ReactElement } from "react";
import type { DisplayComponentError } from "./component-result.js";

export function createErrorDisplayElement(
  error: DisplayComponentError,
  width: number,
  height: number,
): ReactElement {
  const wrapperStyle: CSSProperties = {
    width,
    height,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    boxSizing: "border-box",
    border: "2px solid #000",
    padding: Math.max(8, Math.round(Math.min(width, height) * 0.04)),
    backgroundColor: "#fff",
    color: "#000",
    fontFamily: "DejaVu Sans",
    textAlign: "left",
    gap: 6,
  };

  const headingStyle: CSSProperties = {
    fontSize: Math.max(14, Math.round(Math.min(width, height) * 0.09)),
    fontWeight: 700,
    lineHeight: 1.1,
  };

  const messageStyle: CSSProperties = {
    fontSize: Math.max(12, Math.round(Math.min(width, height) * 0.065)),
    fontWeight: 500,
    lineHeight: 1.2,
  };

  const detailStyle: CSSProperties = {
    fontSize: Math.max(10, Math.round(Math.min(width, height) * 0.05)),
    lineHeight: 1.2,
  };

  return createElement("div", { style: wrapperStyle }, [
    createElement("div", { style: headingStyle, key: "heading" }, "Tile error"),
    createElement(
      "div",
      { style: messageStyle, key: "message" },
      `${error.component}: ${error.message}`,
    ),
    error.detail
      ? createElement("div", { style: detailStyle, key: "detail" }, error.detail.slice(0, 120))
      : null,
  ]);
}
