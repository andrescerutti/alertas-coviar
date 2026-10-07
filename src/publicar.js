// Arma el sitio estático en dist/: copia la interfaz y el motor, y genera data/red.json
// con el estado de cada estación (salud, últimos días y pronóstico calibrado).
// Uso: node src/publicar.js
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, RAIZ, MODELOS_PRONOSTICO } from './config.js';
import { leerDiario, leerJson, escribirJson } from './almacen.js';
import { REGLAS_PERONOSPORA } from './motor.js';
import { evaluarSalud } from './salud.js';
import { aplicarCalibracion } from './pronostico.js';
import { ahoraLocal } from './ingesta.js';

const DIAS_RECIENTES = 16;

export function construirRed(dir, { ahora = ahoraLocal(), generado = new Date().toISOString() } = {}) {
  const meta = leerJson(dir, 'estaciones.json');
  if (!meta) throw new Error('No hay datos: correr primero la ingesta');
  const pronostico = leerJson(dir, 'pronostico.json');
  const calibracion = leerJson(dir, 'calibracion.json');

  const estaciones = meta.estaciones.map((est) => {
    const guardado = leerDiario(dir, est.id) ?? { dias: [], ultimoTs: null };
    const cal = calibracion?.estaciones?.[est.id]?.modelos ?? null;
    const pron = pronostico?.estaciones?.[est.id] ?? {};
    const calibrado = Object.fromEntries(
      MODELOS_PRONOSTICO.map(({ id }) => [id, (pron[id] ?? []).map((d) => aplicarCalibracion(d, cal?.[id] ?? null))]),
    );
    const { sensores, descripcion, ...resto } = est;
    return {
      ...resto,
      ultimoTs: guardado.ultimoTs,
      salud: evaluarSalud({ ultimoTs: guardado.ultimoTs, ahora, dias: guardado.dias }),
      recientes: guardado.dias.slice(-DIAS_RECIENTES),
      pronostico: calibrado,
      calibrado: Boolean(cal && MODELOS_PRONOSTICO.every(({ id }) => cal[id])),
      sesgo: cal ? Object.fromEntries(MODELOS_PRONOSTICO.map(({ id }) => [id, cal[id] ? { tmin: cal[id].tmin, hr: cal[id].hr } : null])) : null,
    };
  });

  return {
    generado,
    ahora,
    reglas: REGLAS_PERONOSPORA,
    modelos: MODELOS_PRONOSTICO,
    pronosticoEmitido: pronostico?.emitido ?? null,
    calibracionGenerada: calibracion?.generado ?? null,
    estaciones,
  };
}

export function publicar({ dist = config.dist, log = console.log } = {}) {
  const dir = join(dist, 'data');
  mkdirSync(dist, { recursive: true });
  cpSync(join(RAIZ, 'public'), dist, { recursive: true });
  cpSync(join(RAIZ, 'src', 'motor.js'), join(dist, 'motor.js'));
  const red = construirRed(dir);
  escribirJson(dir, 'red.json', red);
  log(`Sitio armado en ${dist} — ${red.estaciones.length} estaciones, datos al ${red.ahora}`);
  return red;
}

if (import.meta.url === `file://${process.argv[1]}`) publicar();
