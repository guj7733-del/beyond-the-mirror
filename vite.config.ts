import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`      -> http://localhost:5173 (摄像头在 localhost 下可用)
// `npm run dev:lan`  -> https://<局域网IP>:5173 (手机访问需要 HTTPS，使用自签名证书)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'lan' ? [basicSsl()] : [])],
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
  build: { chunkSizeWarningLimit: 2000 },
}));
