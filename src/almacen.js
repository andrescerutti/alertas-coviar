// Almacén de datos: un JSON por estación con su resumen diario. Es la única fuente de verdad,
// tanto en la PC como en el servidor de publicación (no hay base de datos).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const rutaDiario = (dir, id) => join(dir, 'diario', `${id}.json`);

export function leerDiario(dir, id) {
  const ruta = rutaDiario(dir, id);
  return existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null;
}

export function escribirDiario(dir, id, contenido) {
  mkdirSync(join(dir, 'diario'), { recursive: true });
  writeFileSync(rutaDiario(dir, id), JSON.stringify({ id, ...contenido }));
}

export function leerJson(dir, nombre) {
  const ruta = join(dir, nombre);
  return existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null;
}

export function escribirJson(dir, nombre, contenido) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, nombre), JSON.stringify(contenido));
}

// Une días guardados con días recién calculados; los nuevos pisan a los viejos de la misma fecha.
export function mezclarDias(existentes, nuevos) {
  const porFecha = new Map(existentes.map((d) => [d.fecha, d]));
  for (const d of nuevos) porFecha.set(d.fecha, d);
  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// filas: [{ ts: 'YYYY-MM-DD HH:mm', valor }] de la batería → { [fecha]: { min, max, ult } }
export function resumenBateria(filas) {
  const porDia = new Map();
  for (const { ts, valor } of [...filas].sort((a, b) => a.ts.localeCompare(b.ts))) {
    if (typeof valor !== 'number' || !(valor > -900)) continue;
    const f = ts.slice(0, 10);
    const d = porDia.get(f);
    porDia.set(f, d ? { min: Math.min(d.min, valor), max: Math.max(d.max, valor), ult: valor } : { min: valor, max: valor, ult: valor });
  }
  return Object.fromEntries(porDia);
}
