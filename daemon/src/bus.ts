// Process-local pub/sub + the session→task index.
//
// Two pieces of shared in-memory state the daemon's modules coordinate
// through, kept in their own module so spawn.ts (writer) and server.ts
// (reader / broadcaster) need not import each other.
import { EventEmitter } from 'node:events';
import type { FleetEvent } from './db.js';

/** Emits `'event'` with every freshly-inserted {@link FleetEvent} row. */
export class FleetBus extends EventEmitter {
  emitEvent(row: FleetEvent): void {
    this.emit('event', row);
  }

  onEvent(listener: (row: FleetEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

/**
 * Maps a Claude Agent SDK `session_id` to the fleet task that spawned it.
 * Populated by spawn.ts when the SDK emits its `system:init` message and read
 * by `POST /events` so hook callbacks that only know their session id can be
 * attributed to the right task.
 */
export type SessionTaskMap = Map<string, string>;

export function createSessionTaskMap(): SessionTaskMap {
  return new Map<string, string>();
}
