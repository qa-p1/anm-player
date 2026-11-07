/** Adds alpha to an `rgb(r, g, b)` string from the artwork palette hook. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  return match ? `rgb(${match[1]} ${match[2]} ${match[3]} / ${alpha})` : color;
}
