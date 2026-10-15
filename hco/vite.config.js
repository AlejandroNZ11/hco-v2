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
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,txt,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // Hace que el Service Worker tome control inmediato sin requerir F5
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Permite que todas las rutas de React Router carguen offline
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
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
