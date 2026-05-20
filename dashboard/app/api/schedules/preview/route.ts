// s3: cron validate + next-fire preview proxy.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return proxy(`/schedules/preview?${url.searchParams.toString()}`);
}
