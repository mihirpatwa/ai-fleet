// Settings (phase 13). All interactive — the client view fetches live config
// + model registry via swr and persists through the daemon proxies.
import { SettingsView } from '@/components/settings/SettingsView';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return <SettingsView />;
}
