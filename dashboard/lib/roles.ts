// Agent → role color. Sentence case, no emoji. Tailwind utility strings rather
// than shadcn Badge variants so each role gets its own hue in light and dark.
// Spec palette: orchestrator purple, coder teal, reviewer coral, tester amber,
// security-auditor red (phase 8), everyone else gray.

const PALETTE: Record<string, string> = {
  orchestrator: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
  coder: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  reviewer: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  tester: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'security-auditor': 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
};
const GRAY = 'bg-gray-500/15 text-gray-700 dark:text-gray-300 border-gray-500/30';

export function roleClasses(agent: string): string {
  return PALETTE[agent] ?? GRAY;
}

const STATUS: Record<string, string> = {
  queued: 'bg-gray-500/15 text-gray-700 dark:text-gray-300 border-gray-500/30',
  running: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  review: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  blocked: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  cancelled: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
};

export function statusClasses(status: string): string {
  return STATUS[status] ?? GRAY;
}
