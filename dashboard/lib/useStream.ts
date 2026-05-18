'use client';
// One process-wide EventSource('/api/stream') shared by every consumer (the
// connection indicator, the live board refresher). The /api/stream route
// already fans out a single daemon WebSocket, so this keeps the browser→Next
// hop to one connection too. Consumers pass an onEvent callback; the hook also
// reports the live connection status for the top-bar indicator.
import { useEffect, useRef, useSyncExternalStore } from 'react';

type Listener = (data: unknown) => void;

let es: EventSource | null = null;
let connected = false;
const statusSubs = new Set<() => void>();
const listeners = new Set<Listener>();

function setConnected(v: boolean): void {
  if (connected === v) return;
  connected = v;
  for (const cb of statusSubs) cb();
}

function ensure(): void {
  if (es || typeof window === 'undefined') return;
  es = new EventSource('/api/stream');
  es.onopen = (): void => setConnected(true);
  es.onerror = (): void => setConnected(false); // browser EventSource auto-reconnects
  es.onmessage = (e: MessageEvent<string>): void => {
    let data: unknown;
    try {
      data = JSON.parse(e.data);
    } catch {
      data = e.data;
    }
    for (const l of listeners) l(data);
  };
}

function subscribeStatus(cb: () => void): () => void {
  statusSubs.add(cb);
  ensure();
  return () => {
    statusSubs.delete(cb);
  };
}

export function useStream(onEvent?: Listener): { connected: boolean } {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  const isConnected = useSyncExternalStore(
    subscribeStatus,
    () => connected,
    () => false,
  );
  useEffect(() => {
    ensure();
    const l: Listener = (d) => ref.current?.(d);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { connected: isConnected };
}
