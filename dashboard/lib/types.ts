// Camel-cased mirrors of the daemon's SQLite rows (migrations/001_initial.sql).
// The dashboard only ever reads, so these are the shapes returned by lib/db.ts
// and the daemon's HTTP API.

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'review'
  | 'cancelled';

export interface Task {
  id: string;
  parentId: string | null;
  rootId: string;
  projectRoot: string;
  title: string;
  assignedAgent: string;
  status: TaskStatus;
  dependsOn: string[];
  inputJson: unknown;
  outputJson: unknown;
  progress: number;
  retryCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type EventType =
  | 'started'
  | 'tool_use_pre'
  | 'tool_use_post'
  | 'progress'
  | 'log'
  | 'completed'
  | 'failed'
  | 'blocked';

export interface FleetEvent {
  id: number;
  taskId: string | null;
  agent: string | null;
  type: EventType;
  payloadJson: unknown;
  ts: string;
}

export interface AgentRun {
  id: string;
  taskId: string | null;
  agent: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  costUsd: number | null;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** A task plus its recursively-nested children — what /task/[id] Tree renders. */
export interface TaskNode extends Task {
  children: TaskNode[];
}

export interface TaskMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  runs: number;
  durationMs: number | null;
  retries: number;
}

export interface AgentSummary {
  agent: string;
  running: number;
  queued: number;
  done: number;
  failed: number;
  total: number;
  lastActivity: string | null;
  costUsd: number;
}

export interface CostRow {
  key: string;
  runs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface Memory {
  id: string;
  projectRoot: string;
  agent: string | null;
  tags: string[];
  context: string | null;
  lesson: unknown;
  confidence: number;
  usedCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  pinned: boolean;
}

export type Severity = 'low' | 'med' | 'high' | 'critical';

export interface SecurityFinding {
  taskId: string;
  projectRoot: string;
  taskStatus: TaskStatus;
  blocking: boolean;
  severity: Severity;
  file: string;
  line: number | null;
  rule: string;
  message: string;
  fixHint: string | null;
  ts: string;
}
