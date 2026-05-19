'use client';
// Kanban surface. Columns are Antd Cards whose body is an independently
// scrollable list. Responsive: 5-col grid at xl+, 3-col grid at md–lg, and a
// horizontally-scrolling track at xs/sm (the acceptance test asserts that
// horizontal scroll at 375px). Drag is visual-only this phase.
import { Badge, Card, Empty, Grid, Typography } from 'antd';
import type { Task } from '@/lib/types';
import { FilterBar, type GoalOption } from './FilterBar';
import { TaskCard, type CardData } from './TaskCard';
import { LiveAgentStrip } from './LiveAgentStrip';

const COLUMNS: { name: string; has: (s: Task['status']) => boolean }[] = [
  { name: 'Backlog', has: (s) => s === 'queued' },
  { name: 'In progress', has: (s) => s === 'running' },
  { name: 'Review', has: (s) => s === 'review' },
  { name: 'Blocked', has: (s) => s === 'blocked' },
  { name: 'Done', has: (s) => s === 'done' || s === 'failed' || s === 'cancelled' },
];

export function Board({
  cards,
  goals,
  agents,
}: {
  cards: CardData[];
  goals: GoalOption[];
  agents: string[];
}) {
  const screens = Grid.useBreakpoint();

  // xl+ → 5 columns; md–lg → 3 (wraps to 2 rows); xs/sm → horizontal scroll.
  const mode = screens.xl ? 'grid5' : screens.md ? 'grid3' : 'scroll';

  const trackStyle: React.CSSProperties =
    mode === 'scroll'
      ? { display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }
      : {
          display: 'grid',
          gap: 16,
          gridTemplateColumns: mode === 'grid5' ? 'repeat(5, 1fr)' : 'repeat(3, 1fr)',
          alignItems: 'flex-start',
        };
  const colStyle: React.CSSProperties =
    mode === 'scroll' ? { flex: '0 0 80vw', maxWidth: 360 } : {};

  return (
    <div>
      <LiveAgentStrip cards={cards} />
      <FilterBar goals={goals} agents={agents} />

      {cards.length === 0 ? (
        <Empty
          style={{ marginTop: 64 }}
          description="No tasks yet. Submit a goal from the header to get started."
        />
      ) : (
        <div style={trackStyle}>
          {COLUMNS.map((col) => {
            const items = cards.filter((c) => col.has(c.task.status));
            return (
              <Card
                key={col.name}
                size="small"
                title={col.name}
                extra={
                  <Badge
                    count={items.length}
                    showZero
                    color="#6366f1"
                    overflowCount={999}
                  />
                }
                style={colStyle}
                styles={{
                  body: {
                    padding: 8,
                    maxHeight: 'calc(100vh - 220px)',
                    overflowY: 'auto',
                  },
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((c) => (
                    <TaskCard key={c.task.id} task={c.task} tool={c.tool} log={c.log} />
                  ))}
                  {items.length === 0 && (
                    <Typography.Text
                      type="secondary"
                      style={{ textAlign: 'center', padding: '24px 0' }}
                    >
                      Empty
                    </Typography.Text>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
