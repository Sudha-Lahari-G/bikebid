const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function formatINR(amount: number): string {
  return inr.format(amount);
}

/** ₹1.2L / ₹3.4Cr — the way Indian buyers read prices at a glance. */
export function formatINRShort(amount: number): string {
  if (amount >= 1_00_00_000) return `₹${compact.format(amount / 1_00_00_000)}Cr`;
  if (amount >= 1_00_000) return `₹${compact.format(amount / 1_00_000)}L`;
  if (amount >= 1_000) return `₹${compact.format(amount / 1_000)}K`;
  return formatINR(amount);
}

export function formatKm(km: number): string {
  return `${new Intl.NumberFormat("en-IN").format(km)} km`;
}

export interface Remaining {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function remaining(targetIso: string, nowMs: number): Remaining {
  const totalMs = Math.max(0, new Date(targetIso).getTime() - nowMs);
  const s = Math.floor(totalMs / 1000);
  return {
    totalMs,
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3_600),
    minutes: Math.floor((s % 3_600) / 60),
    seconds: s % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatRemaining(r: Remaining): string {
  if (r.totalMs <= 0) return "0s";
  if (r.days > 0) return `${r.days}d ${r.hours}h`;
  if (r.hours > 0) return `${r.hours}h ${pad(r.minutes)}m`;
  if (r.minutes > 0) return `${r.minutes}m ${pad(r.seconds)}s`;
  return `${r.seconds}s`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso: string, nowMs: number): string {
  const diff = (new Date(iso).getTime() - nowMs) / 1000;
  const abs = Math.abs(diff);
  if (abs < 10) return "just now";
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3_600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3_600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Quick-bid suggestions: the minimum, then a couple of increments above it. */
export function quickBids(nextMin: number, increment: number): number[] {
  return [nextMin, nextMin + increment * 2, nextMin + increment * 5];
}
