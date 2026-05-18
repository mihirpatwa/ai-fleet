#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { createDb, tsMsAgo, type FleetEvent, type Task } from '../db.js';

function statusColor(s: string): string {
  switch (s) {
    case 'done':
      return pc.green(s);
    case 'failed':
      return pc.red(s);
    case 'blocked':
      return pc.yellow(s);
    case 'running':
      return pc.cyan(s);
    case 'review':
      return pc.magenta(s);
    case 'cancelled':
      return pc.dim(s);
    default:
      return s;
  }
}

function parseSince(input: string): { ts: string; label: string } {
  const m = /^(\d+)([dwm])$/.exec(input);
  if (!m) {
    console.error(`invalid --since "${input}" (use e.g. 1d, 1w, 1m)`);
    process.exit(1);
  }
  const n = Number(m[1]);
  const unit = m[2];
  const dayMs = 86_400_000;
  const ms = unit === 'd' ? n * dayMs : unit === 'w' ? n * 7 * dayMs : n * 30 * dayMs;
  return { ts: tsMsAgo(ms), label: input };
}

function printEvent(e: FleetEvent): void {
  const payload = e.payloadJson === null ? '' : JSON.stringify(e.payloadJson);
  console.log(
    `${pc.dim(e.ts)}  #${e.id}  ${pc.bold(e.type)}  ${pc.cyan(e.agent ?? '-')}  ${pc.dim(payload)}`,
  );
}

const program = new Command();
program.name('aifleet-db').description('ai-fleet SQLite state inspector');

program
  .command('tasks')
  .description('list tasks, optionally filtered')
  .option('--status <status>', 'queued|running|done|failed|blocked|review|cancelled')
  .option('--agent <agent>')
  .option('--root <rootId>')
  .option('--project <path>')
  .action((opts: { status?: string; agent?: string; root?: string; project?: string }) => {
    const db = createDb();
    try {
      const rows = db.queryTasks({
        ...(opts.status ? { status: opts.status as Task['status'] } : {}),
        ...(opts.agent ? { agent: opts.agent } : {}),
        ...(opts.root ? { root: opts.root } : {}),
        ...(opts.project ? { project: opts.project } : {}),
      });
      if (rows.length === 0) {
        console.log('no tasks');
        return;
      }
      for (const t of rows) {
        console.log(
          `${pc.dim(t.id)}  ${statusColor(t.status).padEnd(18)}  ${pc.bold(
            t.assignedAgent,
          )}  ${t.title}`,
        );
      }
      console.log(pc.dim(`\n${rows.length} task(s)`));
    } finally {
      db.close();
    }
  });

program
  .command('events')
  .description('list events for a task')
  .requiredOption('--task <taskId>')
  .option('--type <type>')
  .option('--tail', 'follow new events until Ctrl-C')
  .action((opts: { task: string; type?: string; tail?: boolean }) => {
    const db = createDb();
    const filter = {
      taskId: opts.task,
      order: 'asc' as const,
      limit: 1000,
      ...(opts.type ? { type: opts.type as FleetEvent['type'] } : {}),
    };
    const initial = db.listEvents(filter);
    for (const e of initial) printEvent(e);
    if (!opts.tail) {
      db.close();
      return;
    }
    let lastId = initial.length ? initial[initial.length - 1]!.id : 0;
    const timer = setInterval(() => {
      const more = db.listEvents({ ...filter, sinceId: lastId });
      for (const e of more) {
        printEvent(e);
        lastId = e.id;
      }
    }, 1000);
    process.on('SIGINT', () => {
      clearInterval(timer);
      db.close();
      process.exit(0);
    });
  });

program
  .command('cost')
  .description('aggregate agent-run cost')
  .option('--since <window>', 'e.g. 1d, 1w, 1m', '1d')
  .option('--by <dimension>', 'agent|task|day')
  .action((opts: { since: string; by?: string }) => {
    const db = createDb();
    try {
      const { ts, label } = parseSince(opts.since);
      if (opts.by) {
        if (!['agent', 'task', 'day'].includes(opts.by)) {
          console.error(`invalid --by "${opts.by}" (use agent|task|day)`);
          process.exit(1);
        }
        const rows = db.costBreakdown({ since: ts, by: opts.by as 'agent' | 'task' | 'day' });
        if (rows.length === 0) {
          console.log(`no agent runs since ${label}`);
          return;
        }
        for (const r of rows) {
          console.log(
            `${(r.key ?? '(none)').padEnd(26)}  ${pc.green(`$${r.totalUsd.toFixed(4)}`)}  ${
              r.runs
            } run(s)  ${r.inputTokens}in/${r.outputTokens}out`,
          );
        }
      } else {
        const c = db.costSince(ts);
        console.log(
          `since ${label}: ${pc.green(`$${c.totalUsd.toFixed(4)}`)} over ${c.runs} run(s)  ` +
            `tokens ${c.inputTokens}in/${c.outputTokens}out/${c.cacheReadTokens}cache`,
        );
      }
    } finally {
      db.close();
    }
  });

program
  .command('tree')
  .description('pretty parent/child tree for a root task')
  .argument('<rootId>')
  .action((rootId: string) => {
    const db = createDb();
    try {
      const tasks = db.getTaskTree(rootId);
      if (tasks.length === 0) {
        console.log(`no tasks for root ${rootId}`);
        return;
      }
      const byParent = new Map<string, Task[]>();
      for (const t of tasks) {
        const key = t.parentId ?? '__root__';
        const arr = byParent.get(key);
        if (arr) arr.push(t);
        else byParent.set(key, [t]);
      }
      const root = tasks.find((t) => t.id === rootId) ?? tasks.find((t) => t.parentId === null);
      const render = (t: Task, prefix: string, isRoot: boolean, last: boolean): void => {
        const branch = isRoot ? '' : last ? '└─ ' : '├─ ';
        console.log(
          `${prefix}${branch}${statusColor(t.status)} ${pc.bold(t.title)} ${pc.dim(t.id)}`,
        );
        const kids = byParent.get(t.id) ?? [];
        const childPrefix = isRoot ? '' : prefix + (last ? '   ' : '│  ');
        kids.forEach((k, i) => render(k, childPrefix, false, i === kids.length - 1));
      };
      if (root) render(root, '', true, true);
    } finally {
      db.close();
    }
  });

program
  .command('reset')
  .description('drop all tables and re-run migrations')
  .option('--yes', 'confirm the destructive reset')
  .action((opts: { yes?: boolean }) => {
    if (!opts.yes) {
      console.error('refusing to reset without --yes');
      process.exit(1);
    }
    const db = createDb();
    try {
      const r = db.resetSchema();
      console.log(
        `state reset at ${db.path} — applied ${
          r.applied.length ? r.applied.join(', ') : '0 migrations'
        }`,
      );
    } finally {
      db.close();
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
