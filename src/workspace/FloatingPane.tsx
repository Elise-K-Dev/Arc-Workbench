import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Resizable, type ResizeDirection } from "re-resizable";
import type { FloatingPaneState, PaneBounds } from "./floatingPaneTypes";

type Props = {
  pane: FloatingPaneState;
  active: boolean;
  canvasWidth: number;
  canvasHeight: number;
  children: ReactNode;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onBoundsChange: (id: string, bounds: PaneBounds) => void;
  onToggleMaximize: (id: string) => void;
};

export function FloatingPane({
  pane,
  active,
  canvasWidth,
  canvasHeight,
  children,
  onClose,
  onFocus,
  onBoundsChange,
  onToggleMaximize,
}: Props) {
  const availableWidth = Math.max(360, canvasWidth - 24);
  const availableHeight = Math.max(220, canvasHeight - 24);
  const restoredWidth = Math.min(pane.width, availableWidth);
  const restoredHeight = Math.min(pane.height, availableHeight);
  const restoredPosition = {
    x: Math.max(0, Math.min(pane.x, canvasWidth - restoredWidth)),
    y: Math.max(0, Math.min(pane.y, canvasHeight - restoredHeight)),
  };
  const [dragPosition, setDragPosition] = useState(restoredPosition);
  const dragPositionRef = useRef(restoredPosition);
  const pendingDragPositionRef = useRef(restoredPosition);
  const paneElementRef = useRef<Resizable | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const dragState = useRef<{
    startX: number;
    startY: number;
    paneX: number;
    paneY: number;
  } | undefined>(undefined);

  useEffect(() => {
    if (!pane.maximized) {
      dragPositionRef.current = restoredPosition;
      setDragPosition(restoredPosition);
    }
  }, [
    pane.maximized,
    pane.x,
    pane.y,
    restoredPosition.x,
    restoredPosition.y,
  ]);

  const position = pane.maximized
    ? { x: 0, y: 0 }
    : dragPosition;
  const size = pane.maximized
    ? { width: canvasWidth, height: canvasHeight }
    : { width: restoredWidth, height: restoredHeight };

  const finishResizing = (
    direction: ResizeDirection,
    element: HTMLElement,
  ) => {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const widthDelta = width - restoredWidth;
    const heightDelta = height - restoredHeight;
    const x = direction.includes("left")
      ? Math.max(0, dragPositionRef.current.x - widthDelta)
      : dragPositionRef.current.x;
    const y = direction.includes("top")
      ? Math.max(0, dragPositionRef.current.y - heightDelta)
      : dragPositionRef.current.y;
    const nextPosition = { x, y };
    dragPositionRef.current = nextPosition;
    setDragPosition(nextPosition);
    onBoundsChange(pane.id, {
      x,
      y,
      width,
      height,
    });
  };

  useEffect(() => {
    const moveDragging = (event: MouseEvent) => {
      const drag = dragState.current;
      if (!drag) {
        return;
      }

      const x = Math.max(
        0,
        Math.min(
          canvasWidth - restoredWidth,
          drag.paneX + event.clientX - drag.startX,
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          canvasHeight - restoredHeight,
          drag.paneY + event.clientY - drag.startY,
        ),
      );
      const nextPosition = { x, y };
      dragPositionRef.current = nextPosition;
      pendingDragPositionRef.current = nextPosition;
      if (animationFrameRef.current !== undefined) {
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = undefined;
        const pendingPosition = pendingDragPositionRef.current;
        if (paneElementRef.current?.resizable) {
          paneElementRef.current.resizable.style.transform =
            `translate3d(${pendingPosition.x}px, ${pendingPosition.y}px, 0)`;
        }
      });
    };

    const stopDragging = () => {
      if (!dragState.current) {
        return;
      }

      dragState.current = undefined;
      document.body.classList.remove("is-dragging-pane");
      window.cancelAnimationFrame(animationFrameRef.current ?? 0);
      animationFrameRef.current = undefined;
      const finalPosition = dragPositionRef.current;
      if (paneElementRef.current?.resizable) {
        paneElementRef.current.resizable.style.transform =
          `translate3d(${finalPosition.x}px, ${finalPosition.y}px, 0)`;
      }
      setDragPosition(finalPosition);
      onBoundsChange(pane.id, {
        x: finalPosition.x,
        y: finalPosition.y,
        width: pane.width,
        height: pane.height,
      });
    };

    window.addEventListener("mousemove", moveDragging);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("blur", stopDragging);
    return () => {
      window.removeEventListener("mousemove", moveDragging);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("blur", stopDragging);
      window.cancelAnimationFrame(animationFrameRef.current ?? 0);
      document.body.classList.remove("is-dragging-pane");
    };
  }, [
    canvasHeight,
    canvasWidth,
    onBoundsChange,
    pane.height,
    pane.id,
    pane.width,
    restoredHeight,
    restoredWidth,
  ]);

  const startDragging = (event: ReactMouseEvent<HTMLElement>) => {
    if (
      pane.maximized ||
      event.button !== 0 ||
      (event.target as Element).closest(".floating-pane__controls")
    ) {
      return;
    }

    event.preventDefault();
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      paneX: dragPosition.x,
      paneY: dragPosition.y,
    };
    pendingDragPositionRef.current = dragPosition;
    document.body.classList.add("is-dragging-pane");
    onFocus(pane.id);
  };

  return (
    <Resizable
      size={size}
      minWidth={360}
      minHeight={220}
      maxWidth={pane.maximized ? canvasWidth : canvasWidth - position.x}
      maxHeight={pane.maximized ? canvasHeight : canvasHeight - position.y}
      enable={pane.maximized ? false : undefined}
      bounds="parent"
      style={{
        position: "absolute",
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        zIndex: pane.zIndex,
      }}
      ref={paneElementRef}
      className={`floating-pane${active ? " floating-pane--active" : ""}`}
      onResizeStart={() => {
        window.requestAnimationFrame(() => onFocus(pane.id));
      }}
      onResizeStop={(_, direction, element) =>
        finishResizing(direction, element)
      }
    >
      <section
        className="floating-pane__window"
        onFocusCapture={() => onFocus(pane.id)}
        onPointerDown={(event) => {
          const target = event.target as Element;
          if (!target.closest(".floating-pane__titlebar")) {
            onFocus(pane.id);
          }
        }}
      >
        <header
          className="floating-pane__titlebar"
          onMouseDown={startDragging}
          onDoubleClick={() => onToggleMaximize(pane.id)}
        >
          <span className="floating-pane__kind" aria-hidden="true">
            {pane.kind === "browser"
              ? "W"
              : pane.kind === "editor"
                ? "{}"
                : pane.kind === "file-explorer"
                  ? "F"
                  : pane.kind === "git"
                    ? "G"
                    : pane.kind === "agent"
                      ? "A"
                      : pane.kind === "patch-preview"
                        ? "P"
                      : ">_"}
          </span>
          <span className="floating-pane__title">{pane.title}</span>
          <div
            className="floating-pane__controls"
            onPointerDown={() => onFocus(pane.id)}
          >
            <button
              className="window-control"
              type="button"
              title={pane.maximized ? "Restore" : "Maximize"}
              aria-label={pane.maximized ? "Restore pane" : "Maximize pane"}
              onClick={() => onToggleMaximize(pane.id)}
            >
              {pane.maximized ? "R" : "[]"}
            </button>
            <button
              className="window-control window-control--close"
              type="button"
              title="Close"
              aria-label="Close pane"
              onClick={() => onClose(pane.id)}
            >
              X
            </button>
          </div>
        </header>
        <div className="floating-pane__content">{children}</div>
      </section>
    </Resizable>
  );
}
