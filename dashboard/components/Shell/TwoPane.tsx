'use client';
// Side-by-side on lg+, stacked on md and below (Row + Col xs=24 lg=10/14).
import { Row, Col } from 'antd';
import type { ReactNode } from 'react';

export function TwoPane({
  left,
  right,
  gutter = 16,
}: {
  left: ReactNode;
  right: ReactNode;
  gutter?: number;
}) {
  return (
    <Row gutter={[gutter, gutter]}>
      <Col xs={24} lg={10}>
        {left}
      </Col>
      <Col xs={24} lg={14}>
        {right}
      </Col>
    </Row>
  );
}
