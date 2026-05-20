// s2: run-now proxy. Fires the schedule immediately without altering its cron.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return proxy(`/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' });
}
