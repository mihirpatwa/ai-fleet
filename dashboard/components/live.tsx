'use client';

// Mounted once in the shell. Every fleet event arriving on the shared stream
// triggers a throttled router.refresh(), which re-runs the server components
// (re-querying ~/.aifleet/state.db) so every card/page reflects the new state
// with no manual reload. Throttled so a burst of tool events causes at most
// one refresh per ~400ms.
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useStream } from '@/lib/useStream';

export function Live() {
  const router = useRouter();
  const pending = useRef(false);

  const onEvent = useRef(() => {
    if (pending.current) return;
    pending.current = true;
    setTimeout(() => {
      pending.current = false;
      router.refresh();
    }, 400);
  });

  useEffect(() => {
    onEvent.current = () => {
      if (pending.current) return;
      pending.current = true;
      setTimeout(() => {
        pending.current = false;
        router.refresh();
      }, 400);
    };
  }, [router]);

  useStream(() => onEvent.current());
  return null;
}
