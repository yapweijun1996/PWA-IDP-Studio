import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
export const BASE = '/PWA-IDP-Studio/';
export async function buildApp(id, outDir = 'dist') {
  await new Promise((ok, fail) => {
    const p = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir], { env: { ...process.env, IDP_BUILD_ID: id }, stdio: 'inherit' });
    p.on('error', fail); p.on('exit', code => code === 0 ? ok() : fail(new Error(`vite build ${id} exited ${code}`)));
  });
}
export async function startServer(directory) {
  let root = resolve(directory);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!path.startsWith(BASE)) { res.writeHead(404).end(); return; }
      const file = resolve(root, path.slice(BASE.length) || 'index.html');
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': BASE });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  return { url: `http://127.0.0.1:${server.address().port}${BASE}`, setRoot(dir) { root = resolve(dir); }, async close() { server.closeAllConnections(); await new Promise((ok, fail) => server.close(e => e ? fail(e) : ok())); } };
}
