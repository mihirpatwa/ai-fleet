'use client';
// Token + cost usage. shadcn cards → Antd Statistic + Progress bar lists
// (Recharts intentionally avoided — one extra dep for three bar lists isn't
// worth it; Antd Progress reads fine on both themes).
import { Card, Col, Progress, Row, Statistic, Typography } from 'antd';
import type { CostRow } from '@/lib/types';
import { compact, usd } from '@/lib/format';

function BarList({ title, rows }: { title: string; rows: CostRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.costUsd));
  return (
    <Card size="small" title={title}>
      {rows.length === 0 ? (
        <Typography.Text type="secondary">No data.</Typography.Text>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.key}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <Typography.Text style={{ fontFamily: 'monospace' }} ellipsis>
                  {r.key}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                  {usd(r.costUsd)} · {compact(r.inputTokens)} in / {compact(r.outputTokens)} out
                </Typography.Text>
              </div>
              <Progress
                percent={Math.round((r.costUsd / max) * 100)}
                showInfo={false}
                size="small"
                strokeColor="#6366f1"
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export interface CostData {
  totals: { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; runs: number };
  byAgent: CostRow[];
  byModel: CostRow[];
  byDay: CostRow[];
}

export function CostView({ data }: { data: CostData }) {
  const { totals } = data;
  const stats = [
    { label: 'Total cost', value: usd(totals.costUsd) },
    { label: 'Input tokens', value: compact(totals.inputTokens) },
    { label: 'Output tokens', value: compact(totals.outputTokens) },
    { label: 'Cached tokens', value: compact(totals.cacheReadTokens) },
    { label: 'Agent runs', value: String(totals.runs) },
  ];

  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {stats.map((s) => (
          <Col xs={12} sm={8} md={6} lg={4} key={s.label}>
            <Card size="small">
              <Statistic title={s.label} value={s.value} />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <BarList title="By agent" rows={data.byAgent} />
        </Col>
        <Col xs={24} lg={8}>
          <BarList title="By model" rows={data.byModel} />
        </Col>
        <Col xs={24} lg={8}>
          <BarList title="By day" rows={data.byDay} />
        </Col>
      </Row>
    </>
  );
}
