import type { ReactElement } from "react";
import type { DisplayComponentError } from "./component-result.js";

export function createErrorDisplayElement(
  error: DisplayComponentError,
): ReactElement {
  return (
    <div tw="font-sans flex flex-1 min-w-0 min-h-0 flex-col justify-center gap-1.5 text-left text-black">
      <div tw="text-[18px] font-bold leading-[1.1]">Tile error</div>
      <div tw="text-[14px] font-medium leading-[1.2]">{`${error.component}: ${error.message}`}</div>
      {error.detail ? <div tw="text-[12px] leading-[1.2]">{error.detail.slice(0, 120)}</div> : null}
    </div>
  );
}
