// r5: schedules CRUD proxies. GET (list) + POST (create).
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/schedules');
}
export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
