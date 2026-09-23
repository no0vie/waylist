import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { config } from './src/config';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: config.name, short_name: config.name, description: config.description,
      lang: 'ru', start_url: '/', scope: '/', display: 'standalone',
      theme_color: config.themeColor, background_color: '#f6f7f3',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      navigateFallbackDenylist: [/^\/api\//],
      // Private API responses are never stored in the shared HTTP cache.
      runtimeCaching: [],
    },
  })],
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
