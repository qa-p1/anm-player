import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface TipState {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
}

const SHOW_DELAY_MS = 450;
const GAP = 8;

/** Moves a native `title` into `data-tooltip` so the browser never draws its own box. */
function claimTooltip(element: Element): string | null {
  const native = element.getAttribute("title");
  if (native) {
    element.setAttribute("data-tooltip", native);
    element.removeAttribute("title");
  }
  return element.getAttribute("data-tooltip");
}

function tooltipTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>("[title], [data-tooltip]") : null;
}

/** Text that is already fully visible does not need a tooltip repeating it. */
function isRedundant(element: HTMLElement, text: string) {
  if (element.matches("button, a, [role='button'], input, select")) return false;
  const visible = element.textContent?.trim() ?? "";
  return visible === text.trim() && element.scrollWidth <= element.clientWidth + 1;
}

/**
 * App-wide styled tooltips. Any element with `title` (or `data-tooltip`) gets a
 * themed bubble on hover or keyboard focus instead of the OS tooltip.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<number | null>(null);
  const active = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function clear() {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      active.current = null;
      setTip(null);
    }

    function schedule(element: HTMLElement, delay: number) {
      const text = claimTooltip(element);
      if (!text || isRedundant(element, text)) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      active.current = element;
      timer.current = window.setTimeout(() => {
        if (active.current !== element || !element.isConnected) return;
        const rect = element.getBoundingClientRect();
        const placement = rect.top < 48 ? "bottom" : "top";
        setTip({ text, x: rect.left + rect.width / 2, y: placement === "top" ? rect.top - GAP : rect.bottom + GAP, placement });
      }, delay);
    }

    function onPointerOver(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const element = tooltipTarget(event.target);
      if (!element) {
        if (active.current) clear();
        return;
      }
      if (element !== active.current) {
        setTip(null);
        schedule(element, SHOW_DELAY_MS);
      }
    }

    function onFocusIn(event: FocusEvent) {
      const element = tooltipTarget(event.target);
      if (element && element.matches(":focus-visible")) schedule(element, 150);
    }

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", clear);
    document.addEventListener("pointerdown", clear, true);
    document.addEventListener("keydown", clear, true);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", clear);
      document.removeEventListener("pointerdown", clear, true);
      document.removeEventListener("keydown", clear, true);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("blur", clear);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  if (!tip || typeof document === "undefined") return null;
  const left = Math.min(Math.max(tip.x, 12), window.innerWidth - 12);
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[1000] max-w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-white/10 bg-neutral-900/95 px-2.5 py-1.5 text-xs font-medium text-white shadow-[0_10px_30px_-8px_rgb(0_0_0/0.6)] backdrop-blur-md tooltip-in"
      style={{ left, top: tip.y, transform: `translate(-50%, ${tip.placement === "top" ? "-100%" : "0"})` }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
