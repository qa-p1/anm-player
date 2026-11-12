import { localTimeZone } from "@/utils/dates";
import { countryForTimeZone } from "@/utils/time-zone-countries";

/**
 * The listener's country, worked out locally: first from the browser time zone,
 * then from the language region (en-IN → IN). No network request is made.
 */
export function detectRegion(): string | null {
  const zone = localTimeZone();
  const fromZone = zone ? countryForTimeZone(zone) : null;
  if (fromZone) return fromZone;
  const language = typeof navigator === "undefined" ? "" : navigator.language;
  const match = /[-_]([A-Za-z]{2})\b/.exec(language);
  return match ? match[1].toUpperCase() : null;
}

/** "auto" (or nothing saved yet) follows detection; otherwise the chosen country. */
export function resolveRegion(setting: string | null | undefined): string | null {
  return !setting || setting === "auto" ? detectRegion() : setting;
}
