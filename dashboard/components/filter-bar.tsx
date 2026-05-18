'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export interface GoalOption {
  id: string;
  title: string;
}

export function FilterBar({ goals, agents }: { goals: GoalOption[]; agents: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    router.push(`${pathname}?${sp.toString()}`);
  }

  const cls =
    'h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Goal</span>
        <select
          className={cls}
          value={params.get('root') ?? ''}
          onChange={(e) => set('root', e.target.value)}
        >
          <option value="">All goals</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title.length > 48 ? g.title.slice(0, 47) + '…' : g.title}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Agent</span>
        <select
          className={cls}
          value={params.get('agent') ?? ''}
          onChange={(e) => set('agent', e.target.value)}
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
