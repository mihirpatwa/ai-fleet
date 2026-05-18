// The scheduler. Every poll interval it checks the hourly cost cap, computes
// free concurrency slots, claims that many ready tasks and dispatches them
// through a p-limit gate. Shutdown stops scheduling, drains in-flight runs and
// interrupts the SDK; the entrypoint closes the DB afterwards.
import pLimit from 'p-limit';
import type { Logger } from 'pino';
import type { FleetConfig } from './config.js';
import { tsMsAgo, type FleetDb } from './db.js';
import type { Spawner } from './spawn.js';

export interface LoopDeps {
  db: FleetDb;
  config: FleetConfig;
  spawner: Spawner;
  logger: Logger;
}

export interface Loop {
  start(): void;
  stop(): Promise<void>;
  /** Run one scheduling tick now. Exposed for deterministic tests. */
  tick(): void;
}

const HOUR_MS = 3_600_000;

export function createLoop(deps: LoopDeps): Loop {
  const { db, config, spawner, logger } = deps;
  const limit = pLimit(config.max_concurrent_agents);
  // Tasks handed to p-limit but not yet terminal. getReadyTasks() can re-return
  // a task between claim and the queued→running flip (the flip happens inside
  // the deferred limited callback), so we exclude claimed ids to never
  // double-dispatch one task.
  const claimed = new Set<string>();
  const inFlight = new Set<Promise<void>>();
  let timer: NodeJS.Timeout | null = null;
  let stopping = false;

  function tick(): void {
    if (stopping) return;

    const spent = db.costSince(tsMsAgo(HOUR_MS)).totalUsd;
    if (spent >= config.cost_cap_per_hour_usd) {
      logger.warn(
        { spentUsd: spent, capUsd: config.cost_cap_per_hour_usd },
        'hourly cost cap reached; skipping tick',
      );
      return;
    }

    const slots = config.max_concurrent_agents - claimed.size;
    if (slots <= 0) return;

    const ready = db.getReadyTasks(slots + claimed.size).filter((t) => !claimed.has(t.id));
    for (const task of ready.slice(0, slots)) {
      claimed.add(task.id);
      const p = limit(() => spawner.spawnAgent(task))
        .catch((err: unknown) => {
          // spawnAgent already handles its own failures; this is belt-and-braces.
          logger.error({ taskId: task.id, err }, 'unexpected spawn rejection');
        })
        .finally(() => {
          claimed.delete(task.id);
          inFlight.delete(p);
        });
      inFlight.add(p);
    }
  }

  return {
    start() {
      // Crash/restart recovery: a fresh process has no in-flight runs, so any
      // task left `running` (including one waiting out a retry backoff) is
      // orphaned. Requeue it.
      const orphans = db.queryTasks({ status: 'running' });
      for (const o of orphans) {
        db.updateTask(o.id, { status: 'queued' });
        logger.warn({ taskId: o.id }, 'requeued orphaned running task on startup');
      }
      logger.info(
        {
          pollMs: config.poll_interval_ms,
          maxConcurrent: config.max_concurrent_agents,
          costCapUsd: config.cost_cap_per_hour_usd,
        },
        'scheduler started',
      );
      timer = setInterval(tick, config.poll_interval_ms);
      tick(); // don't wait a full interval for the first dispatch
    },

    async stop() {
      stopping = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info({ inFlight: inFlight.size }, 'scheduler stopping; draining in-flight runs');
      await spawner.shutdown(); // interrupt live SDK queries so awaits resolve
      await Promise.allSettled([...inFlight]);
      logger.info('scheduler stopped');
    },

    tick,
  };
}
