import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diarioDeHorario, aplicarCalibracion, calcularSesgo } from '../src/pronostico.js';

const horas = (fecha, valor) => Array.from({ length: 24 }, (_, h) => ({ t: `${fecha}T${String(h).padStart(2, '0')}:00`, v: typeof valor === 'function' ? valor(h) : valor }));

function hourly(...dias) {
  const filas = dias.flat();
  return {
    time: filas.map((f) => f.t),
    temperature_2m_m: filas.map((f) => f.v + 0),
    relative_humidity_2m_m: filas.map(() => 80),
    precipitation_m: filas.map((_, i) => (i % 24 === 10 ? 2.5 : 0)),
  };
}
const clave = (v) => `${v}_m`;

test('diarioDeHorario resume 24 horas en mínima, HR media y lluvia', () => {
  const [d] = diarioDeHorario(hourly(horas('2026-10-05', (h) => 10 + h)), clave);
  assert.deepEqual({ f: d.fecha, tmin: d.tmin, hr: d.hrMedia, ll: d.lluvia, n: d.nTemp }, { f: '2026-10-05', tmin: 10, hr: 80, ll: 2.5, n: 24 });
});

test('diarioDeHorario descarta los días incompletos', () => {
  const h = hourly(horas('2026-10-05', 10), horas('2026-10-06', 10).slice(0, 12));
  assert.equal(diarioDeHorario(h, clave).length, 1);
});

test('diarioDeHorario descarta días con huecos nulos', () => {
  const h = hourly(horas('2026-10-05', 10));
  h.temperature_2m_m[3] = null;
  assert.equal(diarioDeHorario(h, clave).length, 0);
});

test('aplicarCalibracion resta el sesgo y mantiene la HR entre 0 y 100', () => {
  const dia = { fecha: 'x', tmin: 14, hrMedia: 95, hrMin: 3, lluvia: 1 };
  const r = aplicarCalibracion(dia, { tmin: 3.5, hr: -8 });
  assert.equal(r.tmin, 10.5);
  assert.equal(r.hrMedia, 100);
  assert.equal(r.hrMin, 11);
  assert.equal(r.lluvia, 1);
  assert.equal(dia.tmin, 14); // no muta el original
});

test('aplicarCalibracion sin calibración devuelve el día tal cual', () => {
  const dia = { fecha: 'x', tmin: 14, hrMedia: 50, hrMin: 30, lluvia: 0 };
  assert.equal(aplicarCalibracion(dia, null), dia);
});

test('calcularSesgo promedia pronóstico menos medido sobre los días en común', () => {
  const obs = [{ fecha: 'a', tmin: 5, hrMedia: 60 }, { fecha: 'b', tmin: 7, hrMedia: 50 }];
  const pron = { 1: [{ fecha: 'a', tmin: 9, hrMedia: 55 }, { fecha: 'b', tmin: 10, hrMedia: 45 }], 3: [{ fecha: 'a', tmin: 8, hrMedia: 50 }] };
  const s = calcularSesgo(obs, pron);
  assert.equal(s.n, 3);
  assert.equal(s.tmin, 3.33);
  assert.equal(s.hr, -6.67);
});

test('calcularSesgo sin días en común devuelve null', () => {
  assert.equal(calcularSesgo([{ fecha: 'z', tmin: 1, hrMedia: 1 }], { 1: [] }), null);
});

test('mezclarDias: los días nuevos pisan a los viejos y el resultado queda ordenado', async () => {
  const { mezclarDias } = await import('../src/almacen.js');
  const r = mezclarDias([{ fecha: '2026-10-01', v: 1 }, { fecha: '2026-10-03', v: 1 }], [{ fecha: '2026-10-02', v: 2 }, { fecha: '2026-10-03', v: 2 }]);
  assert.deepEqual(r, [{ fecha: '2026-10-01', v: 1 }, { fecha: '2026-10-02', v: 2 }, { fecha: '2026-10-03', v: 2 }]);
});

test('resumenBateria saca mínimo, máximo y último valor del día', async () => {
  const { resumenBateria } = await import('../src/almacen.js');
  const r = resumenBateria([
    { ts: '2026-10-05 12:00', valor: 6.9 }, { ts: '2026-10-05 02:00', valor: 6.2 }, { ts: '2026-10-05 20:00', valor: 6.6 }, { ts: '2026-10-05 21:00', valor: -999.9 },
  ]);
  assert.deepEqual(r, { '2026-10-05': { min: 6.2, max: 6.9, ult: 6.6 } });
});
