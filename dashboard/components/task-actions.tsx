'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import type { TaskStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';

const TERMINAL: TaskStatus[] = ['done', 'failed', 'cancelled'];

export function TaskActions({ id, status }: { id: string; status: TaskStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'cancel' | 'retry') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {!TERMINAL.includes(status) && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => act('cancel')}>
          <Ban className="size-4" />
          Cancel
        </Button>
      )}
      {status === 'failed' && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => act('retry')}>
          <RotateCcw className="size-4" />
          Retry
        </Button>
      )}
      {error && <span className="text-sm text-red-500">{error}</span>}
    </div>
  );
}
