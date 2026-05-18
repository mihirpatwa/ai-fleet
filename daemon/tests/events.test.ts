import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FleetBus } from '../src/bus.js';
import { createDb, type FleetDb, type FleetEvent } from '../src/db.js';
import { recordAndBroadcast } from '../src/events.js';

// Phase-8 requirement: redaction must happen at the event-ingestion
// chokepoint (recordAndBroadcast) — not only in the pure redact() — so every
// path (POST /events, spawn.ts emits, loop) is covered. One case per pattern.
const CASES: Array<[string, string, string]> = [
  ['llm_key', `sk-${'a'.repeat(40)}`, '[REDACTED:llm_key]'],
  ['github', `ghp_${'b'.repeat(36)}`, '[REDACTED:github]'],
  ['aws', `AKIA${'ABCDEFGHIJKLMNOP'}`, '[REDACTED:aws]'],
  ['google', `AIza${'C'.repeat(35)}`, '[REDACTED:google]'],
  ['slack', 'xoxb-123456789-abcdefGHIJKL', '[REDACTED:slack]'],
  [
    'private_key',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
    '[REDACTED:private_key]',
  ],
];

let db: FleetDb;
let bus: FleetBus;

beforeEach(() => {
  db = createDb({ path: ':memory:' });
  bus = new FleetBus();
});
afterEach(() => db.close());

describe('redaction at the ingestion chokepoint', () => {
  for (const [name, secret, marker] of CASES) {
    it(`redacts ${name} in the persisted row and the broadcast`, () => {
      const seen: FleetEvent[] = [];
      bus.onEvent((r) => seen.push(r));

      const row = recordAndBroadcast(db, bus, {
        type: 'log',
        payloadJson: { note: `value is ${secret} end`, nested: [secret] },
      });

      const persisted = JSON.stringify(db.listEvents({}).at(0)?.payloadJson);
      const returned = JSON.stringify(row.payloadJson);
      const broadcast = JSON.stringify(seen[0]?.payloadJson);

      for (const blob of [returned, persisted, broadcast]) {
        expect(blob).toContain(marker);
        expect(blob).not.toContain(secret);
      }
    });
  }
});
