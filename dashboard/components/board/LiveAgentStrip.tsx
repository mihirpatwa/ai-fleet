'use client';
// Phase-12 live agent strip: a collapsible hero band of currently-running
// agents with per-second live timers. Data freshness comes from the shared SSE
// refresh (<Live/> re-runs the server board on every daemon event); the
// timers tick independently every second via the shared useTicker.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Card, Col, Collapse, Empty, Progress, Row, Tag, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { CardData } from './TaskCard';
import { roleColor, statusColor } from '@/lib/theme';
import { parseTs, truncate } from '@/lib/format';
import { useTicker } from '@/lib/useTicker';

const { Text, Paragraph } = Typography;

function LiveTile({ task, tool, log }: CardData) {
  const router = useRouter();
  const role = roleColor(task.assignedAgent);
  const timer = useTicker(parseTs(task.startedAt), true); // always running here

  return (
    <Card
      size="small"
      hoverable
      onClick={() => router.push(`/task/${task.id}`)}
      styles={{ body: { padding: 12 } }}
      style={{ cursor: 'pointer', borderColor: `${role}55`, width: '100%' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar size={24} style={{ background: role, fontSize: 12, flex: '0 0 auto' }}>
          {task.assignedAgent.charAt(0).toUpperCase()}
        </Avatar>
        <Text strong ellipsis style={{ flex: 1 }}>
          {task.assignedAgent}
        </Text>
        <Text strong style={{ fontFamily: 'monospace', fontSize: 13, color: statusColor('running') }}>
          {timer}
        </Text>
      </div>

      <Paragraph
        ellipsis={{ rows: 2, tooltip: task.title }}
        style={{ marginTop: 8, marginBottom: 0, wordBreak: 'break-word' }}
      >
        {task.title}
      </Paragraph>

      {tool && (
        <Tag
          style={{
            margin: '6px 0 0',
            fontStyle: 'italic',
            color: role,
            borderColor: role,
            background: `${role}1f`,
          }}
        >
          running {tool}
        </Tag>
      )}

      <Progress
        percent={task.progress}
        showInfo={false}
        size="small"
        strokeColor={statusColor('running')}
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
  );
}

export function LiveAgentStrip({ cards }: { cards: CardData[] }) {
  const running = cards.filter((c) => c.task.status === 'running');
  const [open, setOpen] = useState(true);

  return (
    <Collapse
      style={{ marginBottom: 16 }}
      activeKey={open ? ['live'] : []}
      onChange={(k) => setOpen((Array.isArray(k) ? k : [k]).includes('live'))}
      items={[
        {
          key: 'live',
          label: (
            <span>
              <ThunderboltOutlined style={{ color: statusColor('running') }} />{' '}
              <Text strong>Running agents</Text>{' '}
              <Tag color="blue" style={{ marginInlineStart: 4 }}>
                {running.length}
              </Tag>
            </span>
          ),
          children:
            running.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No agents running — submit a goal to see live activity."
              />
            ) : (
              <Row gutter={[16, 16]}>
                {running.map((c) => (
                  <Col key={c.task.id} xs={24} sm={12} md={8} lg={6} xl={4}>
                    <LiveTile task={c.task} tool={c.tool} log={c.log} />
                  </Col>
                ))}
              </Row>
            ),
        },
      ]}
    />
  );
}
