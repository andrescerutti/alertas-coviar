// Trae las series de todas las estaciones de la cuenta y las resume por día en dist/data/diario/.
// Uso: node src/ingesta.js [--completa] [--previo URL]
//   por defecto es incremental: rebaja los últimos 7 días de cada estación (cubre datos tardíos).
//   --previo: si no hay archivo local de una estación, lo busca en un sitio ya publicado (así corre el CI).
import { join } from 'node:path';
import { config, SENSORES, redDe, zonaDe, nombreCorto } from './config.js';
import { ClientePegasus } from './pegasus.js';
import { leerDiario, escribirDiario, escribirJson, mezclarDias, resumenBateria } from './almacen.js';
import { resumenDiario, sumarDias } from './motor.js';
import { pedirPronostico } from './pronostico.js';

const DESDE_POR_DEFECTO = '2023-06-01';
const SOLAPE_DIAS = 7;
const TOPE_REBAJA_DIAS = 45; // una estación apagada hace meses no se vuelve a bajar entera cada vez
const DIAS_BATERIA = 60;
const CONCURRENCIA = 3;

export const ahoraLocal = (ms = Date.now()) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 16).replace('T', ' '); // Argentina, UTC-3

const fechaAltaIso = (s) => {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const normalizar = (fila) => ({ ts: fila.fecha.slice(0, 16), valor: fila.valor });

// La batería se baja unos 60 días; si la estación está apagada hace más que eso, se mira la semana previa al corte
// para poder diagnosticar si murió por falla de alimentación.
function desdeBateria({ arranque, hoy, ultimoTs }) {
  const ultimaFecha = ultimoTs?.slice(0, 10);
  if (ultimaFecha && ultimaFecha < sumarDias(hoy, -TOPE_REBAJA_DIAS)) return sumarDias(ultimaFecha, -10);
  return [arranque, sumarDias(hoy, -DIAS_BATERIA)].sort().at(-1);
}

async function enPool(tareas, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tareas.length) await tareas[i++](); }));
}

async function traerPrevio(url, id) {
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/data/diario/${id}.json`, { signal: AbortSignal.timeout(30_000) });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export async function ingestar({ dir = join(config.dist, 'data'), cliente = new ClientePegasus(), completa = false, previo = null, log = console.log } = {}) {
  const ahora = ahoraLocal();
  const hoy = ahora.slice(0, 10);
  const equipos = await cliente.equipos();
  const estaciones = equipos.map((e) => ({
    id: e.idEquipo,
    descripcion: e.descripcion,
    nombre: nombreCorto(e.descripcion),
    zona: zonaDe(e.descripcion),
    red: redDe(e.descripcion),
    lat: e.lat,
    lng: e.lng,
    fechaAlta: fechaAltaIso(e.fechaAlta),
    sensores: e.sensores.map((s) => s.idSensor),
  }));
  log(`Cuenta: ${estaciones.length} equipos`);

  const errores = [];
  await enPool(estaciones.map((est) => async () => {
    const guardado = completa ? null : (leerDiario(dir, est.id) ?? (await traerPrevio(previo, est.id)));
    const dias = guardado?.dias ?? [];
    const ultimaFecha = dias.at(-1)?.fecha;
    const piso = [DESDE_POR_DEFECTO, est.fechaAlta].filter(Boolean).sort().at(-1);
    const arranque = ultimaFecha ? [sumarDias(ultimaFecha, -SOLAPE_DIAS), sumarDias(hoy, -TOPE_REBAJA_DIAS)].sort().at(-1) : piso;
    const filas = [];
    let bateria = {};
    let ultimoTs = guardado?.ultimoTs ?? null;
    for (const [idSensor, variable] of Object.entries(SENSORES)) {
      if (!est.sensores.includes(Number(idSensor))) continue;
      try {
        const desde = variable === 'bateria' ? desdeBateria({ arranque, hoy, ultimoTs }) : arranque;
        const serie = (await cliente.historico(est.id, Number(idSensor), desde, hoy)).map(normalizar);
        if (variable === 'bateria') bateria = resumenBateria(serie);
        else {
          filas.push(...serie.filter((f) => f.valor > -900).map((f) => ({ ...f, variable })));
          if (variable === 'temp' && serie.length) ultimoTs = [ultimoTs, serie.at(-1).ts].filter(Boolean).sort().at(-1);
        }
      } catch (err) {
        errores.push(`${est.nombre}/${variable}: ${err.message}`);
      }
    }
    const nuevos = resumenDiario(filas).map((d) => (bateria[d.fecha] ? { ...d, bat: bateria[d.fecha] } : d));
    // La batería puede tener datos de días que no tienen temperatura (equipo a medio apagar): se conservan.
    const soloBateria = Object.entries(bateria).filter(([f]) => !nuevos.some((d) => d.fecha === f)).map(([fecha, bat]) => ({ fecha, tmin: null, hrMedia: null, hrMin: null, lluvia: 0, nTemp: 0, nHr: 0, nLluvia: 0, bat }));
    escribirDiario(dir, est.id, { ultimoTs, dias: mezclarDias(dias, [...nuevos, ...soloBateria]) });
    log(`  ${est.nombre.padEnd(42)} ${String(filas.length).padStart(7)} lecturas desde ${arranque}  último: ${ultimoTs ?? '—'}`);
  }), CONCURRENCIA);

  let pronosticoError = null;
  try {
    escribirJson(dir, 'pronostico.json', { emitido: ahora, estaciones: await pedirPronostico(estaciones) });
  } catch (err) {
    pronosticoError = err.message; // si falla, queda el pronóstico anterior y se avisa en el sitio
    errores.push(`pronóstico: ${err.message}`);
  }

  escribirJson(dir, 'estaciones.json', { actualizado: ahora, estaciones });
  return { estaciones, errores, pronosticoError, ahora };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const previo = process.argv.includes('--previo') ? process.argv[process.argv.indexOf('--previo') + 1] : null;
  const t0 = Date.now();
  const r = await ingestar({ completa: process.argv.includes('--completa'), previo });
  console.log(`Listo en ${((Date.now() - t0) / 1000).toFixed(0)} s — ${r.estaciones.length} estaciones, ${r.errores.length} errores`);
  if (r.errores.length) console.log(`  ${r.errores.join('\n  ')}`);
  process.exit(r.errores.length ? 1 : 0);
}
