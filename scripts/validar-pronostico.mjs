// Valida los modelos de pronóstico contra lo que midieron las estaciones, antes y después de calibrar.
// Usa la Previous Runs API de Open-Meteo: el pronóstico que existía N días antes de cada fecha.
// Uso: node scripts/validar-pronostico.mjs [idEstacion,...]   (cachea las respuestas en data/cache-val/)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { evaluarVentanas } from '../src/motor.js';

const MODELOS = ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'];
const PLAZOS = [1, 2, 3, 5, 7];
const PLAZOS_CALIBRACION = [1, 2, 3, 5];
const DESDE = '2025-10-05', HASTA = '2026-10-03';
const MUESTRA = process.argv[2]?.split(',').map(Number) ?? [1673, 1677, 1678, 1643, 1645, 1664, 1648, 1640, 1526, 1381];
const estaciones = JSON.parse(readFileSync('dist/data/estaciones.json', 'utf8')).estaciones;
const diario = (id) => JSON.parse(readFileSync(`dist/data/diario/${id}.json`, 'utf8')).dias;
mkdirSync('data/cache-val', { recursive: true });

async function pedir(est) {
  const ruta = `data/cache-val/${est.id}.json`;
  if (existsSync(ruta)) return JSON.parse(readFileSync(ruta, 'utf8'));
  const vars = ['temperature_2m', 'relative_humidity_2m', 'precipitation'];
  const hourly = vars.flatMap((v) => PLAZOS.map((k) => `${v}_previous_day${k}`)).join(',');
  const url = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${est.lat}&longitude=${est.lng}&hourly=${hourly}&models=${MODELOS.join(',')}&start_date=${DESDE}&end_date=${HASTA}&timezone=America%2FArgentina%2FMendoza`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (r.ok) { const j = await r.json(); writeFileSync(ruta, JSON.stringify(j)); return j; }
    await new Promise((ok) => setTimeout(ok, 3000 * (i + 1)));
  }
  throw new Error(`Open-Meteo falló para ${est.id}`);
}

function diarioDe(h, m, k) {
  const dias = {};
  h.time.forEach((t, i) => {
    const d = (dias[t.slice(0, 10)] ??= { t: [], h: [], p: [] });
    d.t.push(h[`temperature_2m_previous_day${k}_${m}`]?.[i]);
    d.h.push(h[`relative_humidity_2m_previous_day${k}_${m}`]?.[i]);
    d.p.push(h[`precipitation_previous_day${k}_${m}`]?.[i]);
  });
  return Object.fromEntries(Object.entries(dias).filter(([, d]) => d.t.length === 24 && [d.t, d.h, d.p].every((a) => a.every((x) => typeof x === 'number'))).map(([f, d]) => [f, {
    fecha: f, tmin: Math.min(...d.t), hrMedia: d.h.reduce((a, b) => a + b, 0) / 24, hrMin: Math.min(...d.h), lluvia: d.p.reduce((a, b) => a + b, 0), nTemp: 96, nHr: 96, nLluvia: 96,
  }]));
}

const aplicar = (p, c) => ({ ...p, tmin: p.tmin - c.tmin, hrMedia: Math.min(100, Math.max(0, p.hrMedia - c.hr)), hrMin: Math.min(100, Math.max(0, p.hrMin - c.hr)) });

// Fase 1: bajar y armar series diarias por estación / modelo / plazo
const base = [];
for (const id of MUESTRA) {
  const est = estaciones.find((e) => e.id === id);
  const obs = diario(id).filter((d) => d.nTemp >= 72 && d.nHr >= 72 && d.nLluvia >= 72 && d.fecha >= DESDE && d.fecha <= HASTA);
  const h = (await pedir(est)).hourly;
  const pron = Object.fromEntries(MODELOS.map((m) => [m, Object.fromEntries(PLAZOS.map((k) => [k, diarioDe(h, m, k)]))]));
  base.push({ est, obs, pron });
  console.error(`ok ${est.nombre}`);
}

// Fase 2: sesgo por estación y modelo (promedio de plazos 1–5), solo Tmín y HR
const sesgoDe = (obs, pronPlazos) => {
  let eT = 0, eH = 0, n = 0;
  for (const k of PLAZOS_CALIBRACION) for (const d of obs) { const p = pronPlazos[k][d.fecha]; if (p) { eT += p.tmin - d.tmin; eH += p.hrMedia - d.hrMedia; n += 1; } }
  return { tmin: eT / n, hr: eH / n };
};

const nuevo = () => ({ n: 0, aT: 0, aH: 0, aL: 0, eT: 0, eH: 0, tp: 0, fn: 0, fp: 0, tn: 0 });
function evaluar(corregir, consenso = false) {
  const res = {};
  for (const { obs, pron } of base) {
    const evObs = new Map(evaluarVentanas(obs).map((e) => [e.fecha, e]));
    const cal = Object.fromEntries(MODELOS.map((m) => [m, corregir ? sesgoDe(obs, pron[m]) : { tmin: 0, hr: 0 }]));
    const evs = {};
    for (const m of MODELOS) for (const k of PLAZOS) {
      const dias = Object.values(pron[m][k]).map((p) => aplicar(p, cal[m])).sort((a, b) => a.fecha.localeCompare(b.fecha));
      evs[`${m}|${k}`] = new Map(evaluarVentanas(dias).map((e) => [e.fecha, e]));
      const a = ((res[m] ??= {})[k] ??= nuevo());
      for (const d of obs) {
        const p = pron[m][k][d.fecha]; if (!p) continue;
        const q = aplicar(p, cal[m]);
        a.n += 1; a.aT += Math.abs(q.tmin - d.tmin); a.aH += Math.abs(q.hrMedia - d.hrMedia); a.aL += Math.abs(q.lluvia - d.lluvia); a.eT += q.tmin - d.tmin; a.eH += q.hrMedia - d.hrMedia;
      }
      for (const [f, eo] of evObs) {
        const ep = evs[`${m}|${k}`].get(f);
        if (eo.estado === 'sin_datos' || !ep || ep.estado === 'sin_datos') continue;
        const o = eo.estado === 'alerta', p = ep.estado === 'alerta';
        a[o && p ? 'tp' : o ? 'fn' : p ? 'fp' : 'tn'] += 1;
      }
    }
    if (consenso) for (const k of PLAZOS) {
      const a = ((res.consenso ??= {})[k] ??= nuevo());
      for (const [f, eo] of evObs) {
        const e1 = evs[`ecmwf_ifs025|${k}`].get(f), e2 = evs[`icon_seamless|${k}`].get(f);
        if (eo.estado === 'sin_datos' || !e1 || e1.estado === 'sin_datos') continue;
        const o = eo.estado === 'alerta';
        const p = e1.estado === 'alerta' && (!e2 || e2.estado === 'sin_datos' ? false : e2.estado === 'alerta');
        a[o && p ? 'tp' : o ? 'fn' : p ? 'fp' : 'tn'] += 1;
      }
    }
  }
  return res;
}

const f = (x, n = 1) => (Number.isFinite(x) ? x.toFixed(n).replace('.', ',') : '–').padStart(6);
function imprimir(titulo, res) {
  console.log(`\n${titulo}`);
  console.log('modelo         plazo |  Tmín EAM  sesgo |  HR EAM  sesgo | lluvia EAM | alertas: aciertos perdidas falsas');
  for (const [m, porK] of Object.entries(res)) for (const [k, a] of Object.entries(porK)) {
    if (!a.n && !(a.tp + a.fn + a.fp)) continue;
    console.log(`${m.padEnd(14)} ${String(k).padStart(2)} d  | ${f(a.aT / a.n)} ${f(a.eT / a.n)}  | ${f(a.aH / a.n)} ${f(a.eH / a.n)}  | ${f(a.aL / a.n, 2)}     |   ${String(a.tp).padStart(6)} ${String(a.fn).padStart(8)} ${String(a.fp).padStart(6)}`);
  }
}
console.log(`Estaciones: ${MUESTRA.length} · ${DESDE} → ${HASTA} · ${base.reduce((a, b) => a + b.obs.length, 0)} días-estación observados`);
imprimir('SIN calibrar', evaluar(false));
imprimir('CON calibración (sesgo de Tmín y HR por estación y modelo)', evaluar(true, true));
