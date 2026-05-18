import pc from 'picocolors';
import { postJson } from '../lib/http.js';

export async function stop(taskId: string): Promise<void> {
  try {
    const t = await postJson<{ id: string; status: string }>(
      `/tasks/${encodeURIComponent(taskId)}/cancel`,
    );
    console.log(`${pc.green('cancelled')} ${pc.bold(t.id)} -> ${t.status}`);
  } catch (err) {
    console.error(pc.red(`stop failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
