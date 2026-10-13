import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // Se actualiza automáticamente cuando hay nueva versión
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      workbox: {
        // Esto le dice a Vite que guarde TODO tu código (rutas perezosas, css, assets) para uso offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,txt}'] 
      },
      manifest: {
        name: 'HCO - Herramientas de Control',
        short_name: 'HCO App',
        description: 'Sistema integral de control operativo y tracking offline',
        theme_color: '#002060', // El color azul oscuro de tu barra
        background_color: '#f8fafc',
        display: 'standalone', // ¡CLAVE! Hace que parezca una app nativa sin la barra del navegador
        orientation: 'portrait-primary', // (Opcional) Forzar vertical en móviles
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
            purpose: 'any maskable' // Importante para Android
          }
        ]
      }
    })
  ]
});
