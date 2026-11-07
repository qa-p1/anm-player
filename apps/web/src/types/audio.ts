export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1_000, 2_000, 4_000, 8_000, 16_000] as const;

export type EqualizerGains = [number, number, number, number, number, number, number, number, number, number];
export type EqualizerPresetName = "flat" | "bass-boost" | "treble-boost" | "vocal" | "rock" | "electronic" | "acoustic" | "custom";

export const EQ_PRESETS: Record<Exclude<EqualizerPresetName, "custom">, EqualizerGains> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "bass-boost": [6, 5, 4, 2, 0, -1, -1, 0, 1, 2],
  "treble-boost": [-2, -1, 0, 0, 1, 2, 3, 4, 5, 6],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  rock: [4, 3, 1, -1, -2, 1, 3, 4, 4, 3],
  electronic: [5, 4, 1, 0, -2, 1, 2, 4, 5, 4],
  acoustic: [2, 2, 1, 2, 3, 2, 2, 3, 2, 1],
};
