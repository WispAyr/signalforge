module.exports = {
  apps: [{
    name: 'signalforge-edge',
    script: 'dist/index.js',
    node_args: '--experimental-vm-modules',
    env: {
      NODE_ENV: 'production',
      SIGNALFORGE_SERVER: 'ws://192.168.195.33:3401/ws',
      NODE_NAME: require('os').hostname(),
    },
    max_memory_restart: '150M',
    restart_delay: 5000,
    max_restarts: 50,
    autorestart: true,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
