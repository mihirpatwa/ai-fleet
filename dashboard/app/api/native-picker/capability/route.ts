// Proxy: phase-15 native picker capability probe. Reports whether the daemon
// host can render a native dialog (DISPLAY/Wayland on Linux, always-on for
// macOS/Windows). The dashboard uses this to show a banner when the daemon
// is headless so users know the typed-path modal is the path forward.
import { proxy } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return proxy('/native-picker/capability');
}
