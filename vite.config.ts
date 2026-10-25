import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

/**
 * Development-only CORS proxy. In production the Chrome extension service
 * worker does the same job; the web build talks directly to the API and
 * surfaces a clear message when the target server does not allow CORS.
 */
const corsProxyPlugin = () => ({
  name: 'routecraft-cors-proxy',
  configureServer(server: any) {
    server.middlewares.use('/__cors_proxy', (req: any, res: any) => {
      const requestUrl = new URL(req.url, 'http://localhost');
      const target = requestUrl.searchParams.get('url');
      if (!target) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing url parameter' }));
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            const lower = key.toLowerCase();
            if (['host', 'origin', 'referer', 'content-length', 'connection'].includes(lower)) continue;
            if (typeof value === 'string') headers[key] = value;
          }
          const init: RequestInit = { method: req.method, headers, redirect: 'follow' };
          if (chunks.length > 0) init.body = Buffer.concat(chunks);
          const response = await fetch(target, init);
          res.statusCode = response.status;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', '*');
          res.setHeader('Access-Control-Allow-Methods', '*');
          response.headers.forEach((value, key) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
              res.setHeader(key, value);
            }
          });
          const buffer = Buffer.from(await response.arrayBuffer());
          res.end(buffer);
        } catch (error: any) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ error: error?.message || 'Proxy request failed' }));
        }
      });
    });
  },
});

const copyExtensionFiles = () => ({
  name: 'routecraft-copy-extension-files',
  closeBundle() {
    const dist = resolve(import.meta.dirname, 'dist');
    copyFileSync(resolve(import.meta.dirname, 'manifest.json'), resolve(dist, 'manifest.json'));
    const icons = resolve(dist, 'icons');
    if (!existsSync(icons)) mkdirSync(icons, { recursive: true });
    for (const icon of ['icon16.png', 'icon48.png', 'icon128.png']) {
      const source = resolve(import.meta.dirname, 'public', 'icons', icon);
      if (existsSync(source)) copyFileSync(source, resolve(icons, icon));
    }
    const background = resolve(dist, 'background');
    if (!existsSync(background)) mkdirSync(background, { recursive: true });
    copyFileSync(resolve(import.meta.dirname, 'extension', 'background.js'), resolve(background, 'service-worker.js'));
    copyFileSync(resolve(import.meta.dirname, 'extension', 'omnibox.js'), resolve(background, 'omnibox.js'));
  },
});

export default defineConfig({
  plugins: [react(), corsProxyPlugin(), copyExtensionFiles()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
      },
    },
  },
});

