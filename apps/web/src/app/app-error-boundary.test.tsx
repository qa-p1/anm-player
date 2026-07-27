import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "@/app/app-error-boundary";

function Broken(): never {
  throw new Error("test failure");
}

describe("AppErrorBoundary", () => {
  it("renders an accessible recovery screen for route failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(<AppErrorBoundary><Broken /></AppErrorBoundary>);

    expect(screen.getByRole("alert")).toHaveTextContent("Aura hit an unexpected problem");
    expect(screen.getByRole("button", { name: "Reload Aura" })).toBeVisible();
    expect((await axe(container)).violations).toEqual([]);
  });
});
