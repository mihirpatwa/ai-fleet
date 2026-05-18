'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pin, PinOff, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MemoryActions({
  id,
  pinned,
  lesson,
}: {
  id: string;
  pinned: boolean;
  lesson: unknown;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<Response>) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      // Surface minimally; the dashboard is a local tool.
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        title={pinned ? 'Unpin' : 'Pin'}
        onClick={() =>
          run(() =>
            fetch(`/api/memory/${id}/pin`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ pinned: !pinned }),
            }),
          )
        }
      >
        {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        title="Edit lesson JSON"
        onClick={() => {
          const next = window.prompt('Edit lesson JSON', JSON.stringify(lesson));
          if (next == null) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(next);
          } catch {
            alert('Not valid JSON');
            return;
          }
          void run(() =>
            fetch(`/api/memory/${id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ lesson: parsed }),
            }),
          );
        }}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        title="Delete"
        onClick={() => {
          if (window.confirm('Delete this memory?')) {
            void run(() => fetch(`/api/memory/${id}`, { method: 'DELETE' }));
          }
        }}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
