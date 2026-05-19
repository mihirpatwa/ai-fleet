'use client';
// Which notification types the user wants surfaced. The actual toast delivery
// (Antd notification API on these SSE/alert events) is phase 12b; this store +
// the Settings checkboxes are wired now so 12b only reads it.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const NOTIFICATION_TYPES = [
  { key: 'goal_completed', label: 'Goal completed' },
  { key: 'goal_failed', label: 'Goal failed' },
  { key: 'security_blocking_finding', label: 'Security blocking finding' },
  { key: 'cost_cap_warning_80', label: 'Cost cap ~80% warning' },
  { key: 'model_deprecated', label: 'Model deprecated' },
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]['key'];

interface SettingsState {
  notify: Record<NotificationType, boolean>;
  setNotify: (type: NotificationType, on: boolean) => void;
}

const DEFAULT_NOTIFY = Object.fromEntries(
  NOTIFICATION_TYPES.map((n) => [n.key, true]),
) as Record<NotificationType, boolean>;

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      notify: DEFAULT_NOTIFY,
      setNotify: (type, on) => set({ notify: { ...get().notify, [type]: on } }),
    }),
    {
      name: 'aifleet-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
