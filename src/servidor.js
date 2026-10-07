// Sirve el sitio estático de dist/ y lo mantiene al día. Para uso local o en un servidor propio;
// la publicación en GitHub Pages no lo necesita (ver .github/workflows/publicar.yml).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { config } from './config.js';
import { ingestar } from './ingesta.js';
import { calibrar } from './calibrar.js';
import { publicar } from './publicar.js';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const SEGURIDAD = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

export const servidor = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') { res.writeHead(405, SEGURIDAD).end(); return; }
    const { pathname } = new URL(req.url, 'http://localhost');
    const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^([/\\])+/, '');
    const abs = join(config.dist, rel);
    if (!abs.startsWith(config.dist + '/') || !TIPOS[extname(abs)]) { res.writeHead(404, SEGURIDAD).end('no encontrado'); return; }
    const cuerpo = await readFile(abs);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(abs)], 'Cache-Control': 'no-cache', ...SEGURIDAD });
    res.end(cuerpo);
  } catch (err) {
    if (err.code === 'ENOENT') { res.writeHead(404, SEGURIDAD).end('no encontrado'); return; }
    console.error(err);
    res.writeHead(500, SEGURIDAD).end('error interno');
  }
});

let actualizando = false;
async function actualizar() {
  if (actualizando) return;
  actualizando = true;
  try {
    const r = await ingestar({ log: () => {} });
    if (r.errores.length) console.error('Ingesta con errores:', r.errores.join('; '));
    await calibrar({ siVencida: true, log: () => {} });
    publicar({ log: () => {} });
  } catch (err) {
    console.error('Actualización falló:', err.message);
  } finally {
    actualizando = false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.HOST ?? '127.0.0.1';
  publicar({ log: () => {} });
  servidor.listen(config.puerto, host, () => console.log(`Portal en http://${host}:${config.puerto}`));
  if (config.actualizarCadaMin > 0) setInterval(actualizar, config.actualizarCadaMin * 60_000).unref();
}
