// PM2 ecosystem config for SignalForge — PRODUCTION MODE
module.exports = {
  apps: [
    {
      name: 'signalforge',
      script: 'dist/index.js',
      cwd: '/Users/noc/operations/signalforge/packages/server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      max_restarts: 10,
      min_uptime: '5000', // PM2 considers a process "stable" after 5s
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 3401
      },
      error_file: '/Users/noc/.pm2/logs/signalforge-error.log',
      out_file: '/Users/noc/.pm2/logs/signalforge-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_type: 'json'
    },
    {
      name: 'signalforge-client',
      script: 'npm',
      cwd: './packages/client',
      args: ['run', 'dev'], // Still dev mode — Vite needed for HMR
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 5180
      },
      error_file: '/Users/noc/.pm2/logs/signalforge-client-error.log',
      out_file: '/Users/noc/.pm2/logs/signalforge-client-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_type: 'json'
    }
  ]
};