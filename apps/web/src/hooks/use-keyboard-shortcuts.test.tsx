import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";
import { playerTrack } from "@/test/music-fixtures";

vi.mock("@/services/audio-service", () => ({ audioService: { seek: vi.fn(), getCurrentTime: () => 20, getDuration: () => 100 } }));
function Shortcuts() { useKeyboardShortcuts(); return <><input aria-label="Text" /><select aria-label="Select"><option>One</option></select><button type="button">Native button</button><div contentEditable suppressContentEditableWarning><span>Editable child</span></div></>; }

beforeEach(() => {
  usePlayerStore.setState({ currentSong: playerTrack(), isPlaying: false, shuffle: false, repeat: "off", playbackStatus: "paused" });
  useUiStore.setState({ isCommandPaletteOpen: false });
});
afterEach(cleanup);

describe("keyboard controls", () => {
  it("runs player commands on the page and opens quick find", () => {
    render(<MemoryRouter><Shortcuts /></MemoryRouter>);
    fireEvent.keyDown(window, { code: "Space" });
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    fireEvent.keyDown(window, { code: "KeyS" });
    expect(usePlayerStore.getState().shuffle).toBe(true);
    fireEvent.keyDown(window, { code: "KeyK", ctrlKey: true });
    expect(useUiStore.getState().isCommandPaletteOpen).toBe(true);
  });
  it("preserves native keyboard behavior for controls and editable descendants", () => {
    render(<MemoryRouter><Shortcuts /></MemoryRouter>);
    for (const element of [screen.getByLabelText("Text"), screen.getByLabelText("Select"), screen.getByRole("button"), screen.getByText("Editable child")]) {
      fireEvent.keyDown(element, { code: "Space" });
      fireEvent.keyDown(element, { code: "KeyS" });
    }
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: false, shuffle: false });
  });
  it("does not steal browser shortcuts, repeated toggles, composing input or modal keys", () => {
    render(<MemoryRouter><Shortcuts /></MemoryRouter>);
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) fireEvent.keyDown(window, { code: "KeyM", ...modifiers });
    expect(usePlayerStore.getState().isMuted).not.toBe(true);
    render(<div role="dialog" aria-label="Modal" />);
    fireEvent.keyDown(window, { code: "Space" });
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });
  it("cannot start an empty player", () => {
    usePlayerStore.setState({ currentSong: null });
    render(<MemoryRouter><Shortcuts /></MemoryRouter>);
    fireEvent.keyDown(window, { code: "Space" });
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });
});
