// Calcula el sesgo de cada modelo de pronóstico en cada estación, sobre el último año.
// Uso: node src/calibrar.js [--si-vencida] [--previo URL]
//   --si-vencida: solo corre si la calibración tiene más de 35 días.
//   --previo: si no hay calibración local, mira la del sitio ya publicado (así corre el CI).
import { join } from 'node:path';
import { config } from './config.js';
import { leerDiario, leerJson, escribirJson } from './almacen.js';
import { sumarDias } from './motor.js';
import { calibrarEstacion } from './pronostico.js';
import { ahoraLocal } from './ingesta.js';

const VIGENCIA_DIAS = 35;
const MIN_DIAS = 60; // con menos días observados el sesgo no es confiable: esa estación queda sin calibrar

async function traerPrevia(url) {
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/data/calibracion.json`, { signal: AbortSignal.timeout(30_000) });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export async function calibrar({ dir = join(config.dist, 'data'), siVencida = false, previo = null, log = console.log } = {}) {
  const hoy = ahoraLocal().slice(0, 10);
  const previa = leerJson(dir, 'calibracion.json') ?? (siVencida ? await traerPrevia(previo) : null);
  if (siVencida && previa && previa.generado >= sumarDias(hoy, -VIGENCIA_DIAS)) {
    log(`Calibración vigente (${previa.generado}); no se recalcula`);
    escribirJson(dir, 'calibracion.json', previa);
    return previa;
  }
  const { estaciones } = leerJson(dir, 'estaciones.json');
  const desde = sumarDias(hoy, -365);
  const hasta = sumarDias(hoy, -2);
  const salida = {};
  for (const est of estaciones) {
    const dias = leerDiario(dir, est.id)?.dias ?? [];
    const validos = dias.filter((d) => d.nTemp >= 72 && d.nHr >= 72 && d.fecha >= desde && d.fecha <= hasta);
    if (validos.length < MIN_DIAS) { log(`  ${est.nombre}: ${validos.length} días, sin calibrar`); continue; }
    try {
      salida[est.id] = { dias: validos.length, modelos: await calibrarEstacion(est, dias, { desde, hasta }) };
      log(`  ${est.nombre}: ${validos.length} días`);
    } catch (err) {
      log(`  ${est.nombre}: ${err.message}`);
    }
  }
  const resultado = { generado: hoy, desde, hasta, estaciones: salida };
  escribirJson(dir, 'calibracion.json', resultado);
  return resultado;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const previo = process.argv.includes('--previo') ? process.argv[process.argv.indexOf('--previo') + 1] : null;
  await calibrar({ siVencida: process.argv.includes('--si-vencida'), previo });
}
