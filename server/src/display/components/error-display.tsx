import type { ReactElement } from "react";
import type { DisplayComponentError } from "./component-result.js";

export function createErrorDisplayElement(
  error: DisplayComponentError,
): ReactElement {
  return (
    <div className="flex flex--col gap--small">
      <span className="title title--small">Tile error</span>
      <span className="description">{`${error.component}: ${error.message}`}</span>
      {error.detail ? <span className="label label--small">{error.detail.slice(0, 120)}</span> : null}
    </div>
  );
}
