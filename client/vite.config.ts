import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      // The live channel (WebSocket/Socket.IO/MCP) needs the upgrade proxied.
      '/live': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
