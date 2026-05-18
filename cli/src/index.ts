#!/usr/bin/env node
// `ai-fleet` — the user-facing CLI. Point it at any project: init it, bring
// the daemon + dashboard up, submit goals, watch progress, tear down.
import { Command } from 'commander';
import { init } from './commands/init.js';
import { up } from './commands/up.js';
import { down } from './commands/down.js';
import { submit } from './commands/submit.js';
import { status } from './commands/status.js';
import { logs } from './commands/logs.js';
import { cost } from './commands/cost.js';
import { stop } from './commands/stop.js';
import { doctor } from './commands/doctor.js';
import { memory } from './commands/memory.js';

const program = new Command();
program
  .name('ai-fleet')
  .description('Point the autonomous agent fleet at any project')
  .version('0.1.0');

program
  .command('init')
  .description('scaffold .aifleet.yaml, CLAUDE.md and .claude/agents in the current project')
  .option('--profile <name>', 'profile to use (default: auto-detect react|generic)')
  .option('--force', 'overwrite existing .aifleet.yaml / CLAUDE.md')
  .action((opts: { profile?: string; force?: boolean }) => init(opts));

program
  .command('up')
  .description('start the daemon (7878) and dashboard (3737) under pm2')
  .action(() => up());

program
  .command('down')
  .description('stop the daemon and dashboard')
  .action(() => down());

program
  .command('submit <goal>')
  .description('submit a goal to the fleet for the current project')
  .option('--agent <agent>', 'assign to a specific agent (default: orchestrator)')
  .action((goal: string, opts: { agent?: string }) => submit(goal, opts));

program
  .command('status')
  .description("print the task tree for the current project's root")
  .option('--watch', 'redraw every 2s')
  .option('--root <id>', 'limit to one root task')
  .action((opts: { watch?: boolean; root?: string }) => status(opts));

program
  .command('logs')
  .description('stream live fleet events from the daemon')
  .option('--agent <agent>', 'only events from this agent')
  .option('--task <id>', 'only events for this task')
  .option('--follow', 'keep streaming after the daemon closes the socket')
  .action((opts: { agent?: string; task?: string; follow?: boolean }) => logs(opts));

program
  .command('cost')
  .description('aggregate token + USD usage (delegates to aifleet-db)')
  .option('--today', 'last day (default)')
  .option('--week', 'last week')
  .option('--month', 'last month')
  .action((opts: { today?: boolean; week?: boolean; month?: boolean }) => cost(opts));

program
  .command('stop <task-id>')
  .description('cancel a running task')
  .action((taskId: string) => stop(taskId));

program
  .command('doctor')
  .description('check the environment; exits non-zero if any check fails')
  .action(() => doctor());

const mem = program.command('memory').description('inspect & maintain the adaptive memory store');
mem
  .command('list')
  .description('list memories')
  .option('--agent <agent>')
  .option('--tags <a,b>')
  .option('--project <path>')
  .action((o: { agent?: string; tags?: string; project?: string }) =>
    memory([
      'list',
      ...(o.agent ? ['--agent', o.agent] : []),
      ...(o.tags ? ['--tags', o.tags] : []),
      ...(o.project ? ['--project', o.project] : []),
    ]),
  );
mem
  .command('show <id>')
  .description('show one memory as JSON')
  .action((id: string) => memory(['show', id]));
mem
  .command('compact')
  .description('merge duplicates, decay, prune, regenerate hot tiers')
  .action(() => memory(['compact']));
mem
  .command('export <out.json>')
  .description('export memories for sharing')
  .option('--project <path>')
  .action((out: string, o: { project?: string }) =>
    memory(['export', out, ...(o.project ? ['--project', o.project] : [])]),
  );
mem
  .command('import <in.json>')
  .description('merge a memory export into the store')
  .action((inp: string) => memory(['import', inp]));

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
