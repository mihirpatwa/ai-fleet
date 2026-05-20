// t1: Azure project members (team-aggregated) for the assignee dropdown.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/azure/users');
}
