# alertas-coviar

Alertas agroclimáticas sobre las estaciones de COVIAR. **T1, carril A** del cronograma: caso testigo
**peronospora**, zona piloto Sur. Es un motor de reglas con umbrales agronómicos, **no** un modelo de IA.

Contexto y reparto de responsabilidades: `secretaria/reuniones/2026-08-11 COVIAR — tres proyectos.md`.
Todo el desarrollo para COVIAR va por la Facultad, nunca por la empresa privada del Secretario.

## Qué hace

- **Alerta** (lo que ya pasó): la regla de COVIAR se cumplió en los últimos 3 días completos, según lo que midió la estación.
- **Vigilancia** (lo que podría pasar): la misma regla corrida sobre los próximos 7 días con el pronóstico de
  tres modelos, calibrados contra las propias estaciones. Ver `docs/validacion-pronostico.md`.
- **Estado de la red**: qué estaciones están en línea, demoradas o apagadas, cobertura de lecturas, batería y un
  diagnóstico (falla de alimentación o de comunicación).
- **Retro-testeo** sobre todo el histórico y **umbrales editables** para calibrar con el equipo agronómico.

## Cómo está armado

No hay servidor ni base de datos. Todo es un **sitio estático** que se actualiza solo:

| Pieza | Archivo |
|---|---|
| Cliente del API REST Pegasus (cookie de 5 min, tramos de ≤ 31 días) | `src/pegasus.js` |
| Ingesta: lecturas de 15 min → resumen diario por estación (JSON) | `src/ingesta.js`, `src/almacen.js` |
| Pronóstico (Open-Meteo) y calibración | `src/pronostico.js`, `src/calibrar.js` |
| Motor de reglas — funciones puras, el mismo código corre en el navegador | `src/motor.js` |
| Salud de las estaciones | `src/salud.js` |
| Armado del sitio (`dist/`) | `src/publicar.js` |
| Interfaz | `public/` |
| Servidor local opcional (sirve `dist/` y lo actualiza) | `src/servidor.js` |

La regla se evalúa en el navegador a partir de `data/diario/*.json`, por eso cambiar un umbral en pantalla
recalcula todo al instante y el sitio puede alojarse en cualquier hosting estático.

## Correrlo en la PC

```bash
cp .env.example .env            # completar PEGASUS_USUARIO / PEGASUS_CLAVE (las entrega COVIAR)
node src/ingesta.js --completa  # primera carga: ~90 s
node src/calibrar.js            # primera calibración: ~15 min (30 estaciones × 1 año de pronósticos)
npm start                       # arma dist/ y sirve http://127.0.0.1:8010 (se actualiza solo cada 30 min)
npm test
npm run retro                   # tabla de alertas por estación; acepta --tmin --lluvia --hr --hr-modo
```

## Publicación (GitHub Pages)

`.github/workflows/publicar.yml` corre cada hora: baja lecturas y pronóstico, recalcula y republica. Cada
corrida parte de lo publicado en la anterior (`--previo`), así que no necesita almacenamiento propio.
Hace falta cargar dos *secrets* en el repo: `PEGASUS_USUARIO` y `PEGASUS_CLAVE`, y activar Pages con origen
«GitHub Actions». La corrida manual con «completa» rebaja todo el histórico.

## La regla

Alerta cuando se cumplen **a la vez**, en una ventana de 3 días: mínima diaria ≥ 10 °C cada día, lluvia
acumulada ≥ 10 mm, humedad relativa ≥ 70 % cada día.

Supuestos a confirmar con el equipo agronómico de COVIAR:

- **HR = media diaria.** No precisaron media o mínima. Con la mínima la regla no se cumple nunca en 3 años; con
  la media da ≈ 3,6 eventos de red por año, cerca de los 4–5 que ellos estimaron.
- Un día vale con ≥ 75 % de las lecturas. Si no, la ventana queda «sin datos» y nunca alerta.
- La lluvia es la suma de las lecturas de 15 min (pluviómetro de cuchara, 0,25 mm); coincide con el acumulado
  diario del equipo.

## Datos de la API (relevados el 05-10-2026)

- Bajo la cuenta hay 30 equipos. La red COVIAR son los 26 «COVIAR - …» más la Fac. de Ciencias Agrarias
  (Luján) = 27; la inclusión de Agrarias es una inferencia (`src/config.js`). Los 3 «La Riojana» (Chilecito) se
  muestran aparte como «fuera de la red COVIAR».
- El histórico llega a junio de 2023 (más de 3 años, no 2).
- Toda la red entrega ≈ 80–85 % de las 96 lecturas diarias teóricas y con hasta ~3 h de atraso: es lo normal.
  Los umbrales de salud están calibrados contra eso.
- **Apagadas hoy:** San Juan 05 (desde 08-09, batería normal → comunicación), Valle de Uco 02 (desde 15-09,
  batería en 4,7–5,9 V → alimentación), Zona Este 02 (desde 18-09, comunicación) y Zona Este 08 (desde 27-04,
  batería 5,45 V → alimentación).
- **Zona Sur 03 (El Cerrito)**, del piloto, anda con la batería al límite (6,02–6,42 V; la red oscila en 6,3–6,9 V).
- La suscripción al API es de COVIAR (proveedor TechMex). Si cae, el proyecto se queda sin insumo.

## Pendiente

- Canal de salida (WhatsApp / CPAP): decisión abierta, ver §2.1 del documento de proyectos.
- Umbrales por escrito y con fuente, de COVIAR.
- Padrón de destinatarios de la zona piloto.
- Confirmar con TechMex el umbral de batería baja (hoy 6,2 V, deducido de la propia red).
