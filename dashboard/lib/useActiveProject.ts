'use client';
// Single source of truth for the header's active project: the URL ?project=
// (SSR reads it) mirrored into the useProject store. Shared by ProjectPicker
// and the header drag-drop so the apply logic lives in one place.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useProject } from '@/lib/stores/useProject';

export function useActiveProject(): { current: string; apply: (path: string) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const storeCurrent = useProject((s) => s.current);
  const setProject = useProject((s) => s.setProject);

  const current = params.get('project') ?? storeCurrent ?? '';

  const apply = (path: string): void => {
    if (!path) return;
    setProject(path);
    const sp = new URLSearchParams(params.toString());
    sp.set('project', path);
    router.push(`${pathname}?${sp.toString()}`);
  };

  return { current, apply };
}
