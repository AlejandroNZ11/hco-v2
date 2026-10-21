import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    // Unifica todo el CSS en un solo archivo inicial.
    // Elimina de raíz el error "Unable to preload CSS" al navegar sin internet.
    cssCodeSplit: false,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      // En vite.config.js dentro de VitePWA -> workbox:
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,txt,woff,woff2}'],
        globIgnores: ['**/version.json'], // <-- Evita que la PWA congele la versión vieja
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /\/version\.json$/],
        runtimeCaching: [
          {
            urlPattern: /\/version\.json/,
            handler: 'NetworkOnly', // <-- Obliga a consultar siempre al servidor
          }
        ]
      },
      manifest: {
        name: 'HCO - Herramientas de Control',
        short_name: 'HCO App',
        description: 'Sistema integral de control operativo y tracking offline',
        theme_color: '#002060',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
});
