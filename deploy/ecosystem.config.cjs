// pm2-runtime process map for the container. Both processes inherit the
// container env (AIFLEET_HOME=/data etc.) so state lives on the /data volume
// and survives `docker compose restart`.
module.exports = {
  apps: [
    {
      name: 'aifleet-daemon',
      script: 'daemon/dist/cli/run.js',
      cwd: '/app',
      interpreter: 'node',
      args: ['--port', '7878'],
      env: { AIFLEET_HOME: '/data', AIFLEET_DB_PATH: '/data/state.db' },
      kill_timeout: 10000,
    },
    {
      name: 'aifleet-dashboard',
      script: 'dashboard/node_modules/next/dist/bin/next',
      cwd: '/app/dashboard',
      interpreter: 'node',
      args: ['start', '-p', '3737', '-H', '0.0.0.0'],
      env: { AIFLEET_DB_PATH: '/data/state.db', AIFLEET_DAEMON_URL: 'http://localhost:7878' },
    },
  ],
};
