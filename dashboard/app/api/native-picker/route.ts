// Proxy: phase-15 cross-OS native picker. The daemon shells to osascript /
// zenity / PowerShell on its host, so the dialog renders the same on every
// browser. Body: { mode?: 'directory'|'file', title?: string }.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  return proxy('/native-picker', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
