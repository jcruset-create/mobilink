# Registro de la prueba de staging

Se rellena **cuando se autorice**, un paso por fila, en el momento. Si un paso
no se ejecuta, se dice por qué; no se deja en blanco.

**Nada de esto está ejecutado todavía.**

- **SHA probado:** _(el commit desplegado, no la rama)_
- **Proyecto Supabase de pruebas:** _(ref)_ · **Servicio Render:** _(nombre)_
- **Quién ejecuta:** · **Fecha:**

| # | Paso | Script | Ejecutado | Resultado | Notas |
|---|---|---|---|---|---|
| 1 | Volcar el esquema de producción | `01-volcar-esquema.sh` | | | tamaño, nº de objetos, cero `COPY` |
| 2 | Repasar el DDL | `02-revisar-ddl.sh` | | | qué aparece en `.avisos` y qué se decide |
| 2b | Ensayo **preliminar** de restauración | `08-ensayar-restauracion.sh` | | | errores, y si alguno sale de la lista prevista |
| 3 | Crear el proyecto Supabase | — | | | |
| ★A | Inicializar el destino y **marcar** | `00-inicializar-destino.sh` | | | base vacía confirmada; marca puesta antes de restaurar |
| ★B | Comprobar el destino | `00-comprobar-destino.sh` | | | se repite antes de 4, 6, 7 y 8: una fila por vez |
| 4 | Restaurar el DDL | `03-levantar-staging.sh` | | | **aquí** se valida de verdad la compatibilidad del DDL |
| 4b | Permisos y su comprobación | `permisos-pruebas.sql` + `10-comprobar-permisos.sh` | | | marcar cada resultado `[migración]` o `[staging]` |
| 5 | Respaldo y prueba de restauración | `06-respaldo-y-restauracion.sh` | | | los seis recuentos |
| 5b | Vuelta atrás de inventario, probada | `07-guardar-vuelta-atras.sh --probar` | | | las tres huellas |
| 6 | Las tres migraciones, en orden | SQL Editor | | | cotejo previo de las 28 firmas |
| 7 | Datos sintéticos | `semilla-staging.sql` | | | `tc_cat_servicios` con sus 12 filas |
| 8 | Desplegar panel y servidor | Render | | | misma versión en los dos |
| 9 | Identificar el entorno desplegado | `04-identificar-entorno.sh` | | | bundle, commit del servidor y marca de la base |
| 10 | Arranque y PDF | `05-probar-arranque.sh` | | | |
| 11 | Simular → importar → medir → PDF → inventario → recarga → deshacer | README §11 | | | |

## Criterios de aceptación

Uno por fila, con la marca de si depende o no del entorno
([`DIFERENCIAS_CON_PRODUCCION.md`](DIFERENCIAS_CON_PRODUCCION.md)):

| # | Criterio | `[migración]` / `[staging]` | Resultado |
|---|---|---|---|
| 1–14 | Importación, kilómetros, estadísticas y lo que no se toca | `[migración]` | |
| 15 | Marca puesta por ★A antes de restaurar; ★B pasado antes de cada operación | `[staging]` | |
| 16 | `10-comprobar-permisos.sh` en verde | `[staging]`, salvo auditoría, auxiliares de la importación y aislamiento entre empresas, que son `[migración]` | |

## Si se para

Condición que lo provocó, qué se restauró, y qué queda pendiente. La norma es
probar lo que está bien, no terminar la prueba pase lo que pase.
