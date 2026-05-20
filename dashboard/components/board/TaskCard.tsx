'use client';
// Kanban card. shadcn Card/Badge/Progress → Antd Card/Tag/Progress. The role
// Tag uses a theme-agnostic tint (hex + ~12% alpha bg) so it reads on light
// and dark. Whole card links to the task detail page.
import Link from 'next/link';
import { Card, Progress, Tag, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import type { Task } from '@/lib/types';
import { roleColor, statusColor } from '@/lib/theme';
import { elapsed, parseTs, truncate } from '@/lib/format';
import { useTicker } from '@/lib/useTicker';

const { Text, Paragraph } = Typography;

export interface CardData {
  task: Task;
  tool: string | null;
  log: string | null;
}

/** Live per-second timer while running; fixed start→finish span otherwise. */
function CardElapsed({ task }: { task: Task }) {
  const running = task.status === 'running';
  const live = useTicker(parseTs(task.startedAt), running);
  return <>{running ? live : elapsed(task.startedAt, task.finishedAt)}</>;
}

export function TaskCard({ task, tool, log }: CardData) {
  const role = roleColor(task.assignedAgent);
  return (
    <Link href={`/task/${task.id}`} style={{ display: 'block', minWidth: 0 }}>
      <Card size="small" hoverable styles={{ body: { padding: 12 } }} style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <Tag
            style={{ margin: 0, color: role, borderColor: role, background: `${role}1f` }}
          >
            {task.assignedAgent}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            <ClockCircleOutlined /> <CardElapsed task={task} />
          </Text>
        </div>

        <Paragraph
          strong
          ellipsis={{ rows: 2, tooltip: task.title }}
          style={{ marginTop: 8, marginBottom: 0, wordBreak: 'break-word' }}
        >
          {task.title}
        </Paragraph>

        {tool && (
          <Text
            type="secondary"
            italic
            ellipsis
            style={{ display: 'block', fontSize: 12, marginTop: 4 }}
          >
            using {tool}
          </Text>
        )}

        <Progress
          percent={task.progress}
          showInfo={false}
          size="small"
          strokeColor={statusColor(task.status)}
          style={{ marginTop: 8, marginBottom: 0 }}
        />

        {log && (
          <Text
            type="secondary"
            ellipsis={{ tooltip: log }}
            style={{ display: 'block', fontFamily: 'monospace', fontSize: 11, marginTop: 4 }}
          >
            {truncate(log, 90)}
          </Text>
        )}
      </Card>
    </Link>
  );
}
