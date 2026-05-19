'use client';
// First-class live timers. ONE shared 1s interval drives every running timer
// on the page (strip cards, kanban cards, detail header, flow nodes) — never
// one interval per component. The interval only exists while ≥1 mounted
// useTicker has isRunning=true; it stops when the last one unmounts/stops.
import { useEffect, useState } from 'react';

let timer: ReturnType<typeof setInterval> | null = null;
let runningCount = 0;
const subscribers = new Set<() => void>();

function ensureInterval(): void {
  if (timer || runningCount === 0) return;
  timer = setInterval(() => {
    for (const cb of subscribers) cb();
  }, 1000);
}

function maybeStopInterval(): void {
  if (timer && runningCount === 0) {
    clearInterval(timer);
    timer = null;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ms → "HH:MM:SS" (hours uncapped: a 30h run shows "30:00:00"). */
export function formatHMS(ms: number): string {
  const s = Math.floor((ms < 0 ? 0 : ms) / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/**
 * Live "HH:MM:SS" since startedAt. While isRunning it re-renders every second
 * off the shared tick; when not running it returns a static value (callers
 * showing finished tasks should use format.elapsed with finishedAt instead).
 */
export function useTicker(startedAt: Date | null, isRunning: boolean): string {
  const [, force] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    runningCount++;
    ensureInterval();
    const cb = (): void => force((x) => (x + 1) % 1_000_000);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
      runningCount--;
      maybeStopInterval();
    };
  }, [isRunning]);

  if (!startedAt) return '00:00:00';
  return formatHMS(Date.now() - startedAt.getTime());
}
