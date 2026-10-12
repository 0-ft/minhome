import { useEffect, useRef, type ReactNode } from "react";
import { MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../lib/utils.js";

/** Never start a card drag from a form control (e.g. dragging a slider). */
function startsOnControl(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("input, textarea, select, [data-no-drag]");
}

class CardMouseSensor extends MouseSensor {
  static activators = [{
    eventName: "onMouseDown" as const,
    handler: ({ nativeEvent }: { nativeEvent: MouseEvent }) => nativeEvent.button === 0 && !startsOnControl(nativeEvent.target),
  }];
}

class CardTouchSensor extends TouchSensor {
  static activators = [{
    eventName: "onTouchStart" as const,
    handler: ({ nativeEvent }: { nativeEvent: TouchEvent }) => !startsOnControl(nativeEvent.target),
  }];
}

/**
 * Sensors for reorderable cards: mouse drags start after a few pixels, touch
 * drags after a short hold (so scrolling still works), and never from inputs.
 */
export function useCardSensors() {
  return useSensors(
    useSensor(CardMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(CardTouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
}

/**
 * A reorderable item. Swallows the click that browsers fire at the end of a
 * drag, so dropping a card doesn't also toggle or apply it.
 */
export function SortableItem({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const suppressClickUntil = useRef(0);
  const wasDragging = useRef(false);

  useEffect(() => {
    if (wasDragging.current && !isDragging) suppressClickUntil.current = Date.now() + 250;
    wasDragging.current = isDragging;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "relative z-10 opacity-90 [&>*]:shadow-xl [&>*]:scale-[1.02]", className)}
      onClickCapture={(e) => {
        // The click at the end of a drag can arrive before React has seen the
        // drag end, so also suppress while the drag is still marked active
        if (wasDragging.current || Date.now() < suppressClickUntil.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      {...attributes}
      {...listeners}
      // dnd-kit's attributes make the wrapper a focusable button; the card's own controls handle keyboard use
      tabIndex={-1}
      role={undefined}
    >
      {children}
    </div>
  );
}
