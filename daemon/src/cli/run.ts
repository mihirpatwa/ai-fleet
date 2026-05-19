#!/usr/bin/env node
// `aifleet-daemon` — the long-running fleet process. Wires config, logging,
// the SQLite state layer, the scheduler and the HTTP/WS server together, then
// blocks until a termination signal triggers a graceful drain.
import { Command } from 'commander';
import { createAlerts } from '../alerts.js';
import { createAuditLog } from '../audit.js';
import { createSessionTaskMap, FleetBus } from '../bus.js';
import { aifleetDir, loadConfig, type FleetConfig } from '../config.js';
import { createDb } from '../db.js';
import { createLogger } from '../logger.js';
import { createLoop } from '../loop.js';
import { createModelRegistry } from '../models.js';
import { createScheduler } from '../scheduler.js';
import { createServer } from '../server.js';
import { createSpawner } from '../spawn.js';

interface Flags {
  config?: string;
  port?: string;
  logLevel?: string;
}

async function main(flags: Flags): Promise<void> {
  const base = loadConfig(flags.config);
  const config: FleetConfig = {
    ...base,
    ...(flags.port ? { server_port: Number(flags.port) } : {}),
    ...(flags.logLevel ? { log_level: flags.logLevel as FleetConfig['log_level'] } : {}),
  };

  const {
    logger,
    logFile,
    close: closeLogger,
  } = createLogger({
    level: config.log_level,
    dir: aifleetDir(),
  });
  const db = createDb();
  const bus = new FleetBus();
  const sessionMap = createSessionTaskMap();
  const audit = createAuditLog(aifleetDir());
  const alerts = createAlerts(config, logger);
  // Phase-13 model registry: serve the cached list immediately, refresh in
  // the background (and hourly) — only hits Anthropic when a key is set.
  const models = createModelRegistry(logger);
  models.start();

  const spawner = createSpawner({ db, config, bus, sessionMap, logger, audit, alerts });
  const loop = createLoop({ db, config, spawner, logger });
  const scheduler = createScheduler({ db, logger });
  const server = await createServer({
    db,
    config,
    bus,
    sessionMap,
    logger,
    models,
    inFlight: spawner.inFlight,
  });

  await server.listen({ port: config.server_port, host: '127.0.0.1' });
  loop.start();
  scheduler.start();
  logger.info(
    { port: config.server_port, db: db.path, logFile },
    `aifleet-daemon up — http://127.0.0.1:${config.server_port}`,
  );

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'received signal; shutting down');
    // Stop scheduling → drain in-flight runs → stop serving → close DB → flush logs.
    void (async () => {
      try {
        scheduler.stop();
        models.stop();
        await loop.stop();
        await server.close();
        db.close();
        audit.close();
      } catch (err) {
        logger.error({ err }, 'error during shutdown');
      } finally {
        await closeLogger();
        process.exit(0);
      }
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection');
  });
}

const program = new Command();
program
  .name('aifleet-daemon')
  .description('ai-fleet long-running orchestrator daemon')
  .option('--config <path>', 'path to config.yaml (default ~/.aifleet/config.yaml)')
  .option('--port <port>', 'override server_port')
  .option('--log-level <level>', 'override log_level')
  .action((opts: Flags) => main(opts));

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
