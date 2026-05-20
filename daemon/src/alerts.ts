// Outbound alerts/webhooks. Fire-and-forget, never throws, never blocks a
// run. Destinations come from config.alerts; each alert carries the task id
// and a dashboard deep link.
import type { Logger } from 'pino';
import type { FleetConfig } from './config.js';

export type AlertEvent =
  | 'security_blocking_finding'
  | 'goal_completed'
  | 'goal_failed'
  // Phase 13: a queued task's model was deprecated/removed at the API.
  | 'model_deprecated';

export interface AlertContext {
  taskId?: string;
  projectRoot?: string;
  summary?: string;
}

export interface Alerts {
  notify(event: AlertEvent, ctx?: AlertContext): Promise<void>;
}

const TIMEOUT_MS = 5000;

export function createAlerts(config: FleetConfig, logger: Logger): Alerts {
  const a = config.alerts;

  async function post(url: string, body: unknown): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      logger.warn({ url, err }, 'alert delivery failed');
    }
  }

  return {
    async notify(event, ctx = {}): Promise<void> {
      const link = ctx.taskId ? `${a.dashboard_url}/task/${ctx.taskId}` : a.dashboard_url;
      const text =
        `ai-fleet · ${event}` +
        (ctx.taskId ? ` · task ${ctx.taskId}` : '') +
        (ctx.summary ? ` — ${ctx.summary}` : '') +
        ` · ${link}`;
      const payload = {
        event,
        taskId: ctx.taskId ?? null,
        projectRoot: ctx.projectRoot ?? null,
        summary: ctx.summary ?? null,
        url: link,
        ts: new Date().toISOString(),
      };

      const jobs: Promise<void>[] = [];
      if (a.slack_webhook) jobs.push(post(a.slack_webhook, { text }));
      if (a.discord_webhook) jobs.push(post(a.discord_webhook, { content: text }));
      if (a.generic_post) jobs.push(post(a.generic_post, payload));
      if (a.smtp) {
        // No SMTP transport is bundled (no mail dependency). Surface intent
        // rather than silently dropping it.
        logger.warn(
          { event, to: a.smtp.to },
          'smtp alert configured but no mail transport is bundled; skipping',
        );
      }
      if (jobs.length === 0) {
        logger.debug({ event, taskId: ctx.taskId }, 'alert (no destinations configured)');
        return;
      }
      await Promise.allSettled(jobs);
    },
  };
}
