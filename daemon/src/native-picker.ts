// Phase-15 cross-OS native folder/file picker. The daemon shells out to the
// host's native dialog tool so EVERY browser (Chrome, Firefox, Safari, mobile)
// gets the same picker UX — the dialog is rendered by the OS, not the page.
//
//   macOS (darwin) → osascript: "choose folder" / "choose file"
//   Linux          → zenity (preferred) → kdialog
//   Windows (win32) → PowerShell: FolderBrowserDialog / OpenFileDialog
//
// Caveats:
//   * The dialog opens on the daemon host's desktop session. If the daemon runs
//     in Docker / over SSH without X forwarding / on a headless box, the dialog
//     can't render — capability() reports unavailable and the dashboard falls
//     back to its typed-path modal.
//   * Every returned path is run through the phase-8 hard denylist before it
//     leaves this module, so a user can't pick ~/.ssh by mistake.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { hardDenied } from './sandbox.js';

export type PickerMode = 'directory' | 'file';

export type NativePickResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; unavailable: string };

export interface PickerCapability {
  available: boolean;
  tool?: string;
  reason?: string;
}

/** Linux needs zenity OR kdialog. Mac/Win always-on (built-in). */
function which(cmd: string): boolean {
  // Use the shell PATH lookup — `command -v` is POSIX, but the daemon already
  // assumes a sane shell elsewhere (spawn paths). Just probe via spawn 'which'.
  try {
    // Synchronous existence check via child_process is overkill; the spawn
    // call below will fail fast if the tool's missing. Cheap PATH probe:
    const paths = (process.env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':');
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const p of paths) {
      for (const e of exts) {
        if (p && existsSync(`${p}/${cmd}${e}`)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function capability(): PickerCapability {
  if (process.env['AIFLEET_NATIVE_PICKER'] === 'off') {
    return { available: false, reason: 'disabled via AIFLEET_NATIVE_PICKER=off' };
  }
  if (process.platform === 'darwin') return { available: true, tool: 'osascript' };
  if (process.platform === 'win32') return { available: true, tool: 'powershell' };
  if (process.platform === 'linux') {
    if (!process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY']) {
      return { available: false, reason: 'no DISPLAY/WAYLAND_DISPLAY — headless session' };
    }
    if (which('zenity')) return { available: true, tool: 'zenity' };
    if (which('kdialog')) return { available: true, tool: 'kdialog' };
    return { available: false, reason: 'install `zenity` or `kdialog` for the native dialog' };
  }
  return { available: false, reason: `unsupported platform: ${process.platform}` };
}

interface SpawnResult {
  code: number;
  out: string;
  err: string;
}
function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<SpawnResult> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    p.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8');
    });
    const t = setTimeout(() => {
      try {
        p.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    p.on('close', (code: number | null) => {
      clearTimeout(t);
      res({ code: code ?? -1, out, err });
    });
    p.on('error', () => {
      clearTimeout(t);
      res({ code: -1, out, err });
    });
  });
}

async function pickMac(mode: PickerMode, title: string): Promise<NativePickResult> {
  // The user can press Cancel → osascript exits 1 with "User canceled.".
  const script =
    mode === 'directory'
      ? `POSIX path of (choose folder with prompt "${title.replace(/"/g, '\\"')}")`
      : `POSIX path of (choose file with prompt "${title.replace(/"/g, '\\"')}")`;
  const r = await run('osascript', ['-e', script]);
  if (r.code === 0 && r.out.trim()) return finalize(r.out.trim());
  if (/User canceled/i.test(r.err)) return { ok: false, cancelled: true };
  return { ok: false, unavailable: r.err.trim() || `osascript exit ${r.code}` };
}

async function pickLinux(mode: PickerMode, title: string): Promise<NativePickResult> {
  // zenity preferred; kdialog as fallback. zenity --file-selection prints the
  // selected path to stdout; exit 1 on cancel.
  if (which('zenity')) {
    const args = ['--file-selection', `--title=${title}`];
    if (mode === 'directory') args.push('--directory');
    const r = await run('zenity', args);
    if (r.code === 0 && r.out.trim()) return finalize(r.out.trim());
    if (r.code === 1) return { ok: false, cancelled: true };
    return { ok: false, unavailable: r.err.trim() || `zenity exit ${r.code}` };
  }
  if (which('kdialog')) {
    const args =
      mode === 'directory'
        ? ['--title', title, '--getexistingdirectory', process.env['HOME'] ?? '/']
        : ['--title', title, '--getopenfilename', process.env['HOME'] ?? '/'];
    const r = await run('kdialog', args);
    if (r.code === 0 && r.out.trim()) return finalize(r.out.trim());
    if (r.code === 1) return { ok: false, cancelled: true };
    return { ok: false, unavailable: r.err.trim() || `kdialog exit ${r.code}` };
  }
  return { ok: false, unavailable: 'install `zenity` or `kdialog`' };
}

async function pickWin(mode: PickerMode, title: string): Promise<NativePickResult> {
  // FolderBrowserDialog for directory mode, OpenFileDialog for file mode.
  // ShowDialog returns DialogResult.OK on success and Cancel otherwise.
  const safe = title.replace(/'/g, "''");
  const ps =
    mode === 'directory'
      ? `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='${safe}'; $f.ShowNewFolderButton=$true; $r = $f.ShowDialog(); if ($r -eq 'OK') { Write-Output $f.SelectedPath } else { exit 1 }`
      : `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title='${safe}'; $r = $f.ShowDialog(); if ($r -eq 'OK') { Write-Output $f.FileName } else { exit 1 }`;
  const r = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', ps]);
  if (r.code === 0 && r.out.trim()) return finalize(r.out.trim());
  if (r.code === 1) return { ok: false, cancelled: true };
  return { ok: false, unavailable: r.err.trim() || `powershell exit ${r.code}` };
}

function finalize(rawPath: string): NativePickResult {
  // Strip stray surrounding quotes/newlines, normalize (Windows \, POSIX /).
  const trimmed = rawPath.replace(/^["']|["']$/g, '').trim();
  const abs = resolve(trimmed);
  if (!existsSync(abs)) return { ok: false, unavailable: `path not readable: ${abs}` };
  const denied = hardDenied(abs);
  if (denied) return { ok: false, unavailable: `path not allowed — ${denied}` };
  return { ok: true, path: abs };
}

/** Open the host's native dialog. Returns success / cancelled / unavailable. */
export async function nativePick(
  mode: PickerMode = 'directory',
  title = mode === 'directory' ? 'Pick a project folder' : 'Pick a file',
): Promise<NativePickResult> {
  const cap = capability();
  if (!cap.available) return { ok: false, unavailable: cap.reason ?? 'unavailable' };
  if (process.platform === 'darwin') return pickMac(mode, title);
  if (process.platform === 'linux') return pickLinux(mode, title);
  if (process.platform === 'win32') return pickWin(mode, title);
  return { ok: false, unavailable: `unsupported platform: ${process.platform}` };
}

/** Helpful debug helper used by tests — verifies a chosen path is a directory. */
export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
