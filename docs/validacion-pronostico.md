# Validación del pronóstico contra las estaciones

Cómo se eligió y se calibró el pronóstico que alimenta la «vigilancia». Reproducible con
`node scripts/validar-pronostico.mjs` (necesita haber corrido antes la ingesta: lee `dist/data/diario/` y `dist/data/estaciones.json`).

## Método

- **Fuente:** Open-Meteo, Previous Runs API: el pronóstico que existía 1, 2, 3, 5 y 7 días
  antes de cada fecha. Es el pronóstico real, no un análisis hecho a posteriori.
- **Modelos:** ECMWF IFS (0,25°), ICON y GFS.
- **Muestra:** 10 estaciones (Sur 02, 06 y 07; Este 04 y 06; San Juan 02; Valle de Uco 01; Maipú;
  Colonia 3 de Mayo; Villa Tulumaya), del 05-10-2025 al 03-10-2026 — 3.230 días-estación.
- **Qué se mide:** error absoluto medio (EAM) y sesgo de la temperatura mínima y la humedad media
  diarias, y cuántos días de alerta que midió la estación habría anticipado la regla corrida sobre
  el pronóstico (aciertos), cuántos no (pérdidas) y cuántas alarmas fueron falsas.

## Hallazgos

1. **Todos los modelos pronostican la mínima entre 3 y 5 °C de más** que lo que mide la estación
   (celda de 25 km contra un punto en el valle, donde la noche enfría más). Sin corregir, la
   condición «mínima ≥ 10 °C» se cumpliría casi siempre.
2. **GFS pronostica la humedad 13 puntos más seca**; ECMWF 1 a 5 y ICON 1 a 2.
3. **La lluvia casi no tiene sesgo**, pero su error diario (≈ 1 mm) es grande frente al umbral
   de 10 mm en 3 días.
4. La calibración (restar a cada modelo el sesgo medido en cada estación) elimina el sesgo y baja
   el EAM de la mínima de ≈ 3,5 a ≈ 1,9 °C a un día.

## Resultado sobre la regla completa (con calibración)

| Modelo | Plazo | Aciertos | Perdidas | Falsas |
|---|---|---|---|---|
| ECMWF | 1 día | 6 | 9 | 28 |
| ECMWF | 3 días | 4 | 11 | 32 |
| ECMWF | 5 días | 2 | 13 | 24 |
| ICON | 1 día | 6 | 7 | 20 |
| ICON | 3 días | 5 | 8 | 27 |
| ICON | 5 días | 0 | 13 | 9 |
| GFS | 1 día | 5 | 10 | 11 |
| GFS | 3 días | 0 | 15 | 17 |
| Consenso ECMWF + ICON | 1 día | 3 | 12 | 14 |

Total de días de alerta observados en la muestra: 15 (≈ 5 eventos). Es una muestra chica.

## Qué se decidió

- El pronóstico se presenta como **vigilancia**, nunca como alerta: a un día acierta cerca de
  4 de cada 10 eventos y a 5 días casi ninguno.
- Se calibra cada modelo en cada estación con el último año (se recalcula cada 35 días).
- Se usan los tres modelos y la confianza es **cuántos coinciden**: *probable* = al menos dos,
  *posible* = uno. No se inventó una probabilidad.
- Las estaciones con menos de 60 días válidos en el último año (hoy Valle de Uco 02) quedan sin
  calibrar y el portal lo avisa.

## Límites

- 15 días de alerta observados no alcanzan para afinar probabilidades. Con otra temporada
  húmeda (El Niño) conviene repetir la validación.
- Las lecturas de Open-Meteo para plazos largos pueden cambiar si el proveedor actualiza el modelo.
- Open-Meteo es gratuito para uso no comercial. Si el proyecto cambiara de naturaleza hay que
  revisar la licencia.
