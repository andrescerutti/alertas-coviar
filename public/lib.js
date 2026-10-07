// Ayudas de DOM y formato. Todo texto que viene de los datos entra por textContent / nodos de texto.
const SVG = 'http://www.w3.org/2000/svg';

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

export function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...hijos.flat().filter((x) => x != null && x !== false));
  return el;
}

export function s(tag, attrs = {}, ...hijos) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...hijos.flat().filter((x) => x != null && x !== false));
  return el;
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const fmtFecha = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const fmtFechaLarga = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const fmtTs = (ts) => `${fmtFecha(ts.slice(0, 10))} ${ts.slice(11, 16)}`;
export const diaSemana = (iso) => DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
export const num = (n, d = 1) => (n == null ? '–' : n.toFixed(d).replace('.', ','));

export function hace(minutos) {
  if (minutos == null) return 'nunca';
  if (minutos < 90) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  const dias = Math.round(minutos / 1440);
  return dias < 60 ? `hace ${dias} días` : `hace ${Math.round(dias / 30)} meses`;
}

export const por = (lista, clave) => {
  const salida = {};
  for (const x of lista) (salida[clave(x)] ??= []).push(x);
  return salida;
};

// replaceChildren que ignora null / false (replaceChildren los convertiría en el texto "null").
export const poner = (el, ...hijos) => el.replaceChildren(...hijos.flat().filter((x) => x != null && x !== false));
