// The single chokepoint every event write goes through: redact the payload,
// persist it, then fan it out on the bus. spawn.ts, loop.ts and the hook
// ingestion route all call this so redaction and WebSocket broadcast can
// never be accidentally bypassed.
import type { FleetBus } from './bus.js';
import type { FleetDb, FleetEvent, RecordEventInput } from './db.js';
import { redact } from './redact.js';

export function recordAndBroadcast(
  db: FleetDb,
  bus: FleetBus,
  input: RecordEventInput,
): FleetEvent {
  const safe: RecordEventInput = {
    ...input,
    ...(input.payloadJson === undefined
      ? {}
      : { payloadJson: redact(input.payloadJson) as RecordEventInput['payloadJson'] }),
  };
  const row = db.recordEvent(safe);
  bus.emitEvent(row);
  return row;
}
