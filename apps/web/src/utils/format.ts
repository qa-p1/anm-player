import { serverTime } from "@/utils/dates";

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  return formatTime(seconds);
}

export function formatListeningTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown length";
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
}

const relativeFormatter = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl
  ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

/** "2 days ago" style label; empty string for missing or invalid dates. */
export function formatRelativeDate(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "";
  const time = serverTime(value);
  if (!time) return "";
  const seconds = Math.round((time - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      const amount = Math.round(seconds / size);
      return relativeFormatter ? relativeFormatter.format(amount, unit) : `${Math.abs(amount)} ${unit}${Math.abs(amount) === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}
