import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    basicSsl()
  ],
  server: {
    host: true, // 로컬 네트워크(Quest 등)에서 IP로 접속 허용
    port: 5173,
    headers: {
      // WASM 및 고속 정렬 멀티스레딩(SharedArrayBuffer)에 필요한 헤더
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  preview: {
    host: true,
    port: 4173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mkkellogg/gaussian-splats-3d')) {
              return 'vendor-splats';
            }
            if (id.includes('three')) {
              return 'vendor-three';
            }
            if (id.includes('stats-gl')) {
              return 'vendor-stats';
            }
            return 'vendor-libs';
          }
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
});
