import pc from 'picocolors';
import { getJson } from '../lib/http.js';
import { renderTree, type Task } from '../lib/render.js';

async function fetchTree(root?: string): Promise<string> {
  const cwd = process.cwd();
  try {
    const tasks = await getJson<Task[]>(`/tasks?project_root=${encodeURIComponent(cwd)}`);
    const header = pc.dim(`project ${cwd} — ${tasks.length} task(s)`);
    return `${header}\n${renderTree(tasks, root)}`;
  } catch (err) {
    return pc.red(`cannot reach daemon: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function status(opts: { watch?: boolean; root?: string }): Promise<void> {
  if (!opts.watch) {
    console.log(await fetchTree(opts.root));
    return;
  }
  const draw = async (): Promise<void> => {
    const out = await fetchTree(opts.root);
    process.stdout.write(`\x1b[2J\x1b[H${out}\n${pc.dim('watching — Ctrl-C to exit')}\n`);
  };
  await draw();
  const timer = setInterval(() => void draw(), 2000);
  process.on('SIGINT', () => {
    clearInterval(timer);
    process.stdout.write('\n');
    process.exit(0);
  });
}
