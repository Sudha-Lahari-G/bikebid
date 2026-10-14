import { describe, expect, it } from "vitest";
import { computeOffset } from "./clock";
import { formatINR, formatINRShort, formatRemaining, quickBids, remaining } from "./format";

describe("money formatting", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(1234567)).toBe("₹12,34,567");
  });

  it("abbreviates lakhs and crores", () => {
    expect(formatINRShort(250_000)).toBe("₹2.5L");
    expect(formatINRShort(15_000_000)).toBe("₹1.5Cr");
    expect(formatINRShort(9_500)).toBe("₹9.5K");
  });
});

describe("countdown", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");

  it("breaks the remaining time into parts", () => {
    const r = remaining("2026-10-15T12:30:15Z", now);
    expect([r.days, r.hours, r.minutes, r.seconds]).toEqual([1, 2, 30, 15]);
  });

  it("never goes negative after the deadline", () => {
    expect(remaining("2026-10-14T09:00:00Z", now).totalMs).toBe(0);
  });

  it("shows the two most significant units", () => {
    expect(formatRemaining(remaining("2026-10-16T13:00:00Z", now))).toBe("2d 3h");
    expect(formatRemaining(remaining("2026-10-14T11:05:00Z", now))).toBe("1h 05m");
    expect(formatRemaining(remaining("2026-10-14T10:02:07Z", now))).toBe("2m 07s");
    expect(formatRemaining(remaining("2026-10-14T10:00:42Z", now))).toBe("42s");
  });
});

describe("clock sync", () => {
  it("measures the server offset against the request midpoint", () => {
    // Request left at t=1000 and returned at t=1200 (local); server stamped 5100.
    expect(computeOffset(new Date(5100).toISOString(), 1000, 1200)).toBe(4000);
  });
});

describe("quick bids", () => {
  it("starts at the minimum and steps up by increments", () => {
    expect(quickBids(101_000, 1_000)).toEqual([101_000, 103_000, 106_000]);
  });
});
