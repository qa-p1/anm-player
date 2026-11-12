/** Adds alpha to an `rgb(r, g, b)` string from the artwork palette hook. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  return match ? `rgb(${match[1]} ${match[2]} ${match[3]} / ${alpha})` : color;
}

/**
 * Keeps an artwork colour dark enough for white text: a white or pastel cover
 * becomes a deep shade of itself instead of a light grey that hides lyrics.
 */
export function darkenForText(color: string, maxLightness = 0.3): string {
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (!match) return color;
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const lightness = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lightness <= maxLightness) return color;
  const scale = maxLightness / lightness;
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}
