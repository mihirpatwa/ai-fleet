import pc from 'picocolors';
import { dashboardUrl } from '../lib/paths.js';
import { postJson } from '../lib/http.js';

export async function submit(goal: string, opts: { agent?: string }): Promise<void> {
  if (!goal || !goal.trim()) {
    console.error(pc.red('a non-empty goal is required'));
    process.exitCode = 1;
    return;
  }
  try {
    const task = await postJson<{ id: string; assignedAgent: string }>('/tasks', {
      goal: goal.trim(),
      project_root: process.cwd(),
      ...(opts.agent ? { agent: opts.agent } : {}),
    });
    console.log(`${pc.green('submitted')} ${pc.bold(task.id)} -> ${task.assignedAgent}`);
    console.log(`  ${dashboardUrl}/task/${task.id}`);
  } catch (err) {
    console.error(pc.red(`submit failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
