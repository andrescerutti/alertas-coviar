// Portal de consulta. Todo se calcula en el navegador a partir de data/*.json.
import { $, h, poner, fmtFecha, fmtFechaLarga, fmtTs, diaSemana, num, hace, por } from './lib.js';
import { REF, cargarRed, evaluarRed, detalleEstacion, historialRed } from './datos.js';
import { graficoSerie, mapa, lineaTiempo } from './graficos.js';

const ZONAS_ORDEN = ['Sur', 'San Juan', 'Este', 'Valle de Uco', 'Centro', 'La Rioja'];
const HORAS_SITIO_VIEJO = 3;
const TEXTO_HOY = { alerta: 'ALERTA', atencion: '2 de 3', libre: null, apagada: 'apagada' };
const TEXTO_SALUD = { en_linea: 'En línea', demorada: 'Demorada', apagada: 'Apagada', sin_datos: 'Sin datos' };

const estado = { umbrales: { ...REF }, red: null, ests: [], seleccion: null };

const zonasDe = (ests) => {
  const porZona = por(ests, (e) => e.zona);
  return [...ZONAS_ORDEN.filter((z) => porZona[z]), ...Object.keys(porZona).filter((z) => !ZONAS_ORDEN.includes(z))];
};

const textoEstacion = (est) => {
  const vig = est.vigilancia.primera;
  const hoy = est.apagada ? 'apagada' : TEXTO_HOY[est.clave] ?? `${est.evaluacion?.cumplidas ?? 0} de 3`;
  return `${est.nombre}: ${hoy}${vig && !est.apagada ? ` · vigilancia ${vig.nivel} el ${fmtFecha(vig.fecha)}` : ''}`;
};

// ---------- Resumen ----------
function renderResumen() {
  const { ests, red } = estado;
  const activas = ests.filter((e) => !e.apagada);
  const enAlerta = ests.filter((e) => e.clave === 'alerta').length;
  const enVig = activas.filter((e) => e.vigilancia.primera).length;
  const apagadas = ests.filter((e) => e.salud.estado === 'apagada' || e.salud.estado === 'sin_datos').length;
  $('#cifra-alerta strong').textContent = enAlerta;
  $('#cifra-alerta').classList.toggle('hay', enAlerta > 0);
  $('#cifra-vigilancia strong').textContent = enVig;
  $('#cifra-vigilancia').classList.toggle('hay', activas.some((e) => e.vigilancia.primera?.nivel === 'probable'));
  $('#cifra-atencion strong').textContent = ests.filter((e) => e.clave === 'atencion').length;
  $('#cifra-apagadas strong').textContent = apagadas;
  $('#cifra-apagadas').classList.toggle('hay', apagadas > 0);

  const sur = activas.filter((e) => e.zona === 'Sur');
  const surAlerta = sur.filter((e) => e.clave === 'alerta').length;
  const primeraSur = sur.map((e) => e.vigilancia.primera).filter(Boolean).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  const surApagadas = ests.filter((e) => e.zona === 'Sur' && e.apagada).length;
  const hoy = surAlerta > 0 ? `${surAlerta} de ${sur.length} estaciones en alerta.` : `ninguna de las ${sur.length} estaciones cumple hoy las tres condiciones.`;
  const prox = primeraSur
    ? ` El pronóstico marca condiciones favorables desde el ${diaSemana(primeraSur.fecha)} ${fmtFecha(primeraSur.fecha)} (vigilancia ${primeraSur.nivel}).`
    : ' El pronóstico de 7 días no marca condiciones favorables.';
  poner($('#lectura-piloto'),h('b', {}, 'Zona piloto (Sur): '), hoy + prox, surApagadas ? ` ${surApagadas} estación sin reportar.` : '');

  const ultimas = ests.map((e) => e.ultimoTs).filter(Boolean).sort();
  const viejo = (Date.now() - Date.parse(red.generado)) / 3_600_000 > HORAS_SITIO_VIEJO;
  poner($('#sello'),
    'Datos al ', h('b', {}, ultimas.length ? fmtTs(ultimas.at(-1)) : '–'),
    viejo ? h('span', { class: 'aviso' }, ` · el sitio no se actualiza desde ${fmtTs(red.ahora)}`) : null,
  );
}

// ---------- Pronóstico por zona ----------
function renderPronostico() {
  const { ests, red } = estado;
  const activas = ests.filter((e) => !e.apagada);
  const fechas = [...new Set(activas.flatMap((e) => e.vigilancia.dias.map((d) => d.fecha)))].sort();
  const tabla = $('#tira-pron');
  tabla.replaceChildren(
    h('thead', {}, h('tr', {}, h('th', {}), fechas.map((f) => h('th', { scope: 'col' }, diaSemana(f), h('b', {}, fmtFecha(f)))))),
    h('tbody', {}, zonasDe(activas).map((z) => {
      const lista = activas.filter((e) => e.zona === z);
      return h('tr', {}, h('th', { scope: 'row' }, z), fechas.map((f) => {
        const dias = lista.map((e) => e.vigilancia.dias.find((d) => d.fecha === f)).filter(Boolean);
        const prob = dias.filter((d) => d.nivel === 'probable').length;
        const pos = dias.filter((d) => d.nivel === 'posible').length;
        const nivel = prob ? 'probable' : pos ? 'posible' : 'ninguna';
        return h('td', { class: nivel, title: `${z}, ${diaSemana(f)} ${fmtFecha(f)}: ${prob} con vigilancia probable y ${pos} posible, de ${lista.length} estaciones` }, prob + pos ? String(prob + pos) : '·');
      }));
    })),
  );
  const hayAlgo = activas.some((e) => e.vigilancia.primera);
  $('#pron-sub').textContent = hayAlgo
    ? 'Cantidad de estaciones de cada zona donde, según el pronóstico, se cumpliría la regla ese día (ventana de 3 días que termina ese día). Oscuro = al menos dos modelos coinciden.'
    : 'Ninguna estación tiene, en los próximos 7 días, condiciones que cumplan la regla según el pronóstico.';
  const cal = red.calibracionGenerada ? `calibrado contra las estaciones al ${fmtFechaLarga(red.calibracionGenerada)}` : 'sin calibrar';
  const sinCal = activas.filter((e) => !e.calibrado).length;
  $('#pron-nota').textContent = `Pronóstico emitido el ${red.pronosticoEmitido ? fmtTs(red.pronosticoEmitido) : '–'} · modelos ${red.modelos.map((m) => m.nombre).join(', ')} (Open-Meteo) · ${cal}${sinCal ? ` · ${sinCal} estaciones sin calibración propia` : ''}.`;
}

// ---------- Tabla y mapa ----------
function celda(cumple, texto) {
  if (cumple == null) return h('td', { class: 'num vacio' }, '–');
  return h('td', { class: `num ${cumple ? 'ok' : 'no'}` }, texto);
}

function filaEstacion(est) {
  const ev = est.evaluacion;
  const v = ev?.valores;
  const ok = !est.apagada && v;
  const vig = est.apagada ? null : est.vigilancia.primera;
  const hoy = est.apagada ? `apagada ${hace(est.salud.minutosSinDato)}` : est.clave === 'libre' ? `${ev.cumplidas} de 3` : TEXTO_HOY[est.clave];
  const fila = h('tr', { class: `est ${est.clave === 'alerta' ? 'es-alerta' : ''} ${estado.seleccion === est.id ? 'sel' : ''}`, 'data-id': est.id },
    h('td', {}, h('button', { type: 'button', 'aria-label': `Ver detalle de ${est.nombre}` }, est.nombre)),
    ok ? celda(ev.condiciones.temp, `${num(v.tmin)} °C`) : celda(null),
    ok ? celda(ev.condiciones.lluvia, `${num(v.lluvia)} mm`) : celda(null),
    ok ? celda(ev.condiciones.hr, `${num(v.hr, 0)} %`) : celda(null),
    h('td', { class: `estado ${est.clave}` }, hoy),
    h('td', { class: `pron ${vig?.nivel ?? 'ninguna'}` }, vig ? `${vig.nivel} ${diaSemana(vig.fecha)} ${fmtFecha(vig.fecha)} · ${vig.n}/${vig.total}` : est.apagada ? '–' : '—'),
  );
  fila.addEventListener('click', () => seleccionar(est.id));
  return fila;
}

function renderTabla() {
  const principal = estado.ests.filter((e) => e.red === 'coviar');
  const porZona = por(principal, (e) => e.zona);
  const filas = [];
  for (const zona of zonasDe(principal)) {
    filas.push(h('tr', { class: 'zona' }, h('th', { colspan: 6, scope: 'colgroup' }, zona, zona === 'Sur' ? h('span', { class: 'piloto' }, 'piloto T1') : null)));
    for (const est of porZona[zona]) filas.push(filaEstacion(est));
  }
  $('#tabla tbody').replaceChildren(...filas);
}

function renderMapa() {
  $('#mapa').replaceChildren(mapa(estado.ests.filter((e) => e.red === 'coviar'), { seleccionada: estado.seleccion, alSeleccionar: seleccionar, textoDe: textoEstacion }));
}

// ---------- Estado de la red ----------
function renderRed() {
  const { ests } = estado;
  const cuenta = (k) => ests.filter((e) => e.salud.estado === k).length;
  const apagadas = cuenta('apagada') + cuenta('sin_datos');
  const bajas = ests.filter((e) => e.salud.bateria.baja && e.salud.estado !== 'apagada').length;
  $('#red-sub').textContent = `${ests.length} equipos en la cuenta: ${cuenta('en_linea')} en línea, ${cuenta('demorada')} demorada${cuenta('demorada') === 1 ? '' : 's'}, ${apagadas} apagada${apagadas === 1 ? '' : 's'}${bajas ? `; ${bajas} con la batería baja` : ''}. Una estación se considera apagada si pasan más de 24 h sin lecturas.`;
  const orden = { apagada: 0, sin_datos: 0, demorada: 1, en_linea: 2 };
  const lista = [...ests].sort((a, b) => orden[a.salud.estado] - orden[b.salud.estado] || b.salud.bateria.baja - a.salud.bateria.baja || a.nombre.localeCompare(b.nombre));
  const filas = lista.map((est) => {
    const { salud } = est;
    const b = salud.bateria;
    const tr = h('tr', { class: `est ${salud.estado === 'apagada' ? 'apagada' : ''} ${est.red === 'otras' ? 'sin-red' : ''}`, 'data-id': est.id },
      h('td', {}, h('button', { type: 'button', 'aria-label': `Ver detalle de ${est.nombre}` }, est.nombre), salud.alertas.length ? h('small', { class: 'diag' }, salud.alertas.join('. ')) : null),
      h('td', { class: `salud ${salud.estado}` }, TEXTO_SALUD[salud.estado]),
      h('td', {}, est.ultimoTs ? `${fmtTs(est.ultimoTs)} · ${hace(salud.minutosSinDato)}` : 'nunca'),
      h('td', { class: 'num' }, salud.cobertura7d == null ? '–' : `${Math.round(salud.cobertura7d * 100)} %`),
      h('td', { class: `num ${b.baja ? 'bat-baja' : ''}` }, b.ultimo == null ? '–' : `${num(b.ultimo, 2)} V`, b.min7 != null && b.baja ? ` (mín ${num(b.min7, 2)})` : ''),
    );
    tr.addEventListener('click', () => seleccionar(est.id));
    return tr;
  });
  $('#tabla-red tbody').replaceChildren(...filas);
}

// ---------- Detalle ----------
function tablaPronostico(est, red) {
  const marca = (e) => {
    if (!e || e.estado === 'sin_datos') return h('td', { class: 'num vacio' }, '–');
    return h('td', { class: `num ${e.estado === 'alerta' ? 'ok' : 'no'}` }, e.estado === 'alerta' ? 'sí' : `${e.cumplidas} de 3`);
  };
  return h('table', {},
    h('caption', { class: 'solo-lectores' }, 'Cumplimiento de la regla por día y modelo'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ventana que termina el'), red.modelos.map((m) => h('th', { scope: 'col', class: 'num' }, m.nombre)), h('th', { scope: 'col' }, 'Vigilancia'))),
    h('tbody', {}, est.vigilancia.dias.map((d) => h('tr', {},
      h('td', {}, `${diaSemana(d.fecha)} ${fmtFecha(d.fecha)}`),
      red.modelos.map((m) => marca(d.porModelo[m.id])),
      h('td', { class: `pron ${d.nivel}` }, d.nivel === 'ninguna' ? '—' : `${d.nivel} · ${d.n}/${d.total}`),
    ))),
  );
}

async function renderDetalle() {
  const est = estado.ests.find((e) => e.id === estado.seleccion);
  if (!est) return;
  const { red } = estado;
  $('#detalle').hidden = false;
  $('#t-detalle').textContent = est.nombre;
  const d = await detalleEstacion(est, estado.umbrales);
  if (estado.seleccion !== est.id) return; // el usuario ya eligió otra

  const pronFechas = est.apagada ? [] : est.vigilancia.dias.map((x) => x.fecha);
  const obs = d.dias.filter((x) => x.fecha <= (est.ultimoTs?.slice(0, 10) ?? '') && (!pronFechas[0] || x.fecha < pronFechas[0])).slice(-28);
  const fechas = [...obs.map((x) => x.fecha), ...pronFechas];
  const corte = pronFechas.length ? obs.length : null;
  const evObs = new Map(d.evaluaciones.map((e) => [e.fecha, e]));
  const alertaDias = new Set(obs.filter((x) => evObs.get(x.fecha)?.estado === 'alerta').map((x) => x.fecha));
  const vigDias = new Set(est.vigilancia.dias.filter((x) => x.nivel !== 'ninguna' && !est.apagada).map((x) => x.fecha));
  const relleno = (serie) => [...serie, ...Array(pronFechas.length).fill(null)];
  const pron = (campo) => Object.fromEntries(red.modelos.map((m) => [m.id, [...Array(obs.length).fill(null), ...pronFechas.map((f) => est.pronostico[m.id]?.find((x) => x.fecha === f)?.[campo] ?? null)]]));
  const ult = obs.at(-1);
  const umbr = { ...red.reglas, ...Object.fromEntries(Object.entries(estado.umbrales).filter(([, v]) => v !== '')) };
  const campoHr = umbr.hrModo === 'media' ? 'hrMedia' : 'hrMin';
  const comun = { fechas, alertaDias, vigilanciaDias: vigDias, corte };
  const maxLluvia = Math.max(10, ...obs.map((x) => x.lluvia), ...Object.values(pron('lluvia')).flat().filter((v) => v != null));

  $('#det-sub').textContent = `${est.zona} · ${num(est.lat, 3)}, ${num(est.lng, 3)} · en la red desde ${est.fechaAlta ? fmtFechaLarga(est.fechaAlta) : '–'} · franja rosada = alerta; franja ocre = vigilancia por pronóstico`;
  const aviso = est.apagada
    ? h('p', { class: 'det-estado apagada' }, `Apagada: última lectura ${est.ultimoTs ? fmtTs(est.ultimoTs) : '—'} (${hace(est.salud.minutosSinDato)}). ${est.salud.alertas[0] ?? ''}`)
    : est.calibrado ? null : h('p', { class: 'det-estado' }, 'Esta estación no tiene aún un año de datos para calibrar el pronóstico: los modelos se muestran sin corregir y tienden a sobrestimar las mínimas.');

  poner($('#graficos'),
    aviso,
    graficoSerie({ ...comun, titulo: 'Temp. mínima', valor: ult ? `${num(ult.tmin)} °C` : '–', obs: relleno(obs.map((x) => x.tmin)), pron: pron('tmin'), tipo: 'linea', ref: umbr.tminC, refTxt: `${umbr.tminC} °C`, min: -5, max: 25, formatoEje: (v) => `${v}°` }),
    graficoSerie({ ...comun, titulo: umbr.hrModo === 'media' ? 'Humedad media' : 'Humedad mínima', valor: ult ? `${num(ult[campoHr], 0)} %` : '–', obs: relleno(obs.map((x) => x[campoHr])), pron: pron(campoHr), tipo: 'linea', ref: umbr.hrPct, refTxt: `${umbr.hrPct} %`, min: 0, max: 100, formatoEje: (v) => `${v}` }),
    graficoSerie({ ...comun, titulo: 'Lluvia diaria', valor: ult ? `${num(ult.lluvia)} mm` : '–', obs: relleno(obs.map((x) => x.lluvia)), pron: pron('lluvia'), tipo: 'barras', min: 0, max: maxLluvia, formatoEje: (v) => `${Math.round(v)}` }),
  );
  poner($('#leyenda-modelos'),
    ...red.modelos.map((m) => h('li', {}, h('i', { class: `m-${m.id}` }), m.nombre)),
    h('li', {}, 'Punteado = pronóstico calibrado (barras: promedio de modelos)'),
  );
  poner($('#tabla-pron-det'), est.apagada ? null : tablaPronostico(est, red));

  const eps = d.episodios;
  poner($('#episodios'),
    h('strong', {}, eps.length ? `${eps.length} episodio${eps.length === 1 ? '' : 's'} de alerta desde que hay datos` : 'La regla no marcó alerta en esta estación desde que hay datos'),
    eps.length ? h('ul', {}, eps.slice(-12).reverse().map((e) => h('li', {}, e.inicio === e.fin ? fmtFechaLarga(e.inicio) : `${fmtFechaLarga(e.inicio)} → ${fmtFechaLarga(e.fin)}`, ` · ${e.dias} día${e.dias === 1 ? '' : 's'}`)), eps.length > 12 ? h('li', {}, `y ${eps.length - 12} anteriores`) : null) : null,
  );
}

async function seleccionar(id) {
  estado.seleccion = id;
  renderTabla();
  renderMapa();
  try {
    await renderDetalle();
    $('#detalle').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
  }
}

// ---------- Retro-testeo (se calcula al llegar a la sección) ----------
let retroListo = false;
async function renderRetro() {
  const { red, ests } = estado;
  const sub = $('#retro-sub');
  try {
    const hist = await historialRed(red, estado.umbrales);
    const zonas = zonasDe(ests);
    const cuenta = Object.fromEntries(zonas.map((z) => [z, ests.filter((e) => e.zona === z).length]));
    $('#timeline').replaceChildren(lineaTiempo(hist, zonas, cuenta));
    const anios = (Date.now() - Date.parse(`${hist.desde}T00:00:00Z`)) / (365.25 * 86_400_000);
    const ev = hist.eventos;
    sub.textContent = `${ev.length} evento${ev.length === 1 ? '' : 's'} de alerta en la red en ${num(anios)} años (≈ ${num(ev.length / anios)} por año; COVIAR estimó 4 o 5). La altura de cada barra es la fracción de las estaciones de esa zona en alerta ese día.`;
  } catch (err) {
    console.error(err);
    sub.textContent = 'No se pudo calcular el retro-testeo.';
  }
}

function retroAlVer() {
  const obs = new IntersectionObserver((entradas) => {
    if (entradas.some((e) => e.isIntersecting)) { obs.disconnect(); retroListo = true; renderRetro(); }
  }, { rootMargin: '400px' });
  obs.observe($('.retro'));
}

// ---------- Umbrales ----------
const form = $('#form-regla');
function pintarUmbrales() {
  for (const [k, v] of Object.entries(estado.umbrales)) form.elements[k].value = v;
  const cambios = Object.entries(estado.umbrales).filter(([k, v]) => v !== REF[k]);
  $('#nota-regla').textContent = cambios.length ? 'Estás viendo umbrales distintos a los de referencia de COVIAR.' : '';
}

function pintarTodo() {
  estado.ests = evaluarRed(estado.red, estado.umbrales);
  renderResumen();
  renderPronostico();
  renderTabla();
  renderMapa();
  renderRed();
  if (estado.seleccion) renderDetalle().catch(console.error);
  if (retroListo) renderRetro();
}

let temporizador;
form.addEventListener('input', (e) => {
  const { name, value } = e.target;
  if (!(name in REF)) return;
  estado.umbrales = { ...estado.umbrales, [name]: name === 'hrModo' ? value : value === '' ? '' : Number(value) };
  pintarUmbrales();
  clearTimeout(temporizador);
  temporizador = setTimeout(pintarTodo, 250);
});
$('#reset').addEventListener('click', () => { estado.umbrales = { ...REF }; pintarUmbrales(); pintarTodo(); });

async function iniciar() {
  pintarUmbrales();
  try {
    estado.red = await cargarRed();
    pintarTodo();
    retroAlVer();
  } catch (err) {
    console.error(err);
    $('#sello').textContent = 'No se pudieron cargar los datos.';
  }
}

iniciar();
setInterval(async () => {
  if (document.visibilityState !== 'visible') return;
  try { estado.red = await cargarRed(); pintarTodo(); } catch (err) { console.error(err); }
}, 10 * 60_000);
