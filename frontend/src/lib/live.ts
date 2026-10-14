import { useEffect, useRef, useState } from "react";
import { WS_URL } from "./api";
import type { LiveEvent } from "./types";

export type LiveState = "connecting" | "live" | "reconnecting";

/**
 * Subscribe to a server push channel. Reconnects with exponential backoff and
 * calls `onReconnect` so callers can refetch anything missed while offline.
 */
export function useLiveChannel(
  path: string | null,
  onEvent: (event: LiveEvent) => void,
  onReconnect?: () => void,
): LiveState {
  const [state, setState] = useState<LiveState>("connecting");
  const handlers = useRef({ onEvent, onReconnect });
  handlers.current = { onEvent, onReconnect };

  useEffect(() => {
    if (!path) return;
    let socket: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(WS_URL + path);
      socket.onopen = () => {
        if (attempt > 0) handlers.current.onReconnect?.();
        attempt = 0;
        setState("live");
        pingTimer = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 25_000);
      };
      socket.onmessage = (message) => {
        try {
          handlers.current.onEvent(JSON.parse(message.data) as LiveEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        clearInterval(pingTimer);
        if (closed) return;
        setState("reconnecting");
        const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };

    // Reconnect promptly when a backgrounded tab (or a sleeping laptop) comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible" && socket?.readyState === WebSocket.CLOSED) {
        clearTimeout(retryTimer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    setState("connecting");
    connect();
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [path]);

  return state;
}
