import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

const THREE_JSM = ['geometries/RoundedBoxGeometry.js', 'utils/BufferGeometryUtils.js', 'postprocessing/EffectComposer.js', 'postprocessing/GTAOPass.js', 'postprocessing/OutputPass.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js', 'postprocessing/UnrealBloomPass.js'];

/** dev サーバーは圧縮しない（three はソースマップ込みで 6MB）。スマホ回線で開けるよう、まとめて返す応答だけ gzip する */
const devGzip: Plugin = {
  name: 'dev-gzip',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!/\bgzip\b/.test(String(req.headers['accept-encoding']))) return next();
      const end = res.end.bind(res) as (...a: unknown[]) => typeof res;
      res.end = ((chunk?: unknown, ...rest: unknown[]) => {
        const body = typeof chunk === 'string' || chunk instanceof Uint8Array ? chunk : null;
        if (body && body.length > 1024 && !res.headersSent && /javascript|css|html|json/.test(String(res.getHeader('content-type')))) {
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.removeHeader('Content-Length');
          return end(gzipSync(body, { level: 1 }), ...rest);
        }
        return end(chunk, ...rest);
      }) as typeof res.end;
      next();
    });
  },
};

export default defineConfig({
  plugins: [devGzip],
  // dev: 依存を最初から事前バンドルし（途中の依存発見で再読み込みしない）、主要モジュールを温めておく
  optimizeDeps: { include: ['three', ...THREE_JSM.map((f) => `three/examples/jsm/${f}`)] },
  // trycloudflare 等のトンネル経由でも開けるようにホスト制限を外す
  preview: { allowedHosts: ['.trycloudflare.com'] },
  server: { allowedHosts: ['.trycloudflare.com'], warmup: { clientFiles: ['./src/main.ts', './src/render/post.ts', './src/render/thumbs.ts', './src/ui/audio.ts', './src/simWorker.ts'] } },
  build: {
    rolldownOptions: {
      output: {
        // three 本体は別チャンクにしてキャッシュを効かせる（examples はそれを使うチャンク側に残し、ポストプロセスの遅延読み込みを保つ）
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ }] },
      },
    },
  },
});
