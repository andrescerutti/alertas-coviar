import { config } from './config.js';
import { sumarDias } from './motor.js';

const VIGENCIA_COOKIE_MS = 4 * 60_000; // la cookie dura 5 min; se renueva antes
const MAX_DIAS_POR_CONSULTA = 31; // COVIAR recomienda no pedir más de un par de meses

export class ClientePegasus {
  #cookie = null;
  #autenticadoEn = 0;
  #idCliente = null;

  async #post(metodo, cuerpo, { conCookie = true } = {}) {
    const res = await fetch(`${config.pegasusUrl}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(conCookie && this.#cookie ? { Cookie: this.#cookie } : {}) },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Pegasus ${metodo}: HTTP ${res.status}`);
    return res;
  }

  async autenticar() {
    if (!config.usuario || !config.clave) throw new Error('Faltan PEGASUS_USUARIO / PEGASUS_CLAVE en .env');
    const res = await this.#post('AutenticarUsuario', { nombreDeUsuario: config.usuario, clave: config.clave }, { conCookie: false });
    const cuerpo = await res.json();
    if (!cuerpo.autenticado) throw new Error('Pegasus rechazó las credenciales');
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('validUserCookie='));
    if (!setCookie) throw new Error('Pegasus no devolvió validUserCookie');
    this.#cookie = setCookie.split(';')[0];
    this.#idCliente = cuerpo.idCliente;
    this.#autenticadoEn = Date.now();
  }

  async #sesion() {
    if (!this.#cookie || Date.now() - this.#autenticadoEn > VIGENCIA_COOKIE_MS) await this.autenticar();
  }

  async #json(metodo, cuerpo, reintento = true) {
    await this.#sesion();
    try {
      const res = await this.#post(metodo, cuerpo);
      return await res.json();
    } catch (err) {
      if (!reintento) throw err;
      this.#cookie = null; // fuerza re-autenticación y un único reintento
      return this.#json(metodo, cuerpo, false);
    }
  }

  async equipos() {
    await this.#sesion();
    return this.#json('RecuperarEquipos', { idCliente: this.#idCliente });
  }

  // Serie de un sensor entre dos fechas (YYYY-MM-DD), partida en tramos de <= 31 días.
  async historico(idEquipo, idSensor, desde, hasta) {
    const filas = [];
    for (let ini = desde; ini <= hasta; ini = sumarDias(ini, MAX_DIAS_POR_CONSULTA)) {
      const finTramo = sumarDias(ini, MAX_DIAS_POR_CONSULTA - 1);
      const fin = finTramo < hasta ? finTramo : hasta;
      const tramo = await this.#json('RecuperarHistoricosDeEquipoPorSensor', { idEquipo, idSensor, fechaDesde: ini, fechaHasta: fin });
      filas.push(...tramo);
    }
    return filas;
  }
}
