import { useCallback, useEffect, useRef } from "react";

/**
 * Throttle commits while something is being dragged: the first value goes out
 * immediately, then at most one every `intervalMs` (always the latest), and
 * `flush` sends whatever is still pending, e.g. on release.
 */
export function useThrottledCommit<T>(commit: (value: T) => void, intervalMs = 100) {
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const lastSentAt = useRef(0);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const sendPending = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!pending.current) return;
    const { value } = pending.current;
    pending.current = null;
    lastSentAt.current = Date.now();
    commitRef.current(value);
  }, []);

  const push = useCallback((value: T) => {
    pending.current = { value };
    const wait = intervalMs - (Date.now() - lastSentAt.current);
    if (wait <= 0) sendPending();
    else if (!timer.current) timer.current = setTimeout(sendPending, wait);
  }, [intervalMs, sendPending]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { push, flush: sendPending };
}
