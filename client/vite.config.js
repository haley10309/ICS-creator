import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발: 5173 → API는 server(5174)로 프록시
// 빌드: ../server/public 으로 출력되어 서버가 정적 파일로 서빙
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5174' },
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
});
