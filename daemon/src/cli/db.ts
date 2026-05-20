#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import pc from 'picocolors';
import { createDb, type FleetEvent, type Task } from '../db.js';
import { loadConfig } from '../config.js';
import {
  compact as memoryCompact,
  completedRetrospectorRuns,
  exportMemories,
  getMemory,
  importMemories,
  listMemories,
  regenerateHotTier,
  type Memory,
} from '../memory.js';

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

const memory = program.command('memory').description('adaptive memory store');

memory
  .command('list')
  .description('list memories')
  .option('--project <path>')
  .option('--agent <agent>')
  .option('--tags <csv>', 'comma-separated tags to filter by')
  .option('--limit <n>', '', '20')
  .action((o: { project?: string; agent?: string; tags?: string; limit: string }) => {
    const db = createDb();
    try {
      const wantTags = (o.tags ?? '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      let rows = listMemories(db, {
        ...(o.project ? { projectRoot: o.project } : {}),
        ...(o.agent ? { agent: o.agent } : {}),
        limit: Number(o.limit),
      });
      if (wantTags.length) {
        rows = rows.filter((m) => m.tags.some((t) => wantTags.includes(t.toLowerCase())));
      }
      if (rows.length === 0) return console.log('no memories');
      for (const m of rows) {
        console.log(
          `${pc.dim(m.id)}  ${pc.green(m.confidence.toFixed(2))}  u${m.usedCount}` +
            `${m.pinned ? pc.yellow(' 📌') : ''}  ${pc.cyan(m.agent ?? '-')}  ` +
            `${pc.dim(`[${m.tags.join(',')}]`)}  ${m.context ?? ''}`,
        );
      }
    } finally {
      db.close();
    }
  });

memory
  .command('show')
  .description('show one memory')
  .argument('<id>')
  .action((id: string) => {
    const db = createDb();
    try {
      const m = getMemory(db, id);
      if (!m) {
        console.error('not found');
        process.exit(1);
      }
      console.log(JSON.stringify(m, null, 2));
    } finally {
      db.close();
    }
  });

memory
  .command('compact')
  .description('merge duplicates, decay, prune, regenerate hot tiers')
  .action(() => {
    const db = createDb();
    try {
      const cfg = loadConfig();
      const r = memoryCompact(db);
      for (const proj of r.projects) {
        const remaining = Math.max(0, cfg.memory.shadow_runs - completedRetrospectorRuns(db, proj));
        regenerateHotTier(db, proj, { shadowRemaining: remaining });
      }
      console.log(
        `compacted: merged ${r.merged}, decayed ${r.decayed}, pruned ${r.pruned}; ` +
          `hot tier regenerated for ${r.projects.length} project(s)`,
      );
    } finally {
      db.close();
    }
  });

memory
  .command('export')
  .description('export memories to JSON')
  .argument('<out.json>')
  .option('--project <path>')
  .action((out: string, o: { project?: string }) => {
    const db = createDb();
    try {
      const rows = exportMemories(db, o.project);
      writeFileSync(out, JSON.stringify(rows, null, 2));
      console.log(`exported ${rows.length} memory(ies) -> ${out}`);
    } finally {
      db.close();
    }
  });

memory
  .command('import')
  .description('merge a memory export into the store')
  .argument('<in.json>')
  .action((inp: string) => {
    const db = createDb();
    try {
      const items = JSON.parse(readFileSync(inp, 'utf8')) as Memory[];
      const r = importMemories(db, items);
      console.log(`imported ${r.imported} new, merged ${r.merged} existing`);
    } finally {
      db.close();
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
