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
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg', 'img/logo.png'],
      // En vite.config.js dentro de VitePWA -> workbox:
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,txt,woff,woff2,wasm}'],
        // version.json: evita que la PWA congele la versión vieja.
        // ort-wasm (14 MB) y los .onnx: solo los descarga quien abre Visión IA (ver runtimeCaching)
        globIgnores: ['**/version.json', '**/ort-wasm-*.wasm'],
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
          },
          {
            // Visión IA: motor ONNX y modelos se guardan al primer uso y luego funcionan offline
            urlPattern: ({ url }) => /\/assets\/ort-wasm-.*\.wasm$/.test(url.pathname) || /\/models\/.+\.onnx$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'vision-ia-modelos',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [200] },
            },
          },
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
            src: 'img/pwa-192x192.png', // <-- Agregado img/
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'img/pwa-512x512.png', // <-- Agregado img/
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'img/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any' // Tu logo original (para navegadores, escritorios o donde no se requiera máscara forzada)
          },
          {
            src:'img/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable' // Una versión con fondo sólido y margen seguro exclusivo para Android moderno
          }
        ]
      }


    })
  ]
});
