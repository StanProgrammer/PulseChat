import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
      'react/jsx-dev-runtime': fileURLToPath(new URL('./node_modules/react/jsx-dev-runtime.js', import.meta.url)),
      'react/jsx-runtime': fileURLToPath(new URL('./node_modules/react/jsx-runtime.js', import.meta.url))
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    host: '0.0.0.0',
    port: 4173
  },
  define: {
    'process.env': {}
  }
});
