'use client';
// Phase 12b: turns daemon SSE "notify" marker events into Antd toasts. The
// daemon emits a log event { notify:<kind>, summary, root_id } beside every
// alerts.notify() (spawn.ts); we surface the kinds the user enabled in
// Settings (useSettings) and deep-link to the goal's task.
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { App } from 'antd';
import { useStream } from '@/lib/useStream';
import { useSettings, type NotificationType } from '@/lib/stores/useSettings';

interface StreamEvent {
  id?: number;
  taskId?: string | null;
  payloadJson?: { notify?: string; summary?: string; root_id?: string } | null;
}

const KIND_META: Record<
  NotificationType,
  { method: 'success' | 'error' | 'warning'; title: string }
> = {
  goal_completed: { method: 'success', title: 'Goal completed' },
  goal_failed: { method: 'error', title: 'Goal failed' },
  security_blocking_finding: { method: 'warning', title: 'Security: blocking finding' },
  cost_cap_warning_80: { method: 'warning', title: 'Cost cap ~80%' },
  model_deprecated: { method: 'warning', title: 'Model deprecated' },
};

function isKind(s: unknown): s is NotificationType {
  return typeof s === 'string' && s in KIND_META;
}

export function Notifier() {
  const router = useRouter();
  const { notification } = App.useApp();
  const notify = useSettings((s) => s.notify);
  // Latest prefs without re-subscribing the stream each toggle.
  const prefs = useRef(notify);
  prefs.current = notify;
  const seen = useRef<Set<number>>(new Set());

  useStream((data: unknown) => {
    const ev = data as StreamEvent;
    const kind = ev?.payloadJson?.notify;
    if (!isKind(kind)) return;
    if (typeof ev.id === 'number') {
      if (seen.current.has(ev.id)) return; // SSE replay / multi-consumer dedupe
      seen.current.add(ev.id);
    }
    if (!prefs.current[kind]) return; // disabled in Settings
    const meta = KIND_META[kind];
    const taskId = ev.payloadJson?.root_id || ev.taskId || undefined;
    notification[meta.method]({
      message: meta.title,
      description: ev.payloadJson?.summary ?? '',
      placement: 'bottomRight',
      duration: kind === 'goal_completed' ? 4.5 : 8,
      ...(taskId
        ? {
            onClick: () => router.push(`/task/${taskId}`),
            style: { cursor: 'pointer' },
          }
        : {}),
    });
  });

  useEffect(() => {
    const s = seen.current;
    return () => s.clear();
  }, []);

  return null;
}
