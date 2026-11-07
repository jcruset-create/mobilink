# Pruebas reproducibles de la importación del histórico de albaranes

Todo corre contra una base **de pruebas desechable** en un PostgreSQL local. Los
scripts se niegan a tocar cualquier base cuyo nombre no empiece por `banco_` o
`esquema_completo`. Nunca apuntan a producción y no llevan credenciales.

Requisitos: PostgreSQL 16 local (por defecto `127.0.0.1:5433`, usuario `mobilink`,
sin contraseña; se cambia con `PGHOST/PGPORT/PGUSER`), `psql`, Node 22 con las
dependencias del repo (`npm ci`), y el Excel del cliente **fuera del repo** (se
pasa por ruta; no se añade aquí).

| Script | Qué hace |
|---|---|
| `bash scripts/importacion-historico/banco.sh` | El banco SQL de las tres migraciones (`supabase/pruebas/importacion_historico.sql`) en una base `banco_imp` limpia. 304 comprobaciones PASA/FALLA. |
| `npx tsx scripts/importacion-historico/conciliar-excel.mts <ruta.xlsx> [salida.json]` | Concilia el Excel entero con el mismo código del panel, imprime el resumen reconciliado (operaciones = nuevas + usadas + recauchutadas), los bloqueantes por motivo, y escribe los lotes de la **prueba pequeña** (14 albaranes) en JSON. |
| `bash scripts/importacion-historico/e2e.sh <lotes.json> [base]` | Importa esos lotes en una base de pruebas (por defecto `banco_e2e`, construida con el banco), comprueba B2_26/4905, la fotografía antes/después de montajes/stock/neumáticos/revisiones/km, la recarga, el documento cambiado y el deshacer parcial y completo. |
| `bash scripts/importacion-historico/concurrencia.sh [base]` | Nueve escenarios con DOS sesiones `psql` reales: importar×importar, importar×deshacer, deshacer×anular, deshacer×modificar servicio, deshacer×adjunto, cadenas de dos lotes a la vez, identificar×deshacer, revisar×reconstruir y reconstruir×reconstruir. |
| `npx tsx scripts/importacion-historico/pdf-visual.mts <dir_salida>` | Genera el parte PDF del albarán B2_26/4905 y el de una intervención normal con el código del servidor, para mirarlos. |
| `npx tsx scripts/importacion-historico/visual-fase3.mts` | Comprueba en el PANEL real lo que la fase 3 enseña: el ritmo anómalo con su límite, el aviso del albarán bloqueado, los motivos de exclusión, el diálogo de revisión con motivo obligatorio y la cobertura del informe. Necesita el stack local levantado y `playwright-core` (que NO es dependencia del repositorio: o se instala con `npm i -D playwright-core`, o se apunta `PLAYWRIGHT_CORE` a una instalación existente). Se configura además con `PANEL`, `CLAVES`, `BASE_DB`, `MATRICULA` y `SALIDA`. |

Orden habitual: `banco.sh` → `conciliar-excel.mts` → `e2e.sh` → `concurrencia.sh`.

Sobre el esquema: `banco.sh` y `e2e.sh` usan el esquema mínimo que reconstruye el
banco (tablas, triggers y FKs relevantes). Para probar contra el esquema completo
construido desde `supabase/migrations`, usar `construir-esquema.sh` y pasar
`esquema_completo` como base a `e2e.sh` y `concurrencia.sh`.

Las 12 migraciones que no se aplican en la reconstrucción, con motivo y
justificación, están en `MIGRACIONES_NO_APLICADAS.md`.

El alcance estadístico (qué informes leen o no las operaciones importadas,
comprobado con consultas) está en `ALCANCE_ESTADISTICO.md`.

## Fase 2: fichas, sustituciones e intervalos

`supabase/migrations/tyrecontrol_importacion_historico_fase2.sql` añade la
ficha de cada unidad nueva (con `tc_generar_numero_interno`), la salida por
sustitución de cada montaje (`grupo_sustitucion`) y los intervalos
reconstruidos en `tc_reconstruccion_montajes`, que es una tabla aparte de
`tc_historial_montajes` a propósito: ahí hay intervalos estimados y los seis
consumidores del historial real no saben distinguirlos.

- Importar una carga nueva ya lo hace todo: misma firma de
  `tc_importar_historico`, sin parámetros nuevos (una sobrecarga rompería las
  llamadas de PostgREST con PGRST203).
- Una carga antigua se completa con `tc_imp_ampliar_carga(carga, simular)`,
  que solo añade lo que falta y respeta la huella de lo que alguien haya
  tocado.
- Las usadas y recauchutadas se identifican a mano desde
  `/tyrecontrol/importar/identificar`.
- El informe «Montajes de neumáticos» vive en Informes y cuenta solo las
  unidades que entran.

### Que el inventario no se mezcle

`comprobar-inventario.sh` pregunta a los informes y compara con las fichas
reales de la empresa, en vez de leer el texto de las funciones:

```bash
bash scripts/importacion-historico/comprobar-inventario.sh esquema_completo
```

Falla si alguien vuelve a aplicar una migración que redefina
`tc_informes_inventario_por`, `tc_informes_inventario_marca_medida` o
`tc_marcas_contadores` sin el filtro del vínculo de importación —por ejemplo
`tyrecontrol_informes_TODO.sql`, que contiene copias antiguas de esas
funciones—, o si alguna ficha histórica aparece como disponible para montar.
Conviene ejecutarlo después de cualquier despliegue que toque informes.


## Fase 3: plausibilidad, revisión humana y continuidad

`supabase/migrations/tyrecontrol_importacion_historico_fase3.sql` separa tres
cosas que estaban mezcladas.

**Lo que la aritmética calcula y lo que es creíble.** `km_estado` gana
`anomalos`: un recorrido que sale bien de restar pero cuyo **ritmo diario**
supera el límite de la empresa. El recorrido, los días, el ritmo y el límite se
guardan; no se borra nada. El criterio es el ritmo y no el total porque
180.000 km en tres años es creíble y en tres meses no. Límite configurable y
2.000 km/día de partida:

```bash
psql ... -c "select tc_imp_limite_km_dia('<empresa>')"
psql ... -c "select tc_imp_fijar_limite_km_dia('<empresa>', 3000)"   -- reclasifica
```

Cambiar el límite **no toca las decisiones humanas**: el límite no es
evidencia. Con cero días no se divide entre cero: se compara el recorrido con
el límite de un día y el motivo lo dice.

**Lo que decide una persona.** `uso_estadistico` (pendiente / aceptado /
rechazado) con motivo obligatorio, usuario y fecha, auditado en
`tc_reconstruccion_revisiones`, que es append-only y sobrevive al deshacer.
Rechazar no convierte los kilómetros en ausentes; aceptar permite usarlo como
estimado y nunca como rendimiento confirmado. Si la evidencia del intervalo
cambia, la decisión caduca con constancia y el intervalo vuelve a pedir
revisión.

**Lo que no se puede dar por limpio.** Los albaranes bloqueados siguen sin
importarse, pero quedan anotados en `tc_importacion_bloqueados` con su
referencia, su fecha, su lectura de origen y el motivo literal. Si uno con
anotaciones de montaje cae dentro de un intervalo, ese intervalo queda con la
continuidad pendiente. No se elige posición ni eje.

El panel lee la vista `tc_reconstruccion_intervalos`, que añade `en_medias` y
`motivos_exclusion` calculados por la base: la regla vive en un solo sitio.

La cobertura de cualquier media sale de `tc_informes_recorridos_estimados`, y
`tc_informes_montajes` la incluye en su respuesta.

El caso que motivó todo esto, con lo que dice el origen y lo que no, está en
`CASO_1445HWZ.md`. Poder corregir una lectura de kilómetros conservando la
original es una propuesta **sin implementar**: `PROPUESTA_corregir_km_origen.md`.
