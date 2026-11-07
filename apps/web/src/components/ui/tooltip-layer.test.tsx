import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipLayer } from "@/components/ui/tooltip-layer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("replaces the native title with a styled tooltip after a short hover", () => {
  render(<><TooltipLayer /><button type="button" title="Add top songs to queue" aria-label="Add top songs to queue">+</button></>);
  const button = screen.getByRole("button");
  fireEvent.pointerOver(button, { pointerType: "mouse" });
  expect(button).not.toHaveAttribute("title");
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.getByRole("tooltip")).toHaveTextContent("Add top songs to queue");
  fireEvent.pointerDown(button);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

it("skips the tooltip when the text is already fully visible", () => {
  render(<><TooltipLayer /><span title="Short name">Short name</span></>);
  fireEvent.pointerOver(screen.getByText("Short name"), { pointerType: "mouse" });
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
