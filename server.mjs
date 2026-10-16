import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(projectRoot, 'dist');
const port = 4173;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml'
};

if (!existsSync(resolve(distRoot, 'index.html'))) {
  console.error('Built game missing. Run npm install and npm run build in this Web folder.');
  process.exit(1);
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  const path = resolve(distRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (path !== distRoot && !path.startsWith(distRoot + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mime[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': path.endsWith('index.html') || extname(path).toLowerCase() === '.glb' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff'
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path).pipe(response);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error('Port 4173 is in use. Close the other local game server and retry.');
  else console.error(error);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Reclaim the Tide ready at http://127.0.0.1:${port}`));
