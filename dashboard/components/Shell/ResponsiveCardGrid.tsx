'use client';
// Responsive card grid: 1 / 2 / 3 / 4 columns at xs / sm / md / xl via Antd
// Row+Col. `minColWidth` guards a card from collapsing narrower than intended
// while never exceeding its column (so it can't introduce horizontal scroll).
import { Row, Col, Empty } from 'antd';
import type { ReactNode } from 'react';

interface Props<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  rowKey?: (item: T, index: number) => string | number;
  minColWidth?: number;
  gutter?: number;
  empty?: ReactNode;
}

export function ResponsiveCardGrid<T>({
  items,
  renderItem,
  rowKey,
  minColWidth = 280,
  gutter = 16,
  empty,
}: Props<T>) {
  if (items.length === 0) return <>{empty ?? <Empty />}</>;
  return (
    <Row gutter={[gutter, gutter]}>
      {items.map((item, i) => (
        <Col key={rowKey ? rowKey(item, i) : i} xs={24} sm={12} md={8} xl={6}>
          <div style={{ minWidth: minColWidth, maxWidth: '100%' }}>{renderItem(item, i)}</div>
        </Col>
      ))}
    </Row>
  );
}
