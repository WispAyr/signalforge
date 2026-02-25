import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    host: '0.0.0.0',
    allowedHosts: ['signalforge.skynet', '.skynet'],
    proxy: {
      '/api': {
        target: 'http://localhost:3401',
        changeOrigin: true,
      },
      '/recordings': {
        target: 'http://localhost:3401',
        changeOrigin: true,
      },
      '/ws/signal': {
        target: 'http://localhost:3401',
        ws: true,
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:3401',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
