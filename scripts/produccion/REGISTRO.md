# Registro de la puesta en producción · histórico de Plana (PR #492)

Se rellena **en el momento**, un paso por fila. Si un paso no se ejecuta, se
dice por qué; no se deja en blanco. Vive en el repositorio y no en un chat
porque es lo que permite saber dónde se quedó la cosa dentro de tres semanas.

- **Base:** proyecto de producción `sea-tarragona` · PostgreSQL **17.6** · 486 tablas en `public`
- **Empresa del histórico:** Plana · `a51c9662-4b6f-4681-8e2b-599e109659eb`
  (confirmada por UUID, no por el nombre: hay once empresas más)
- **Código:** rama `claude/importacion-historico-plana`, `main` integrado, CI en verde.
  **Sin desplegar todavía**: el panel de producción aún no tiene la pantalla de importar.

## Pasos

| # | Paso | Cuándo | Resultado |
|---|---|---|---|
| 1 | Preflight de solo lectura | 2026-10-31 | **Sin un solo `PARA`**. 23 tablas, 49 columnas y 5 funciones requeridas: están. 3 de 29 firmas ya existían. Base virgen de importación. 8 disparadores, los esperados |
| 2 | Comparar las 4 definiciones vivas con el repositorio | 2026-10-31 | **Idénticas** las cuatro: la base no se ha desviado |
| 3 | Captura de la vuelta atrás | 2026-11-01 | 4 objetos guardados por el cliente (3 funciones + la vista) |
| 4 | Backup | 2026-11-01 | Hecho |
| 5 | Fotografía previa | 2026-11-01 20:54 UTC | Ver abajo |
| 6 | Ensayo `begin … rollback` en 17.6 | | |
| 7 | Las tres migraciones | | |
| 8 | Preflight otra vez (debe dar 29 de 29) | | |
| 9 | Merge del PR y despliegue del panel | | |
| 10 | Primer mes importado y medido | | |
| 11 | Fotografía posterior y comparación | | |

## Fotografía previa · 2026-11-01 20:54 UTC

| Tabla | Filas | ¿La toca la importación? |
|---|---:|---|
| `movimientos_stock` | 93 | no |
| `tc_montajes_actuales` | 4.800 | no |
| `tc_historial_montajes` | 253 | no |
| `revisiones_vehiculo` | 17.589 | no |
| `revisiones_neumaticos_detalle` | 107.890 | no |
| `tc_vehiculos` | 909 | no |
| `tc_contadores_numero_operacion` | 1 | no (ni la fila ni su valor) |
| `operaciones_neumaticos` | 605 | **sí** |
| `tc_intervenciones` | 350 | **sí** |
| `tc_intervencion_servicios` | 6 | **sí** |
| `tc_neumaticos` | 5.060 | **sí** |
| `tc_contadores_numero_interno` | 1 | la fila no; **su valor sí avanza** |

Cuadra con el preflight: 909 = 807 Plana + 85 ENCATRANS + 16 Mobilink + 1
Canteras, y 5.060 = 4.410 + 559 + 85 + 6.

Que las seis primeras no se muevan no es una esperanza: en las tres
migraciones hay **cero** `insert` y `update` contra ellas.

## Lo que se espera después de importar los diez meses

`operaciones_neumaticos` 605 → ~3.336 · `tc_intervenciones` 350 → ~1.868 ·
`tc_intervencion_servicios` 6 → ~3.400 · `tc_neumaticos` 5.060 → más las
fichas históricas. Todo el incremento, con `importacion_lote_id`.

Cuatro de cada cinco operaciones de la base pasarán a ser históricas. Por eso
el filtro del vínculo de importación en los informes de inventario no es un
detalle, y por eso **después del primer mes se miran los informes antes de
seguir con el segundo**.

## Lo que no se ha podido probar aquí

Producción va en PostgreSQL **17.6** y en la máquina de desarrollo solo hay
16: no hay paquete de 17, el repositorio oficial está bloqueado por la red y
no hay demonio de Docker. Por eso existe el ensayo `begin … rollback`, que
prueba las tres migraciones **en la base de verdad y en su versión de
verdad** sin dejar rastro.

## Si hay que volver atrás

1. `vuelta-atras-produccion.sql` → el fichero guardado en el paso 3.
2. `deshacer-migraciones.sql` → borra lo que las migraciones crean.

En ese orden, y con las dos guardas que trae el segundo: se niega si quedan
lotes importados (eso lo deshace `tc_deshacer_importacion`) y se niega si las
definiciones de siempre no se han restaurado. Viaje de ida y vuelta probado
contra el esquema reconstruido: 3.570 objetos antes, 3.570 después, cero
diferencias.
