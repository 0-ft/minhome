import type { CSSProperties, ReactElement } from "react";
import type { DisplayComponentError } from "./component-result.js";

export function createErrorDisplayElement(
  error: DisplayComponentError,
): ReactElement {
  const wrapperStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "column",
    justifyContent: "center",
    color: "#000",
    fontFamily: "DejaVu Sans",
    textAlign: "left",
    gap: 6,
  };

  const headingStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.1,
  };

  const messageStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.2,
  };

  const detailStyle: CSSProperties = {
    fontSize: 12,
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
