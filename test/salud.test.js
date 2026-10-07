import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarSalud, minutosSinDato } from '../src/salud.js';

const AHORA = '2026-10-05 09:00';
const dias = (n, nTemp = 96, bat = { min: 6.4, max: 6.9, ult: 6.7 }) =>
  Array.from({ length: n }, (_, i) => ({ fecha: new Date(Date.parse('2026-10-05T00:00:00Z') - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10), nTemp, bat }));

test('minutosSinDato mide contra la hora local de la estación', () => {
  assert.equal(minutosSinDato('2026-10-05 08:15', AHORA), 45);
  assert.equal(minutosSinDato(null, AHORA), null);
});

test('2 horas sin dato sigue en línea (atraso normal de la red)', () => {
  assert.equal(evaluarSalud({ ultimoTs: '2026-10-05 07:00', ahora: AHORA, dias: dias(7) }).estado, 'en_linea');
});

test('entre 3 y 24 horas es demorada', () => {
  assert.equal(evaluarSalud({ ultimoTs: '2026-10-05 05:00', ahora: AHORA, dias: dias(7) }).estado, 'demorada');
});

test('más de 24 horas es apagada', () => {
  assert.equal(evaluarSalud({ ultimoTs: '2026-09-08 01:00', ahora: AHORA, dias: dias(7) }).estado, 'apagada');
});

test('sin ninguna lectura es sin_datos', () => {
  assert.equal(evaluarSalud({ ultimoTs: null, ahora: AHORA }).estado, 'sin_datos');
});

test('una estación apagada con batería baja apunta a falla de alimentación', () => {
  const r = evaluarSalud({ ultimoTs: '2026-09-08 01:00', ahora: AHORA, dias: dias(7, 96, { min: 5.7, max: 6.2, ult: 5.8 }) });
  assert.equal(r.bateria.baja, true);
  assert.match(r.alertas[0], /alimentación/);
});

test('una estación apagada con batería normal apunta a comunicación', () => {
  const r = evaluarSalud({ ultimoTs: '2026-09-08 01:00', ahora: AHORA, dias: dias(7) });
  assert.match(r.alertas[0], /comunicación/);
});

test('la cobertura baja se avisa aunque esté en línea', () => {
  const r = evaluarSalud({ ultimoTs: '2026-10-05 08:45', ahora: AHORA, dias: dias(7, 50) });
  assert.ok(r.cobertura7d < 0.8);
  assert.ok(r.alertas.includes('Pierde lecturas'));
});

test('cobertura completa no genera aviso', () => {
  const r = evaluarSalud({ ultimoTs: '2026-10-05 08:45', ahora: AHORA, dias: dias(7) });
  assert.ok(r.cobertura7d > 0.95);
  assert.deepEqual(r.alertas, []);
});
