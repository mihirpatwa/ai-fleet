'use client';
// Detail header + tabs. shadcn (Badge/Separator/Tabs) → Antd via the Section
// primitive. The elapsed value is a first-class live timer (useTicker) while
// the task is running; finished tasks show the fixed start→finish span.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, App, Button, Space, Tag, Typography } from 'antd';
import type { BreadcrumbProps } from 'antd';
import type { FleetEvent, Task, TaskMetrics, TaskNode } from '@/lib/types';
import { roleColor, statusColor } from '@/lib/theme';
import { elapsed, parseTs } from '@/lib/format';
import { useTicker } from '@/lib/useTicker';
import { Section } from '@/components/Shell/Section';
import { TaskActions } from './TaskActions';
import { TaskTabs } from './TaskTabs';

const { Text } = Typography;

function tint(hex: string): React.CSSProperties {
  return { margin: 0, color: hex, borderColor: hex, background: `${hex}1f` };
}

function Elapsed({ task }: { task: Task }) {
  const running = task.status === 'running';
  const live = useTicker(parseTs(task.startedAt), running);
  return <Text type="secondary">{running ? live : elapsed(task.startedAt, task.finishedAt)}</Text>;
}

/** s1: pull model + source + effort from the 'started' event payload. The
 *  source explains how the model was chosen (adaptive heuristic vs explicit
 *  override vs default vs orchestrator slot) so the user can debug surprises. */
function ModelChip({ events }: { events: FleetEvent[] }) {
  const started = events.find((e) => e.type === 'started');
  if (!started || !started.payloadJson || typeof started.payloadJson !== 'object') return null;
  const p = started.payloadJson as {
    model?: string;
    model_source?: string;
    effort?: string;
  };
  if (!p.model) return null;
  return (
    <>
      <Tag color="blue">{p.model}</Tag>
      {p.model_source && p.model_source !== 'default' && (
        <Tag color={p.model_source === 'adaptive' ? 'geekblue' : 'default'}>{p.model_source}</Tag>
      )}
      {p.effort && <Tag color="purple">{p.effort} effort</Tag>}
    </>
  );
}

/** Shown when a task is blocked because its model was deprecated (phase 13
 *  step 8). One click requeues it with the current global default. */
function ModelDeprecatedBanner({ task }: { task: Task }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  async function migrate(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/models/migrate-task/${task.id}`, { method: 'POST' });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Request failed (${res.status})`);
      }
      message.success('Migrated to current default model; task requeued');
      router.refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message="Model deprecated; choose replacement"
      description={task.error}
      action={
        <Button size="small" type="primary" loading={busy} onClick={migrate}>
          Migrate to default
        </Button>
      }
    />
  );
}

export function TaskDetail({
  task,
  parent,
  events,
  tree,
  metrics,
}: {
  task: Task;
  parent: { id: string; title: string } | null;
  events: FleetEvent[];
  tree: TaskNode | null;
  metrics: TaskMetrics;
}) {
  const isRoot = task.rootId === task.id;
  const clip = (s: string): string => (s.length > 40 ? s.slice(0, 39) + '…' : s);

  const modelDeprecated =
    task.status === 'blocked' && !!task.error && task.error.startsWith('model deprecated:');

  const breadcrumb: BreadcrumbProps['items'] = [
    { title: <Link href="/">Board</Link> },
    ...(!isRoot ? [{ title: <Link href={`/task/${task.rootId}`}>root</Link> }] : []),
    ...(parent ? [{ title: <Link href={`/task/${parent.id}`}>{clip(parent.title)}</Link> }] : []),
    { title: <Text code>{task.id}</Text> },
  ];

  return (
    <Section
      title={task.title}
      breadcrumb={breadcrumb}
      actions={<TaskActions id={task.id} status={task.status} />}
    >
      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <Tag style={tint(roleColor(task.assignedAgent))}>{task.assignedAgent}</Tag>
        <Tag style={tint(statusColor(task.status))}>{task.status}</Tag>
        <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {task.projectRoot}
        </Text>
        <Elapsed task={task} />
        <ModelChip events={events} />
      </Space>

      {modelDeprecated ? (
        <ModelDeprecatedBanner task={task} />
      ) : (
        task.error && (
          <Alert type="error" showIcon message={task.error} style={{ marginBottom: 16 }} />
        )
      )}

      <TaskTabs events={events} tree={tree} metrics={metrics} output={task.outputJson} />
    </Section>
  );
}
