import pc from 'picocolors';
import * as pm2 from '../lib/pm2.js';

export async function down(): Promise<void> {
  await pm2.stop(['aifleet-daemon', 'aifleet-dashboard']);
  console.log(pc.green('stopped aifleet-daemon and aifleet-dashboard'));
}
