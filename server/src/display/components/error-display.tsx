import type { CSSProperties, ReactElement } from "react";
import type { DisplayComponentError } from "./component-result.js";

export function createErrorDisplayElement(
  error: DisplayComponentError,
  width: number,
  height: number,
): ReactElement {
  const baseSize = Math.min(width, height);

  const wrapperStyle: CSSProperties = {
    width,
    height,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    boxSizing: "border-box",
    padding: Math.max(8, Math.round(Math.min(width, height) * 0.04)),
    backgroundColor: "#fff",
    color: "#000",
    fontFamily: "DejaVu Sans",
    textAlign: "left",
    gap: 6,
  };

  const headingStyle: CSSProperties = {
    fontSize: Math.max(14, Math.round(baseSize * 0.09)),
    fontWeight: 700,
    lineHeight: 1.1,
  };

  const messageStyle: CSSProperties = {
    fontSize: Math.max(12, Math.round(baseSize * 0.065)),
    fontWeight: 500,
    lineHeight: 1.2,
  };

  const detailStyle: CSSProperties = {
    fontSize: Math.max(10, Math.round(baseSize * 0.05)),
    lineHeight: 1.2,
  };

  return (
    <div style={wrapperStyle}>
      <div style={headingStyle}>Tile error</div>
      <div style={messageStyle}>{`${error.component}: ${error.message}`}</div>
      {error.detail ? <div style={detailStyle}>{error.detail.slice(0, 120)}</div> : null}
    </div>
  );
}
