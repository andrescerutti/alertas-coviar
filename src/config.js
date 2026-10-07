import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// Carga .env sin dependencias; las variables ya definidas en el entorno tienen prioridad.
function cargarEnv() {
  try {
    for (const linea of readFileSync(join(RAIZ, '.env'), 'utf8').split('\n')) {
      const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
cargarEnv();

export const config = Object.freeze({
  pegasusUrl: process.env.PEGASUS_URL ?? 'https://www.climagro.com.ar/RESTService/api',
  usuario: process.env.PEGASUS_USUARIO ?? '',
  clave: process.env.PEGASUS_CLAVE ?? '',
  puerto: Number(process.env.PORT ?? 8010),
  actualizarCadaMin: Number(process.env.ACTUALIZAR_CADA_MIN ?? 30),
  dist: process.env.DIST_DIR ?? join(RAIZ, 'dist'),
});

// Sensores del API Pegasus que se guardan (ids → nombre de variable).
export const SENSORES = Object.freeze({ 11: 'temp', 12: 'hr', 5: 'lluvia', 16: 'bateria' });

// Se toman todos los equipos de la cuenta. "red" distingue las estaciones de COVIAR propiamente dichas
// (las 26 "COVIAR - …" más la Fac. de Ciencias Agrarias, que dan las 27 que contó COVIAR: 6 San Juan + 21 Mendoza)
// de las que están en la cuenta pero son de otro dueño (La Riojana). La pertenencia de Agrarias es una inferencia.
export const redDe = (descripcion) => (/^La Riojana/i.test(descripcion) ? 'otras' : 'coviar');

// Zona a partir del nombre del equipo; el Sur es el piloto del T1.
export function zonaDe(descripcion) {
  if (/Zona Sur/i.test(descripcion)) return 'Sur';
  if (/San Juan/i.test(descripcion)) return 'San Juan';
  if (/Zona Este|Tulumaya|Plumero|3 de Mayo/i.test(descripcion)) return 'Este';
  if (/Valle de Uco/i.test(descripcion)) return 'Valle de Uco';
  if (/Zona Centro|Agrarias/i.test(descripcion)) return 'Centro';
  if (/Riojana|Chilecito/i.test(descripcion)) return 'La Rioja';
  return 'Otra';
}

export const nombreCorto = (descripcion) =>
  descripcion
    .replace(/^COVIAR\s*-\s*/i, '')
    .replace(/\s*-\s*(Mendoza|Mza\.?|La Rioja)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

// Modelos de pronóstico (Open-Meteo). Los tres se calibran contra las estaciones y se miran en conjunto.
export const MODELOS_PRONOSTICO = Object.freeze([
  { id: 'ecmwf_ifs025', nombre: 'ECMWF' },
  { id: 'icon_seamless', nombre: 'ICON' },
  { id: 'gfs_seamless', nombre: 'GFS' },
]);
export const DIAS_PRONOSTICO = 7;
