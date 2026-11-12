import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DangerZone } from "@/features/settings/danger-zone";
import { apiGet, apiPost } from "@/services/api-client";

vi.mock("@/services/api-client", () => ({ apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock("@/lib/forget-browser-data", () => ({ forgetBrowserData: vi.fn() }));

function setup(supported: boolean) {
  vi.mocked(apiGet).mockResolvedValue({ supported });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DangerZone dataRoot="/home/me/Music/anm" /></QueryClientProvider>);
}

beforeEach(() => vi.mocked(apiPost).mockClear());
afterEach(cleanup);

describe("danger zone", () => {
  it("offers uninstalling only in the installed app", async () => {
    setup(false);
    expect(await screen.findAllByText("Only available in the installed desktop app.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Erase data" })).toBeEnabled();
  });

  it("erases data in place after the typed confirmation", async () => {
    setup(false);
    fireEvent.click(screen.getByRole("button", { name: "Erase data" }));
    const confirm = screen.getAllByRole("button", { name: "Erase data" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to continue/), { target: { value: "RESET ANM PLAYER" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/settings/storage/reset", { confirmation: "RESET ANM PLAYER" }));
  });

  it("uninstalls while keeping data and says where it is", async () => {
    setup(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Uninstall" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(screen.getByRole("list", { name: "Kept" })).toHaveTextContent("Downloaded music");
    fireEvent.change(screen.getByLabelText(/to continue/), { target: { value: "UNINSTALL ANM PLAYER" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Uninstall" }).at(-1)!);
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("/home/me/Music/anm");
    expect(apiPost).toHaveBeenCalledWith("/app/uninstall", { keep_data: true, confirmation: "UNINSTALL ANM PLAYER" });
  });

  it("needs a different phrase to delete everything", async () => {
    setup(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete all" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(screen.queryByRole("list", { name: "Kept" })).toBeNull();
    fireEvent.change(screen.getByLabelText(/to continue/), { target: { value: "UNINSTALL ANM PLAYER" } });
    expect(screen.getAllByRole("button", { name: "Delete all" }).at(-1)).toBeDisabled();
  });
});
