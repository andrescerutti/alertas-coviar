// Gráficos SVG sin dependencias: serie diaria con pronóstico, mapa esquemático y línea de tiempo.
import { s, h, fmtFecha, fmtFechaLarga, num } from './lib.js';

// fechas: observadas + pronosticadas, en orden. `obs[i]` es null en los días de pronóstico.
// `pron`: { modelo: [valor|null por fecha] }. `corte`: índice del primer día de pronóstico.
export function graficoSerie({ titulo, valor, fechas, obs, pron, tipo, ref, refTxt, min, max, formatoEje, alertaDias, vigilanciaDias, corte }) {
  const W = 760, H = 100, izq = 30, der = 8, arr = 10, aba = 16;
  const ancho = W - izq - der, alto = H - arr - aba;
  const n = fechas.length;
  const paso = ancho / n;
  const xi = (i) => izq + paso * (i + 0.5);
  const yv = (v) => arr + alto - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * alto;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': titulo });

  if (corte != null && corte < n) svg.append(s('rect', { class: 'zona-pron', x: izq + paso * corte, y: arr, width: paso * (n - corte), height: alto }), s('text', { class: 'eje', x: izq + paso * corte + 3, y: arr + 9 }, 'pronóstico'));
  fechas.forEach((f, i) => {
    if (alertaDias.has(f)) svg.append(s('rect', { class: 'banda', x: izq + paso * i, y: arr, width: paso, height: alto }));
    else if (vigilanciaDias?.has(f)) svg.append(s('rect', { class: 'banda-vig', x: izq + paso * i, y: arr, width: paso, height: alto }));
  });
  svg.append(s('text', { class: 'eje', x: izq - 4, y: arr + 8, 'text-anchor': 'end' }, formatoEje(max)), s('text', { class: 'eje', x: izq - 4, y: arr + alto, 'text-anchor': 'end' }, formatoEje(min)));
  if (ref != null) svg.append(s('line', { class: 'ref', x1: izq, x2: W - der, y1: yv(ref), y2: yv(ref) }), s('text', { class: 'ref-txt', x: W - der - 2, y: yv(ref) - 3, 'text-anchor': 'end' }, refTxt));

  if (tipo === 'barras') {
    obs.forEach((v, i) => { if (v > 0) svg.append(s('rect', { class: 'barra', x: xi(i) - paso * 0.35, width: paso * 0.7, y: yv(v), height: arr + alto - yv(v) }, s('title', {}, `${fmtFecha(fechas[i])}: ${num(v)} mm`))); });
    const modelos = Object.values(pron);
    fechas.forEach((f, i) => {
      const vs = modelos.map((m) => m[i]).filter((v) => v != null);
      if (!vs.length) return;
      const prom = vs.reduce((a, b) => a + b, 0) / vs.length;
      if (prom > 0) svg.append(s('rect', { class: 'barra-pron', x: xi(i) - paso * 0.35, width: paso * 0.7, y: yv(prom), height: arr + alto - yv(prom) }, s('title', {}, `${fmtFecha(f)}: ${num(prom)} mm (promedio de modelos)`)));
    });
  } else {
    svg.append(...trazos(obs, xi, yv).map((p) => s('polyline', { class: 'linea-d', points: p })));
    for (const [id, serie] of Object.entries(pron)) svg.append(...trazos(serie, xi, yv).map((p) => s('polyline', { class: `linea-pron m-${id}`, points: p })));
  }
  const cada = Math.ceil(n / 9);
  fechas.forEach((f, i) => { if (i % cada === 0) svg.append(s('text', { class: 'eje', x: xi(i), y: H - 3, 'text-anchor': 'middle' }, fmtFecha(f))); });
  return h('figure', { class: 'graf' }, h('figcaption', {}, titulo, h('b', {}, valor)), svg);
}

function trazos(serie, xi, yv) {
  const salida = [];
  let actual = [];
  serie.forEach((v, i) => {
    if (v == null) { if (actual.length > 1) salida.push(actual.join(' ')); actual = []; }
    else actual.push(`${xi(i).toFixed(1)},${yv(v).toFixed(1)}`);
  });
  if (actual.length > 1) salida.push(actual.join(' '));
  return salida;
}

// ---- Mapa esquemático (proyección plana: sirve para ubicarse, no para medir) ----
export function mapa(estaciones, { seleccionada, alSeleccionar, textoDe }) {
  const W = 340, H = 520, pad = 30;
  const ests = estaciones.filter((e) => e.lat != null);
  const lats = ests.map((e) => e.lat), lngs = ests.map((e) => e.lng);
  const [latMin, latMax] = [Math.min(...lats) - 0.15, Math.max(...lats) + 0.15];
  const [lngMin, lngMax] = [Math.min(...lngs) - 0.15, Math.max(...lngs) + 0.15];
  const k = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180);
  const escala = Math.min((W - 2 * pad) / ((lngMax - lngMin) * k), (H - 2 * pad) / (latMax - latMin));
  const x = (lng) => pad + (lng - lngMin) * k * escala;
  const y = (lat) => pad + (latMax - lat) * escala;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}` });
  for (let g = Math.ceil(latMin); g <= latMax; g++) svg.append(s('line', { class: 'grat', x1: 0, x2: W, y1: y(g), y2: y(g) }), s('text', { class: 'grat-txt', x: 6, y: y(g) - 3 }, `${Math.abs(g)}° S`));
  const porZona = {};
  for (const e of ests) (porZona[e.zona] ??= []).push(e);
  for (const [zona, lista] of Object.entries(porZona)) {
    const cx = lista.reduce((a, e) => a + x(e.lng), 0) / lista.length;
    svg.append(s('text', { class: 'zona-txt', x: cx, y: Math.min(...lista.map((e) => y(e.lat))) - 14, 'text-anchor': 'middle' }, zona));
  }
  for (const est of ests) {
    const vig = est.apagada ? 'ninguna' : est.vigilancia.primera?.nivel ?? 'ninguna';
    const cx = x(est.lng), cy = y(est.lat);
    if (est.zona === 'Sur') svg.append(s('circle', { class: 'aro', cx, cy, r: 12 }));
    if (vig !== 'ninguna') svg.append(s('circle', { class: `aro-vig ${vig}`, cx, cy, r: 9.5 }));
    const c = s('circle', { class: `${est.clave} ${seleccionada === est.id ? 'sel' : ''}`, cx, cy, r: 6, tabindex: 0, role: 'button', 'aria-label': textoDe(est) }, s('title', {}, textoDe(est)));
    c.addEventListener('click', () => alSeleccionar(est.id));
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alSeleccionar(est.id); } });
    svg.append(c);
  }
  return svg;
}

// ---- Línea de tiempo del retro-testeo ----
export function lineaTiempo(hist, zonas, cuenta) {
  const W = 900, izq = 100, der = 10, filaH = 38, arr = 22, H = arr + filaH * zonas.length + 6;
  const t0 = Date.parse(`${hist.desde}T00:00:00Z`);
  const t1 = Date.now();
  const xt = (iso) => izq + ((Date.parse(`${iso}T00:00:00Z`) - t0) / (t1 - t0)) * (W - izq - der);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}` });
  for (let a = Number(hist.desde.slice(0, 4)) + 1; a <= new Date().getFullYear(); a++) {
    const xx = xt(`${a}-01-01`);
    svg.append(s('line', { class: 'anio', x1: xx, x2: xx, y1: 12, y2: H - 4 }), s('text', { class: 'anio-txt', x: xx + 3, y: 10 }, a));
  }
  zonas.forEach((z, i) => {
    const y0 = arr + i * filaH;
    svg.append(s('line', { class: 'fila-linea', x1: izq, x2: W - der, y1: y0 + filaH - 4, y2: y0 + filaH - 4 }), s('text', { class: 'fila-txt', x: 0, y: y0 + filaH - 10 }, z));
    for (const d of hist.zonas[z] ?? []) {
      const alto = 6 + (d.n / cuenta[z]) * (filaH - 14);
      svg.append(s('rect', { class: 'tick', x: xt(d.fecha) - 1.5, width: 3, y: y0 + filaH - 4 - alto, height: alto }, s('title', {}, `${fmtFechaLarga(d.fecha)} · ${d.n} de ${cuenta[z]} estaciones de ${z}`)));
    }
  });
  return svg;
}
