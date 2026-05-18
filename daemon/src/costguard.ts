// Cost circuit breakers (phase-8). Extends phase-4's loop-level hourly cap
// with a per-task absolute cap and a per-agent rolling-hour cap, checked in
// spawnAgent before each turn.
import { tsMsAgo, type FleetDb } from './db.js';
import type { FleetConfig } from './config.js';

export interface CapCheck {
  exceeded: boolean;
  reason?: string;
  taskUsd: number;
  agentHourUsd: number;
}

export function checkCostCaps(
  db: FleetDb,
  config: FleetConfig,
  taskId: string,
  agent: string,
): CapCheck {
  const task = db.raw
    .prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM agent_runs WHERE task_id = ?')
    .get(taskId) as { c: number };
  const agentHour = db.raw
    .prepare(
      'SELECT COALESCE(SUM(cost_usd),0) AS c FROM agent_runs WHERE agent = ? AND started_at >= ?',
    )
    .get(agent, tsMsAgo(3_600_000)) as { c: number };

  const taskUsd = Number(task.c ?? 0);
  const agentHourUsd = Number(agentHour.c ?? 0);

  if (taskUsd >= config.per_task_cap_usd) {
    return {
      exceeded: true,
      reason: `per-task cost cap $${config.per_task_cap_usd} reached ($${taskUsd.toFixed(4)})`,
      taskUsd,
      agentHourUsd,
    };
  }
  if (agentHourUsd >= config.per_agent_hourly_cap) {
    return {
      exceeded: true,
      reason: `per-agent hourly cap $${config.per_agent_hourly_cap} reached for ${agent} ($${agentHourUsd.toFixed(4)})`,
      taskUsd,
      agentHourUsd,
    };
  }
  return { exceeded: false, taskUsd, agentHourUsd };
}
