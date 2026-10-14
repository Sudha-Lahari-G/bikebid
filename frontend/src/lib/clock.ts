import { useSyncExternalStore } from "react";
import { api } from "./api";

/**
 * Countdowns must follow the *server's* clock — a user's laptop can be minutes off.
 * We estimate offset = serverTime - localMidpoint once (NTP-style), then tick locally.
 */
let offsetMs = 0;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function computeOffset(serverIso: string, sentAt: number, receivedAt: number): number {
  const midpoint = (sentAt + receivedAt) / 2;
  return new Date(serverIso).getTime() - midpoint;
}

export async function syncClock(): Promise<void> {
  try {
    const sentAt = Date.now();
    const { server_time } = await api.serverTime();
    offsetMs = computeOffset(server_time, sentAt, Date.now());
  } catch {
    offsetMs = 0; // fall back to the local clock
  }
}

// One shared 1s ticker for every countdown on the page, instead of one interval per card.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let current = serverNow();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      current = serverNow();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current);
}
