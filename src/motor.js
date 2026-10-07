// Motor de reglas: umbrales agronómicos deterministas sobre series de las estaciones.
// No es un modelo de IA — es auditable y explicable al productor.
// Funciones puras: no tocan base de datos ni red.

// Condiciones predisponentes de infección primaria de peronospora, tal como las
// entregó COVIAR. Las tres deben cumplirse en forma simultánea durante `dias` días.
export const REGLAS_PERONOSPORA = Object.freeze({
  dias: 3,
  tminC: 10, // temperatura mínima diaria >= tminC, cada uno de los días
  lluviaMm: 10, // precipitación acumulada en la ventana >= lluviaMm
  hrPct: 70, // humedad relativa >= hrPct, cada uno de los días
  // COVIAR no precisó si la HR es media o mínima diaria. Se usa la media diaria;
  // 'minima' es la lectura más estricta. A confirmar con el equipo agronómico.
  hrModo: 'media',
  coberturaMin: 0.75, // fracción de lecturas del día para considerarlo válido
  lecturasPorDia: 96, // una cada 15 minutos
});

const SENTINELA_MAX = -900; // el API usa -999.9 para "sin dato"
const MS_DIA = 86_400_000;

const esDato = (valor) => typeof valor === 'number' && Number.isFinite(valor) && valor > SENTINELA_MAX;

const aMs = (fecha) => {
  const [y, m, d] = fecha.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const aFecha = (ms) => new Date(ms).toISOString().slice(0, 10);

export const sumarDias = (fecha, n) => aFecha(aMs(fecha) + n * MS_DIA);

const redondear = (n) => Math.round(n * 100) / 100;

// Último día para el que hay un día entero de datos, dada la última lectura ("YYYY-MM-DD HH:mm").
export function ultimoDiaCompleto(ultimoTs) {
  const [fecha, hora] = ultimoTs.split(' ');
  const [hh, mm] = hora.split(':').map(Number);
  return hh * 60 + mm >= 23 * 60 + 30 ? fecha : sumarDias(fecha, -1);
}

// filas: [{ ts: 'YYYY-MM-DD HH:mm', variable: 'temp'|'hr'|'lluvia', valor }]
// → [{ fecha, tmin, hrMedia, hrMin, lluvia, nTemp, nHr, nLluvia }] ordenado por fecha
export function resumenDiario(filas) {
  const porDia = new Map();
  for (const { ts, variable, valor } of filas) {
    if (!esDato(valor)) continue;
    const fecha = ts.slice(0, 10);
    const acc = porDia.get(fecha) ?? { temp: [], hr: [], lluvia: [] };
    if (acc[variable]) acc[variable].push(valor);
    porDia.set(fecha, acc);
  }
  return [...porDia.keys()].sort().map((fecha) => {
    const { temp, hr, lluvia } = porDia.get(fecha);
    return {
      fecha,
      tmin: temp.length ? Math.min(...temp) : null,
      hrMedia: hr.length ? redondear(hr.reduce((a, b) => a + b, 0) / hr.length) : null,
      hrMin: hr.length ? Math.min(...hr) : null,
      lluvia: redondear(lluvia.reduce((a, b) => a + b, 0)),
      nTemp: temp.length,
      nHr: hr.length,
      nLluvia: lluvia.length,
    };
  });
}

const diaValido = (d, reglas) => {
  const minimo = reglas.coberturaMin * reglas.lecturasPorDia;
  return d.nTemp >= minimo && d.nHr >= minimo && d.nLluvia >= minimo;
};

// Evalúa, para cada día D entre el primero y el último con datos, la ventana D-(dias-1)..D.
export function evaluarVentanas(resumen, sobreescritas = {}) {
  const reglas = { ...REGLAS_PERONOSPORA, ...sobreescritas };
  if (resumen.length === 0) return [];
  const porFecha = new Map(resumen.map((d) => [d.fecha, d]));
  const desde = resumen[0].fecha;
  const hasta = resumen.at(-1).fecha;
  const salida = [];

  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const ventana = Array.from({ length: reglas.dias }, (_, i) => porFecha.get(sumarDias(f, i - (reglas.dias - 1))));
    if (ventana.some((d) => !d) || !ventana.every((d) => diaValido(d, reglas))) {
      salida.push({ fecha: f, estado: 'sin_datos', condiciones: { temp: null, lluvia: null, hr: null }, cumplidas: 0, valores: null });
      continue;
    }
    const tminVentana = Math.min(...ventana.map((d) => d.tmin));
    const lluvia = redondear(ventana.reduce((a, d) => a + d.lluvia, 0));
    const hrVentana = Math.min(...ventana.map((d) => (reglas.hrModo === 'minima' ? d.hrMin : d.hrMedia)));
    const condiciones = {
      temp: tminVentana >= reglas.tminC,
      lluvia: lluvia >= reglas.lluviaMm,
      hr: hrVentana >= reglas.hrPct,
    };
    const cumplidas = Object.values(condiciones).filter(Boolean).length;
    salida.push({
      fecha: f,
      estado: cumplidas === 3 ? 'alerta' : 'sin_riesgo',
      condiciones,
      cumplidas,
      valores: { tmin: tminVentana, lluvia, hr: hrVentana },
    });
  }
  return salida;
}

// Une días de alerta consecutivos en episodios.
export function agruparEpisodios(evaluaciones) {
  const episodios = [];
  let actual = null;
  for (const { fecha, estado } of evaluaciones) {
    if (estado !== 'alerta') {
      actual = null;
      continue;
    }
    if (actual && sumarDias(actual.fin, 1) === fecha) {
      actual.fin = fecha;
      actual.dias += 1;
    } else {
      actual = { inicio: fecha, fin: fecha, dias: 1 };
      episodios.push(actual);
    }
  }
  return episodios;
}

// Evalúa la regla hacia adelante: días observados completos + días de pronóstico.
// `observados` y `pronostico` son resúmenes diarios (misma forma que resumenDiario).
// Solo se devuelven las ventanas que terminan en un día de pronóstico; las que no tienen
// ningún día observado también cuentan, pero `prevista` es siempre true.
export function evaluarPronostico(observados, pronostico, sobreescritas = {}) {
  if (pronostico.length === 0) return [];
  const primero = pronostico[0].fecha;
  const previos = observados.filter((d) => d.fecha < primero);
  const completos = pronostico.map((d) => ({ ...d, nTemp: REGLAS_PERONOSPORA.lecturasPorDia, nHr: REGLAS_PERONOSPORA.lecturasPorDia, nLluvia: REGLAS_PERONOSPORA.lecturasPorDia }));
  const futuras = new Set(pronostico.map((d) => d.fecha));
  return evaluarVentanas([...previos, ...completos], sobreescritas)
    .filter((e) => futuras.has(e.fecha))
    .map((e) => ({ ...e, prevista: true }));
}
