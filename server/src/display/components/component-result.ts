import type { ReactElement } from "react";

export type DisplayComponentError = {
  component: string;
  message: string;
  detail?: string;
};

export type DisplayComponentResult =
  | { ok: true; element: ReactElement }
  | { ok: false; error: DisplayComponentError };

export function componentSuccess(element: ReactElement): DisplayComponentResult {
  return { ok: true, element };
}

export function componentFailure(
  component: string,
  message: string,
  detail?: string,
): DisplayComponentResult {
  return {
    ok: false,
    error: { component, message, detail },
  };
}
