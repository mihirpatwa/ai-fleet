// Terminal rendering: role/status colors and a hand-rolled task tree.
import pc from 'picocolors';

export interface Task {
  id: string;
  parentId: string | null;
  rootId: string;
  projectRoot: string;
  title: string;
  assignedAgent: string;
  status: string;
  progress: number;
  createdAt: string;
}

type Paint = (s: string) => string;

// Spec palette mapped onto picocolors' 16-color set: purple→magenta,
// teal→cyan, coral→red, amber→yellow, security→bold red, rest→gray.
const ROLE: Record<string, Paint> = {
  orchestrator: pc.magenta,
  coder: pc.cyan,
  reviewer: pc.red,
  tester: pc.yellow,
  'security-auditor': (s) => pc.bold(pc.red(s)),
};

export function roleColor(agent: string): Paint {
  return ROLE[agent] ?? pc.gray;
}

export function statusColor(status: string): string {
  switch (status) {
    case 'done':
      return pc.green(status);
    case 'failed':
      return pc.red(status);
    case 'blocked':
      return pc.yellow(status);
    case 'running':
      return pc.cyan(status);
    case 'review':
      return pc.magenta(status);
    case 'cancelled':
      return pc.dim(status);
    default:
      return status;
  }
}

/** Render `tasks` as a parent/child tree (optionally limited to one root). */
export function renderTree(tasks: Task[], rootId?: string): string {
  const scope = rootId ? tasks.filter((t) => t.rootId === rootId) : tasks;
  if (scope.length === 0) return pc.dim('no tasks');

  const byParent = new Map<string, Task[]>();
  const ids = new Set(scope.map((t) => t.id));
  for (const t of scope) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : '__root__';
    const arr = byParent.get(key);
    if (arr) arr.push(t);
    else byParent.set(key, [t]);
  }
  const sortByCreated = (a: Task, b: Task): number => a.createdAt.localeCompare(b.createdAt);
  const out: string[] = [];
  const walk = (t: Task, prefix: string, last: boolean, top: boolean): void => {
    const branch = top ? '' : last ? '└─ ' : '├─ ';
    out.push(
      `${prefix}${branch}${statusColor(t.status)} ` +
        `${roleColor(t.assignedAgent)(t.assignedAgent)} ` +
        `${t.title} ${pc.dim(`${t.progress}% ${t.id}`)}`,
    );
    const kids = (byParent.get(t.id) ?? []).sort(sortByCreated);
    const childPrefix = top ? '' : prefix + (last ? '   ' : '│  ');
    kids.forEach((k, i) => walk(k, childPrefix, i === kids.length - 1, false));
  };
  const roots = (byParent.get('__root__') ?? []).sort(sortByCreated);
  roots.forEach((r, i) => walk(r, '', i === roots.length - 1, true));
  return out.join('\n');
}
