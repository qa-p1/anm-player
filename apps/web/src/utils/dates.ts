/**
 * The API stores times in UTC but SQLite drops the zone, so "2026-11-12T08:27:26"
 * must be read as UTC, not as local time (which would be hours off).
 */
export function parseServerDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasZone || !value.includes("T") ? value : `${value}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function serverTime(value: string | null | undefined): number {
  return parseServerDate(value)?.getTime() ?? 0;
}

/** The listener's IANA time zone, so day and hour charts follow their clock. */
export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
