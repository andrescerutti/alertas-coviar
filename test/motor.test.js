import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGLAS_PERONOSPORA,
  resumenDiario,
  evaluarVentanas,
  agruparEpisodios,
  ultimoDiaCompleto,
} from '../src/motor.js';

// Genera 96 lecturas (cada 15 min) de un día para una variable.
function dia(fecha, variable, valorPorLectura) {
  const filas = [];
  for (let i = 0; i < 96; i++) {
    const hh = String(Math.floor(i / 4)).padStart(2, '0');
    const mm = String((i % 4) * 15).padStart(2, '0');
    const valor = typeof valorPorLectura === 'function' ? valorPorLectura(i) : valorPorLectura;
    filas.push({ ts: `${fecha} ${hh}:${mm}`, variable, valor });
  }
  return filas;
}

// Día "de riesgo": mínima 12, HR media 80, lluvia total `mm`.
function diaRiesgo(fecha, mm = 4) {
  return [
    ...dia(fecha, 'temp', (i) => (i === 20 ? 12 : 18)),
    ...dia(fecha, 'hr', 80),
    ...dia(fecha, 'lluvia', (i) => (i === 40 ? mm : 0)),
  ];
}

test('resumenDiario calcula mínima, HR media y lluvia acumulada por día', () => {
  const filas = [
    ...dia('2026-10-01', 'temp', (i) => (i === 0 ? 7.5 : 15)),
    ...dia('2026-10-01', 'hr', (i) => (i < 48 ? 60 : 80)),
    ...dia('2026-10-01', 'lluvia', (i) => (i < 4 ? 0.25 : 0)),
  ];
  const [d] = resumenDiario(filas);
  assert.equal(d.fecha, '2026-10-01');
  assert.equal(d.tmin, 7.5);
  assert.equal(d.hrMedia, 70);
  assert.equal(d.hrMin, 60);
  assert.equal(d.lluvia, 1);
});

test('resumenDiario descarta el valor centinela -999.9', () => {
  const filas = [...dia('2026-10-01', 'temp', (i) => (i === 3 ? -999.9 : 14)), ...dia('2026-10-01', 'hr', 70), ...dia('2026-10-01', 'lluvia', 0)];
  const [d] = resumenDiario(filas);
  assert.equal(d.tmin, 14);
});

test('resumenDiario no hace aritmética sobre filas sin valor', () => {
  const filas = [{ ts: '2026-10-01 00:00', variable: 'temp', valor: null }, ...dia('2026-10-01', 'hr', 70)];
  const [d] = resumenDiario(filas);
  assert.equal(d.tmin, null);
  assert.equal(d.nTemp, 0);
});

test('tres días que cumplen las tres condiciones disparan alerta', () => {
  const filas = ['2026-10-01', '2026-10-02', '2026-10-03'].flatMap((f) => diaRiesgo(f, 4));
  const ev = evaluarVentanas(resumenDiario(filas));
  const ultima = ev.at(-1);
  assert.equal(ultima.fecha, '2026-10-03');
  assert.equal(ultima.estado, 'alerta');
  assert.equal(ultima.cumplidas, 3);
  assert.equal(ultima.valores.lluvia, 12);
});

test('9,75 mm en tres días no alcanza el umbral de lluvia', () => {
  const filas = [diaRiesgo('2026-10-01', 3.25), diaRiesgo('2026-10-02', 3.25), diaRiesgo('2026-10-03', 3.25)].flat();
  const ultima = evaluarVentanas(resumenDiario(filas)).at(-1);
  assert.equal(ultima.estado, 'sin_riesgo');
  assert.deepEqual(ultima.condiciones, { temp: true, lluvia: false, hr: true });
  assert.equal(ultima.cumplidas, 2);
});

test('la mínima exige cumplirse los tres días, no en promedio', () => {
  const frio = [...dia('2026-10-02', 'temp', (i) => (i === 20 ? 9.9 : 18)), ...dia('2026-10-02', 'hr', 80), ...dia('2026-10-02', 'lluvia', (i) => (i === 40 ? 4 : 0))];
  const filas = [...diaRiesgo('2026-10-01'), ...frio, ...diaRiesgo('2026-10-03')];
  const ultima = evaluarVentanas(resumenDiario(filas)).at(-1);
  assert.equal(ultima.condiciones.temp, false);
  assert.equal(ultima.estado, 'sin_riesgo');
});

test('el umbral es "al menos": 10 °C justos cumplen', () => {
  const justo = (f) => [...dia(f, 'temp', (i) => (i === 5 ? 10 : 16)), ...dia(f, 'hr', 70), ...dia(f, 'lluvia', (i) => (i === 40 ? 3.5 : 0))];
  const filas = ['2026-10-01', '2026-10-02', '2026-10-03'].flatMap(justo);
  assert.equal(evaluarVentanas(resumenDiario(filas)).at(-1).estado, 'alerta');
});

test('un día con cobertura insuficiente deja la ventana sin datos, nunca en alerta', () => {
  const incompleto = [...dia('2026-10-02', 'temp', 18).slice(0, 20), ...dia('2026-10-02', 'hr', 80), ...dia('2026-10-02', 'lluvia', 0)];
  const filas = [...diaRiesgo('2026-10-01'), ...incompleto, ...diaRiesgo('2026-10-03')];
  const ultima = evaluarVentanas(resumenDiario(filas)).at(-1);
  assert.equal(ultima.estado, 'sin_datos');
});

test('un día ausente entre medio también deja la ventana sin datos', () => {
  const filas = [...diaRiesgo('2026-10-01'), ...diaRiesgo('2026-10-03'), ...diaRiesgo('2026-10-04')];
  const ev = evaluarVentanas(resumenDiario(filas));
  assert.equal(ev.find((e) => e.fecha === '2026-10-03').estado, 'sin_datos');
  assert.equal(ev.find((e) => e.fecha === '2026-10-04').estado, 'sin_datos');
});

test('los umbrales se pueden sobreescribir sin tocar los de referencia', () => {
  const filas = ['2026-10-01', '2026-10-02', '2026-10-03'].flatMap((f) => diaRiesgo(f, 4));
  const exigente = evaluarVentanas(resumenDiario(filas), { lluviaMm: 15 }).at(-1);
  assert.equal(exigente.estado, 'sin_riesgo');
  assert.equal(REGLAS_PERONOSPORA.lluviaMm, 10);
});

test('hrModo "minima" es más estricto que "media"', () => {
  const hrVariable = (f) => [...dia(f, 'temp', 15), ...dia(f, 'hr', (i) => (i < 8 ? 50 : 82)), ...dia(f, 'lluvia', (i) => (i === 40 ? 4 : 0))];
  const filas = ['2026-10-01', '2026-10-02', '2026-10-03'].flatMap(hrVariable);
  const res = resumenDiario(filas);
  assert.equal(evaluarVentanas(res, { hrModo: 'media' }).at(-1).estado, 'alerta');
  assert.equal(evaluarVentanas(res, { hrModo: 'minima' }).at(-1).estado, 'sin_riesgo');
});

test('agruparEpisodios une días de alerta consecutivos', () => {
  const ev = [
    { fecha: '2026-10-01', estado: 'sin_riesgo' },
    { fecha: '2026-10-02', estado: 'alerta' },
    { fecha: '2026-10-03', estado: 'alerta' },
    { fecha: '2026-10-04', estado: 'sin_riesgo' },
    { fecha: '2026-10-05', estado: 'alerta' },
  ];
  assert.deepEqual(agruparEpisodios(ev), [
    { inicio: '2026-10-02', fin: '2026-10-03', dias: 2 },
    { inicio: '2026-10-05', fin: '2026-10-05', dias: 1 },
  ]);
});

test('ultimoDiaCompleto devuelve el día anterior si la última lectura es de la mañana', () => {
  assert.equal(ultimoDiaCompleto('2026-10-05 08:15'), '2026-10-04');
  assert.equal(ultimoDiaCompleto('2026-10-05 23:45'), '2026-10-05');
  assert.equal(ultimoDiaCompleto('2026-03-01 08:00'), '2026-02-28');
});

test('evaluarPronostico combina días observados con días pronosticados', async () => {
  const { evaluarPronostico } = await import('../src/motor.js');
  const obs = resumenDiario(['2026-10-01', '2026-10-02'].flatMap((f) => diaRiesgo(f, 4)));
  const pron = [
    { fecha: '2026-10-03', tmin: 12, hrMedia: 80, hrMin: 60, lluvia: 2, nTemp: 24, nHr: 24, nLluvia: 24 },
    { fecha: '2026-10-04', tmin: 4, hrMedia: 80, hrMin: 60, lluvia: 0, nTemp: 24, nHr: 24, nLluvia: 24 },
  ];
  const ev = evaluarPronostico(obs, pron);
  assert.deepEqual(ev.map((e) => e.fecha), ['2026-10-03', '2026-10-04']);
  assert.equal(ev[0].estado, 'alerta'); // 4+4+2 = 10 mm, mínimas ≥ 10, HR ≥ 70
  assert.equal(ev[0].prevista, true);
  assert.equal(ev[1].condiciones.temp, false); // la mínima pronosticada de 4 °C corta la racha
  assert.equal(ev[1].estado, 'sin_riesgo');
});

test('evaluarPronostico ignora observados del día en curso y posteriores', async () => {
  const { evaluarPronostico } = await import('../src/motor.js');
  const obs = resumenDiario(['2026-10-01', '2026-10-02', '2026-10-03'].flatMap((f) => diaRiesgo(f, 0)));
  const pron = [{ fecha: '2026-10-03', tmin: 12, hrMedia: 80, hrMin: 60, lluvia: 30, nTemp: 24, nHr: 24, nLluvia: 24 }];
  const [e] = evaluarPronostico(obs, pron);
  assert.equal(e.valores.lluvia, 30); // el 03 observado (0 mm) se reemplaza por el pronóstico
});
