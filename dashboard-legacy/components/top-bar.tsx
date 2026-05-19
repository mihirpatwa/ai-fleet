'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState } from 'react';
import { Send } from 'lucide-react';
import { useStream } from '@/lib/useStream';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function TopBar({ projects }: { projects: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { connected } = useStream();

  const selectedProject = params.get('project') ?? projects[0] ?? '';
  const [project, setProject] = useState(selectedProject);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyProject(value: string) {
    setProject(value);
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set('project', value);
    else sp.delete('project');
    router.push(`${pathname}?${sp.toString()}`);
  }

  async function submitGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim() || !project.trim()) {
      setError('Goal and project root are both required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim(), project_root: project.trim() }),
      });
      if (!res.ok) throw new Error(`Daemon returned ${res.status}`);
      setGoal('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-2 font-semibold">
        <span
          className={`inline-block size-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`}
          title={connected ? 'Live stream connected' : 'Live stream disconnected'}
          aria-label={connected ? 'Connected' : 'Disconnected'}
        />
        ai-fleet
      </div>

      <input
        list="aifleet-projects"
        value={project}
        onChange={(e) => setProject(e.target.value)}
        onBlur={(e) => applyProject(e.target.value)}
        placeholder="project root"
        className="h-9 w-64 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <datalist id="aifleet-projects">
        {projects.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <form onSubmit={submitGoal} className="flex min-w-[18rem] flex-1 items-center gap-2">
        <Input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="submit a goal..."
          disabled={busy}
        />
        <Button type="submit" disabled={busy} className="shrink-0">
          <Send className="size-4" />
          {busy ? 'Sending' : 'Submit'}
        </Button>
      </form>
      {error && <p className="w-full text-sm text-red-500">{error}</p>}
    </header>
  );
}
