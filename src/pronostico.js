// Pronóstico (Open-Meteo, sin clave) y su calibración contra lo que miden las estaciones.
import { MODELOS_PRONOSTICO, DIAS_PRONOSTICO } from './config.js';

const TZ = 'America/Argentina/Mendoza';
const LECTURAS_HORARIAS = 24;
const PLAZOS_CALIBRACION = [1, 3];

const esNumero = (x) => typeof x === 'number' && Number.isFinite(x);
const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// hourly → resúmenes diarios con la misma forma que motor.resumenDiario. Solo días con las 24 horas.
// `clave(variable)` devuelve el nombre de la serie en el JSON de Open-Meteo.
export function diarioDeHorario(hourly, clave) {
  const dias = new Map();
  hourly.time.forEach((t, i) => {
    const d = dias.get(t.slice(0, 10)) ?? { t: [], h: [], p: [] };
    d.t.push(hourly[clave('temperature_2m')]?.[i]);
    d.h.push(hourly[clave('relative_humidity_2m')]?.[i]);
    d.p.push(hourly[clave('precipitation')]?.[i]);
    dias.set(t.slice(0, 10), d);
  });
  return [...dias.entries()]
    .filter(([, d]) => [d.t, d.h, d.p].every((a) => a.length === LECTURAS_HORARIAS && a.every(esNumero)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, d]) => ({
      fecha,
      tmin: Math.min(...d.t),
      hrMedia: redondear(d.h.reduce((a, b) => a + b, 0) / LECTURAS_HORARIAS),
      hrMin: Math.min(...d.h),
      lluvia: redondear(d.p.reduce((a, b) => a + b, 0)),
      nTemp: LECTURAS_HORARIAS,
      nHr: LECTURAS_HORARIAS,
      nLluvia: LECTURAS_HORARIAS,
    }));
}

// Resta el sesgo medido a la temperatura mínima y a la humedad del día pronosticado.
export function aplicarCalibracion(dia, calibracion) {
  if (!calibracion) return dia;
  const hr = (v) => redondear(Math.min(100, Math.max(0, v - calibracion.hr)), 1);
  return { ...dia, tmin: redondear(dia.tmin - calibracion.tmin, 1), hrMedia: hr(dia.hrMedia), hrMin: hr(dia.hrMin) };
}

async function pedirJson(url, intentos = 4) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (res.ok) return res.json();
    ultimo = new Error(`Open-Meteo: HTTP ${res.status}`);
    await new Promise((ok) => setTimeout(ok, 5_000 * (i + 1)));
  }
  throw ultimo;
}

// Pronóstico de los próximos días para varias estaciones. → { [idEstacion]: { [modelo]: [diario...] } }
export async function pedirPronostico(estaciones) {
  const salida = {};
  for (let i = 0; i < estaciones.length; i += 10) {
    const lote = estaciones.slice(i, i + 10);
    const q = new URLSearchParams({
      latitude: lote.map((e) => e.lat).join(','),
      longitude: lote.map((e) => e.lng).join(','),
      hourly: 'temperature_2m,relative_humidity_2m,precipitation',
      models: MODELOS_PRONOSTICO.map((m) => m.id).join(','),
      forecast_days: String(DIAS_PRONOSTICO + 1),
      timezone: TZ,
    });
    const crudo = await pedirJson(`https://api.open-meteo.com/v1/forecast?${q}`);
    const respuestas = Array.isArray(crudo) ? crudo : [crudo];
    lote.forEach((est, j) => {
      salida[est.id] = Object.fromEntries(
        MODELOS_PRONOSTICO.map(({ id }) => [id, diarioDeHorario(respuestas[j].hourly, (v) => `${v}_${id}`).slice(0, DIAS_PRONOSTICO)]),
      );
    });
  }
  return salida;
}

// Sesgo (pronóstico − medido) de Tmín y HR media, promediado sobre los plazos y días en común.
export function calcularSesgo(observados, pronosticosPorPlazo) {
  let eT = 0;
  let eH = 0;
  let n = 0;
  for (const dias of Object.values(pronosticosPorPlazo)) {
    const porFecha = new Map(dias.map((d) => [d.fecha, d]));
    for (const o of observados) {
      const p = porFecha.get(o.fecha);
      if (!p) continue;
      eT += p.tmin - o.tmin;
      eH += p.hrMedia - o.hrMedia;
      n += 1;
    }
  }
  return n ? { tmin: redondear(eT / n), hr: redondear(eH / n), n } : null;
}

// Baja un año de pronósticos archivados (Previous Runs API) y calcula el sesgo de cada modelo en la estación.
export async function calibrarEstacion(est, observados, { desde, hasta }) {
  const hourly = ['temperature_2m', 'relative_humidity_2m', 'precipitation'].flatMap((v) => PLAZOS_CALIBRACION.map((k) => `${v}_previous_day${k}`)).join(',');
  const q = new URLSearchParams({
    latitude: est.lat,
    longitude: est.lng,
    hourly,
    models: MODELOS_PRONOSTICO.map((m) => m.id).join(','),
    start_date: desde,
    end_date: hasta,
    timezone: TZ,
  });
  const crudo = await pedirJson(`https://previous-runs-api.open-meteo.com/v1/forecast?${q}`);
  const validos = observados.filter((d) => d.nTemp >= 72 && d.nHr >= 72 && d.fecha >= desde && d.fecha <= hasta);
  return Object.fromEntries(
    MODELOS_PRONOSTICO.map(({ id }) => [
      id,
      calcularSesgo(validos, Object.fromEntries(PLAZOS_CALIBRACION.map((k) => [k, diarioDeHorario(crudo.hourly, (v) => `${v}_previous_day${k}_${id}`)]))),
    ]),
  );
}
