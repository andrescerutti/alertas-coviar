// Carga de datos y evaluación de la regla en el navegador (mismo motor que usa el servidor).
import { evaluarVentanas, evaluarPronostico, agruparEpisodios, ultimoDiaCompleto } from './motor.js';

export const REF = { tminC: 10, lluviaMm: 10, hrPct: 70, hrModo: 'media' };

const cache = new Map();
async function json(ruta) {
  const res = await fetch(ruta, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${ruta}: ${res.status}`);
  return res.json();
}

export const cargarRed = () => json('data/red.json');

export function cargarDiario(id) {
  if (!cache.has(id)) cache.set(id, json(`data/diario/${id}.json`).catch((err) => { cache.delete(id); throw err; }));
  return cache.get(id);
}

// umbrales: solo las claves que difieren de REF importan, pero se puede pasar el objeto completo.
const sobreescritas = (u) => Object.fromEntries(Object.entries(u).filter(([, v]) => v !== '' && v != null));

const NIVELES = { 0: 'ninguna', 1: 'posible' };
const nivelDe = (n, total) => (n === 0 ? 'ninguna' : n >= 2 || total === 1 ? 'probable' : NIVELES[1]);

// Enriquece cada estación con: estado observado y vigilancia por pronóstico.
export function evaluarRed(red, umbrales) {
  const reglas = sobreescritas(umbrales);
  return red.estaciones.map((est) => {
    const apagada = est.salud.estado === 'apagada' || est.salud.estado === 'sin_datos';
    const referencia = est.ultimoTs ? ultimoDiaCompleto(est.ultimoTs) : null;
    const evaluacion = referencia ? evaluarVentanas(est.recientes, reglas).find((e) => e.fecha === referencia) ?? null : null;
    const clave = apagada || !evaluacion || evaluacion.estado === 'sin_datos' ? 'apagada' : evaluacion.estado === 'alerta' ? 'alerta' : evaluacion.cumplidas === 2 ? 'atencion' : 'libre';

    const porModelo = Object.fromEntries(red.modelos.map((m) => [m.id, evaluarPronostico(est.recientes, est.pronostico[m.id] ?? [], reglas)]));
    const fechas = [...new Set(Object.values(porModelo).flatMap((ev) => ev.map((e) => e.fecha)))].sort();
    const dias = fechas.map((fecha) => {
      const evs = Object.fromEntries(red.modelos.map((m) => [m.id, porModelo[m.id].find((e) => e.fecha === fecha) ?? null]));
      const validos = Object.values(evs).filter((e) => e && e.estado !== 'sin_datos');
      const n = validos.filter((e) => e.estado === 'alerta').length;
      return { fecha, porModelo: evs, n, total: validos.length, nivel: nivelDe(n, validos.length) };
    });
    const primera = dias.find((d) => d.nivel !== 'ninguna') ?? null;
    return { ...est, clave, apagada, referencia, evaluacion, vigilancia: { dias, primera } };
  });
}

export async function detalleEstacion(est, umbrales) {
  const diario = await cargarDiario(est.id);
  const evaluaciones = evaluarVentanas(diario.dias, sobreescritas(umbrales));
  return { dias: diario.dias, evaluaciones, episodios: agruparEpisodios(evaluaciones) };
}

export async function historialRed(red, umbrales) {
  const reglas = sobreescritas(umbrales);
  const diarios = await Promise.all(red.estaciones.map((e) => cargarDiario(e.id)));
  const zonas = {};
  const redDias = new Map();
  red.estaciones.forEach((est, i) => {
    for (const ev of evaluarVentanas(diarios[i].dias, reglas)) {
      if (ev.estado !== 'alerta') continue;
      (zonas[est.zona] ??= new Map()).set(ev.fecha, (zonas[est.zona].get(ev.fecha) ?? 0) + 1);
      redDias.set(ev.fecha, (redDias.get(ev.fecha) ?? new Set()).add(est.id));
    }
  });
  // Evento de red: días de alerta separados por no más de 3 días.
  const eventos = [];
  for (const fecha of [...redDias.keys()].sort()) {
    const ult = eventos.at(-1);
    const dif = ult ? (Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${ult.fin}T00:00:00Z`)) / 86_400_000 : Infinity;
    if (dif <= 3) { ult.fin = fecha; redDias.get(fecha).forEach((id) => ult.est.add(id)); }
    else eventos.push({ inicio: fecha, fin: fecha, est: new Set(redDias.get(fecha)) });
  }
  const desde = diarios.map((d) => d.dias[0]?.fecha).filter(Boolean).sort()[0];
  return { desde, zonas: Object.fromEntries(Object.entries(zonas).map(([z, m]) => [z, [...m].map(([fecha, n]) => ({ fecha, n }))])), eventos: eventos.map((e) => ({ inicio: e.inicio, fin: e.fin, estaciones: e.est.size })) };
}
