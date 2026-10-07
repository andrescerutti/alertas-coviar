// Estado de cada estación: ¿está reportando? ¿cuánto hace que no? ¿cómo anda la batería?
// Funciones puras; `ahora` y los timestamps son hora local de la estación ("YYYY-MM-DD HH:mm").

export const UMBRALES_SALUD = Object.freeze({
  enLineaMin: 180, // los equipos suben por chip en tandas; hasta 3 h de atraso es lo normal en esta red
  demoradaMin: 24 * 60, // entre 1 h y 24 h: demorada. Más de 24 h: apagada
  bateriaBajaV: 6.2, // la red oscila entre 6,3 y 6,9 V con el ciclo del panel; por debajo de 6,2 V se avisa (provisorio, a confirmar con TechMex)
  coberturaBaja: 0.6, // la red entera anda en 0,80–0,85 de las 96 lecturas diarias teóricas; por debajo de 0,6 algo anda mal
});

export const ESTADOS_SALUD = Object.freeze({
  en_linea: 'En línea',
  demorada: 'Demorada',
  apagada: 'Apagada',
  sin_datos: 'Sin datos',
});

const aMs = (ts) => Date.parse(`${ts.replace(' ', 'T')}:00Z`);

export function minutosSinDato(ultimoTs, ahora) {
  return ultimoTs ? Math.max(0, Math.round((aMs(ahora) - aMs(ultimoTs)) / 60_000)) : null;
}

// dias: resúmenes diarios (los últimos), con { fecha, nTemp, bat?: { min, max, ult } }
export function evaluarSalud({ ultimoTs, ahora, dias = [] }, umbrales = UMBRALES_SALUD) {
  const minutos = minutosSinDato(ultimoTs, ahora);
  const estado = minutos === null ? 'sin_datos' : minutos <= umbrales.enLineaMin ? 'en_linea' : minutos <= umbrales.demoradaMin ? 'demorada' : 'apagada';

  // Cobertura: lecturas de temperatura de los últimos 7 días calendario respecto de las 96 diarias esperadas.
  const hasta = ahora.slice(0, 10);
  const desde = new Date(Date.parse(`${hasta}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const ventana = dias.filter((d) => d.fecha >= desde && d.fecha <= hasta);
  const esperadas = estado === 'apagada' || estado === 'sin_datos' ? null : 7 * 96;
  const cobertura7d = esperadas ? Math.min(1, ventana.reduce((a, d) => a + d.nTemp, 0) / (esperadas - (96 - lecturasDelDia(ahora)))) : null;

  // Batería: último valor conocido y mínimo de los últimos días con dato.
  const conBat = dias.filter((d) => d.bat).slice(-7);
  const ult = conBat.at(-1)?.bat.ult ?? null;
  const min7 = conBat.length ? Math.min(...conBat.map((d) => d.bat.min)) : null;
  const bateria = {
    ultimo: ult,
    min7,
    baja: min7 !== null && min7 < umbrales.bateriaBajaV,
  };

  const alertas = [];
  if (estado === 'apagada') alertas.push(bateria.baja ? 'Dejó de reportar con la batería baja: probable falla de alimentación' : 'Dejó de reportar con la batería normal: probable falla de comunicación o del equipo');
  if (estado !== 'apagada' && estado !== 'sin_datos' && bateria.baja) alertas.push('Batería baja');
  if (cobertura7d !== null && cobertura7d < umbrales.coberturaBaja) alertas.push('Pierde lecturas');
  return { estado, minutosSinDato: minutos, cobertura7d, bateria, alertas };
}

// Lecturas esperadas del día en curso hasta la hora actual (para no penalizar un día a medio transcurrir).
function lecturasDelDia(ahora) {
  const [hh, mm] = ahora.slice(11, 16).split(':').map(Number);
  return Math.round(((hh * 60 + mm) / 15));
}
