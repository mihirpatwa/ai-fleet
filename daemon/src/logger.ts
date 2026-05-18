// Daemon logging: structured NDJSON to a daily-rotating file under
// ~/.aifleet, plus a human-readable pretty stream on stdout when attached to
// a TTY. pino itself has no built-in rotation, so the file destination is a
// small synchronous Writable that re-opens a dated file at the UTC date
// boundary and keeps a stable `daemon.log` symlink pointing at today's file.
import { Writable } from 'node:stream';
import { closeSync, mkdirSync, openSync, symlinkSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import pretty from 'pino-pretty';

function utcDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

class DailyRotatingFile extends Writable {
  private fd: number | null = null;
  private date = '';
  readonly stablePath: string;

  constructor(private readonly dir: string) {
    super();
    mkdirSync(dir, { recursive: true });
    this.stablePath = join(dir, 'daemon.log');
  }

  private rollover(): void {
    const today = utcDate();
    if (today === this.date && this.fd !== null) return;
    if (this.fd !== null) closeSync(this.fd);
    const name = `daemon-${today}.log`;
    this.fd = openSync(join(this.dir, name), 'a');
    this.date = today;
    // Best-effort: keep ~/.aifleet/daemon.log -> today's file. Relative target
    // so the link survives the directory being moved. Filesystems without
    // symlink support (some Windows setups) simply skip this.
    try {
      unlinkSync(this.stablePath);
    } catch {
      /* no existing link */
    }
    try {
      symlinkSync(name, this.stablePath);
    } catch {
      /* symlinks unsupported — the dated file is still authoritative */
    }
  }

  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (e?: Error | null) => void,
  ): void {
    try {
      this.rollover();
      writeSync(this.fd as number, chunk as Buffer);
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  override _final(cb: (e?: Error | null) => void): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
    cb();
  }
}

export interface FleetLogger {
  logger: pino.Logger;
  /** Stable path operators tail: `<dir>/daemon.log` (symlink to today's file). */
  logFile: string;
  /** Flush + close the file destination. Await before process exit. */
  close(): Promise<void>;
}

export function createLogger(opts: { level: string; dir: string }): FleetLogger {
  const file = new DailyRotatingFile(opts.dir);
  const streams: pino.StreamEntry[] = [{ level: opts.level as pino.Level, stream: file }];
  // Foreground / interactive: also pretty-print to stdout. When detached the
  // dated file is the only sink (no duplicate, no ANSI in redirected output).
  if (process.stdout.isTTY) {
    streams.push({
      level: opts.level as pino.Level,
      stream: pretty({ colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' }),
    });
  }
  const logger = pino(
    { level: opts.level, base: { svc: 'aifleet-daemon' } },
    pino.multistream(streams),
  );
  return {
    logger,
    logFile: file.stablePath,
    close: () =>
      new Promise<void>((resolve) => {
        file.end(() => resolve());
      }),
  };
}
