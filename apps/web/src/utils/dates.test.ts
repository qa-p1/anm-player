import { expect, it } from "vitest";

import { parseServerDate, serverTime } from "@/utils/dates";

it("reads zone-less server timestamps as UTC and keeps explicit zones", () => {
  expect(parseServerDate("2026-11-12T08:27:26.650304")?.toISOString()).toBe("2026-11-12T08:27:26.650Z");
  expect(parseServerDate("2026-11-12T08:27:26+05:30")?.toISOString()).toBe("2026-11-12T02:57:26.000Z");
  expect(parseServerDate("2026-11-12T08:27:26Z")?.toISOString()).toBe("2026-11-12T08:27:26.000Z");
  expect(parseServerDate("not a date")).toBeNull();
  expect(serverTime(null)).toBe(0);
});
