const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();

function fieldScore(query: string, text: string): number {
  if (!text) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 90;
  const words = text.split(/[\s\-_/(),.&]+/).filter(Boolean);
  if (words.some((word) => word.startsWith(query))) return 75;
  if (text.includes(query)) return 55;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => words.some((word) => word.startsWith(token)))) return 50;
  if (tokens.length > 1 && tokens.every((token) => text.includes(token))) return 40;
  return 0;
}

/**
 * Scores how well `query` matches an item. The first field is the item's name;
 * the rest (artist, album, keywords) count for less, and multi-word queries may
 * spread across fields ("moonlight adele").
 */
export function matchScore(query: string, name: string, ...secondary: Array<string | null | undefined>): number {
  const term = normalize(query);
  if (!term) return 0;
  const primary = fieldScore(term, normalize(name));
  const others = secondary.filter((field): field is string => Boolean(field)).map(normalize);
  const best = Math.max(primary, ...others.map((field) => fieldScore(term, field) * 0.6));
  if (best > 0) return best;
  const combined = [normalize(name), ...others].join(" ");
  const tokens = term.split(/\s+/);
  return tokens.length > 1 && tokens.every((token) => combined.includes(token)) ? 35 : 0;
}
