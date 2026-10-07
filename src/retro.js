// Retro-testeo: corre la regla de peronospora sobre todo el histórico y resume por estación y temporada.
// Uso: node src/retro.js [--tmin 10] [--lluvia 10] [--hr 70] [--hr-modo media|minima]
import { join } from 'node:path';
import { config } from './config.js';
import { leerDiario, leerJson } from './almacen.js';
import { evaluarVentanas, agruparEpisodios, REGLAS_PERONOSPORA } from './motor.js';

export function parseReglas(argv) {
  const num = (flag, clave) => (argv.includes(flag) ? { [clave]: Number(argv[argv.indexOf(flag) + 1]) } : {});
  return {
    ...num('--tmin', 'tminC'),
    ...num('--lluvia', 'lluviaMm'),
    ...num('--hr', 'hrPct'),
    ...(argv.includes('--hr-modo') ? { hrModo: argv[argv.indexOf('--hr-modo') + 1] } : {}),
  };
}

// Temporada agrícola: de julio a junio (ej. 2024/25).
const temporada = (fecha) => {
  const y = Number(fecha.slice(0, 4));
  return Number(fecha.slice(5, 7)) >= 7 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
};

export function retro(dir, sobreescritas = {}) {
  const { estaciones } = leerJson(dir, 'estaciones.json');
  return estaciones.map((est) => {
    const evaluaciones = evaluarVentanas(leerDiario(dir, est.id)?.dias ?? [], sobreescritas);
    const validos = evaluaciones.filter((e) => e.estado !== 'sin_datos');
    const porTemporada = {};
    for (const e of evaluaciones) {
      const t = (porTemporada[temporada(e.fecha)] ??= { alertas: 0, validos: 0, porCondicion: { temp: 0, lluvia: 0, hr: 0 } });
      if (e.estado === 'sin_datos') continue;
      t.validos += 1;
      if (e.estado === 'alerta') t.alertas += 1;
      for (const k of Object.keys(t.porCondicion)) if (e.condiciones[k]) t.porCondicion[k] += 1;
    }
    return { est, validos: validos.length, alertas: validos.filter((e) => e.estado === 'alerta').length, episodios: agruparEpisodios(evaluaciones), porTemporada };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reglas = parseReglas(process.argv);
  console.log('Reglas:', JSON.stringify({ ...REGLAS_PERONOSPORA, ...reglas }));
  const filas = retro(join(config.dist, 'data'), reglas);
  console.log('\nestación'.padEnd(44), 'zona'.padEnd(13), 'días val.', 'días alerta', 'episodios');
  for (const f of filas) console.log(f.est.nombre.padEnd(43), f.est.zona.padEnd(13), String(f.validos).padStart(9), String(f.alertas).padStart(11), String(f.episodios.length).padStart(9));
  console.log(`\nTotal días en alerta (suma de estaciones): ${filas.reduce((a, f) => a + f.alertas, 0)}`);
}
