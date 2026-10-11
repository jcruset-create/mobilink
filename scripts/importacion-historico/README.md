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
| `bash scripts/importacion-historico/banco.sh` | El banco SQL de la migración (`supabase/pruebas/importacion_historico.sql`) en una base `banco_imp` limpia. 69 comprobaciones PASA/FALLA. |
| `npx tsx scripts/importacion-historico/conciliar-excel.mts <ruta.xlsx> [salida.json]` | Concilia el Excel entero con el mismo código del panel, imprime el resumen reconciliado (operaciones = nuevas + usadas + recauchutadas), los bloqueantes por motivo, y escribe los lotes de la **prueba pequeña** (14 albaranes) en JSON. |
| `bash scripts/importacion-historico/e2e.sh <lotes.json> [base]` | Importa esos lotes en una base de pruebas (por defecto `banco_e2e`, construida con el banco), comprueba B2_26/4905, la fotografía antes/después de montajes/stock/neumáticos/revisiones/km, la recarga, el documento cambiado y el deshacer parcial y completo. |
| `bash scripts/importacion-historico/concurrencia.sh [base]` | Cinco escenarios con DOS sesiones `psql` reales: importar×importar, importar×deshacer, deshacer×anular, deshacer×modificar servicio, deshacer×adjunto. |
| `npx tsx scripts/importacion-historico/pdf-visual.mts <dir_salida>` | Genera el parte PDF de B2_26/4905 y el de una intervención normal con el código del servidor, para mirarlos. |

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
