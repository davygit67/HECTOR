import { defineConfig } from 'vite';
import { projectionMedia } from './host/vite-media';
import react from '@vitejs/plugin-react';
import { projectionChat } from './host/vite-chat';

export default defineConfig({ base: './', plugins: [react(), projectionChat(), projectionMedia()], server: { port: 5173, strictPort: true } });
