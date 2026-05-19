'use client';
// Consistent page header: optional breadcrumb, a title (+ subtitle) and a
// right-aligned action cluster that wraps under the title on narrow screens.
import { Breadcrumb, Flex, Space, Typography, type BreadcrumbProps } from 'antd';
import type { ReactNode } from 'react';

const { Title, Text } = Typography;

// Antd's breadcrumb item type carries a `data-${string}` index signature, so
// reuse it directly rather than a hand-rolled shape that won't structurally
// match what <Breadcrumb items> expects.
export type Crumb = NonNullable<BreadcrumbProps['items']>[number];

export function Section({
  title,
  subtitle,
  breadcrumb,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumb?: BreadcrumbProps['items'];
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section>
      {breadcrumb && breadcrumb.length > 0 && (
        <Breadcrumb style={{ marginBottom: 8 }} items={breadcrumb} />
      )}
      <Flex
        align="center"
        justify="space-between"
        gap={16}
        wrap
        style={{ marginBottom: 16 }}
      >
        <div style={{ minWidth: 0 }}>
          <Title level={4} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle && <Text type="secondary">{subtitle}</Text>}
        </div>
        {actions && <Space wrap>{actions}</Space>}
      </Flex>
      {children}
    </section>
  );
}
