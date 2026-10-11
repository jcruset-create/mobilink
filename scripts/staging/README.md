# Procedimiento de staging del PR #492

Un solo documento, en orden. **Nada de esto se ha ejecutado** y nada se
ejecuta solo: los pasos marcados con 🔒 los lanza una persona autorizada.
No hay credenciales en ningún fichero de esta carpeta y no debe haberlas.

El entorno es la **opción B: esquema real, datos sintéticos**. Producción
tiene unas 437 tablas en `public` y el repositorio solo conoce las de las
migraciones, así que un entorno construido desde el repositorio probaría la
migración contra un esquema que no es el que hay. **Solo el esquema: ni una
fila de datos de producción.**

---

## Resumen de los pasos

| # | Qué | 🔒 | Script |
|---|---|---|---|
| 0 | Leer este documento entero | | — |
| 1 | Volcar el **esquema** de producción, sin datos | 🔒 | `01-volcar-esquema.sh` |
| 2 | Repasar ese DDL antes de restaurarlo | | `02-revisar-ddl.sh` |
| 3 | Crear el proyecto Supabase de pruebas | 🔒 | — (panel) |
| 4 | Restaurar el DDL y **marcar** la base | 🔒 | `03-levantar-staging.sh` |
| 5 | Respaldo y **prueba de restauración** | 🔒 | `06-respaldo-y-restauracion.sh` |
| 6 | Aplicar las **tres migraciones**, en orden | 🔒 | SQL Editor |
| 7 | Sembrar los datos sintéticos | 🔒 | `semilla-staging.sql` |
| 8 | Desplegar panel y servidor de la misma versión | 🔒 | — (Render) |
| 9 | **Identificar el entorno**: panel, servidor y base | | `04-identificar-entorno.sh` |
| 10 | Comprobar el arranque y el PDF | | `05-probar-arranque.sh` |
| 11 | Simular, importar, medir, PDF, inventario, recarga y deshacer | 🔒 | abajo |

---

## 1. Volcar el esquema de producción 🔒

```bash
ORIGEN_URL='postgresql://…' bash scripts/staging/01-volcar-esquema.sh esquema-produccion.sql
```

`--schema-only --no-owner --no-privileges --schema=public`. El script enseña
el host antes de nada y pide confirmación, y comprueba que no se haya colado
ni un bloque `COPY`: si hay datos, para.

## 2. Repasar el DDL antes de restaurarlo

```bash
bash scripts/staging/02-revisar-ddl.sh esquema-produccion.sql
```

Un `pg_dump --schema-only` no es inerte. Esto es lo que **no puede ejecutarse
en pruebas tal cual**, y el script lo lista con el número de línea en
`<fichero>.avisos`:

| Qué | Por qué |
|---|---|
| `cron.schedule(...)` (pg_cron) | un trabajo programado restaurado en pruebas se ejecuta en pruebas |
| `net.http_post` / `net.http_get` (pg_net) | llamadas HTTP salientes desde la propia base |
| `dblink`, `postgres_fdw`, `create server`, `user mapping` | conexiones a otras bases; una podría ser producción |
| `create event trigger` | se dispara con cualquier DDL, incluido el del arranque de Express |
| `create publication` / `subscription` | replicación apuntando a producción |
| URLs dentro de funciones | un `security definer` con una URL de producción escrita dentro la sigue llamando |

Lo que salga se **comenta a mano en el DDL antes** de restaurar, no después.

## 3. Crear el proyecto Supabase de pruebas 🔒

Plan gratuito. Dos límites conocidos: el número de proyectos gratuitos por
organización, y que un proyecto gratuito **se pausa tras una semana sin
actividad**.

## 4. Restaurar y marcar la base 🔒

```bash
DESTINO_URL='postgresql://…' bash scripts/staging/03-levantar-staging.sh esquema-produccion.sql
```

Se niega si la base ya tiene tablas `tc_*`, y al terminar **marca** la base:

```sql
alter database "…" set mobilink.entorno = 'pruebas';
```

Esa marca es la comprobación que sirve. El nombre de la base se repite, el
número de tablas con el esquema real es idéntico, y `current_database()` no
distingue dos bases llamadas igual en servidores distintos. Producción no
tiene la marca y no se le pone.

### Qué más necesita la base, además del DDL

Dos cosas que en Supabase pone la plataforma y que una base restaurada a mano
puede no tener. Las dos se descubrieron levantando el servidor de verdad:

1. **`service_role` tiene que saltarse la RLS** (`alter role service_role
   bypassrls`). El endpoint del PDF lee con la service key; sin eso devuelve
   «Parte no encontrado» en pruebas y funciona en producción.
2. **`anon` y `authenticated` necesitan los permisos de tabla** de los
   *default privileges* de `public`. Sin ellos, cualquier RPC `security
   invoker` responde «permission denied for table …». Lo que protege los
   datos es la RLS, no la ausencia de GRANT.

En un proyecto Supabase recién creado vienen de serie; en una base restaurada,
hay que comprobarlas.

## 5. Respaldo, y la prueba de que sirve 🔒

```bash
ORIGEN_DB=<base> COPIA_DB=<base>_copia bash scripts/staging/06-respaldo-y-restauracion.sh
```

Hacer un volcado no es tener respaldo: lo que cuenta es haber restaurado y
visto que vuelve. El script vuelca, restaura **en otra base** y compara los
recuentos de intervenciones, operaciones, fichas, intervalos, revisiones y
bloqueados. Probado en local contra la base del histórico completo: los seis
recuentos coinciden.

La vuelta atrás, si algo sale mal, es restaurar ese volcado **en una base
nueva** y cambiar el destino del servidor. Nunca restaurar encima de la base
viva.

## 6. Las tres migraciones, en este orden 🔒

Cada una en su transacción, en el SQL Editor, mirando la salida:

1. `supabase/migrations/tyrecontrol_importacion_historico.sql` — **fase 1**:
   tablas `tc_importacion_*`, columnas de vínculo, `tc_importar_historico`,
   `tc_deshacer_importacion`, corrección de `tc_anular_operacion`.
2. `supabase/migrations/tyrecontrol_importacion_historico_fase2.sql` —
   **fase 2**, necesita la 1: fichas, sustituciones,
   `tc_reconstruccion_montajes`, informe de montajes, ajustes de inventario.
3. `supabase/migrations/tyrecontrol_importacion_historico_fase3.sql` —
   **fase 3**, necesita las dos: plausibilidad, revisión humana en dos
   ámbitos, albaranes bloqueados como contexto y la cobertura de las medias.

Las tres son **idempotentes**: se vuelven a aplicar sin efecto, y así se
prueba (aplicar dos veces cada una).

### Antes de aplicar: cotejar las firmas

`create or replace function` sobre una firma distinta **crea una segunda
función** y PostgREST responde `PGRST203` a todas las llamadas. Hay que
comprobar que lo que ya existe en la base tiene exactamente estas firmas, tal
como las devuelve `pg_get_function_identity_arguments`:

| Función | Firma (como la devuelve `pg_get_function_identity_arguments`) | Fase |
|---|---|---|
| `tc_anular_operacion` | `(p_operacion uuid, p_motivo text)` → `void` | 1 (ya existía; misma firma) |
| `tc_deshacer_importacion` | `(p_lote uuid, p_excluir uuid[], p_simular boolean)` → `jsonb` | 1, redefinida en 2 y 3 |
| `tc_imp_ampliar_carga` | `(p_carga uuid, p_simular boolean)` → `jsonb` | 2 |
| `tc_imp_ampliar_intervencion` | `(p_intervencion uuid)` → `jsonb` | 2 |
| `tc_imp_anotar_bloqueado` | `(p_lote uuid, p_empresa uuid, p_origen text, p_alb jsonb, p_motivo text)` → `uuid` | 3 |
| `tc_imp_bloquear` | `(p_empresa uuid, p_origen text)` → `void` | 1 |
| `tc_imp_desfase_mano_obra` | `(p_vehiculo uuid)` → `TABLE(fecha date, origen_doc text)` | 2 |
| `tc_imp_exigir_admin` | `(p_empresa uuid)` → `void` | 1 |
| `tc_imp_ficha_historica` | `(p_empresa uuid, p_lote uuid, p_doc text, p_linea text, p_grupo uuid, p_marca text, p_modelo text, p_medida text)` → `uuid` | 2 |
| `tc_imp_fijar_limite_km_dia` | `(p_empresa uuid, p_limite numeric)` → `numeric` | 3 |
| `tc_imp_huella_estado` | `(p_intervencion uuid)` → `text` | 1, redefinida en 2 |
| `tc_imp_huella_intervalo` | `(p_intervalo uuid)` → `text` | 3 |
| `tc_imp_identificar_unidad` | `(p_operacion uuid, p_neumatico uuid, p_crear boolean, p_motivo text)` → `jsonb` | 2 |
| `tc_imp_intervalo_en_medias` | `(p_intervalo tc_reconstruccion_montajes)` → `boolean` | 3 |
| `tc_imp_intervalo_motivos` | `(p_intervalo tc_reconstruccion_montajes)` → `text[]` | 3 |
| `tc_imp_limite_km_dia` | `(p_empresa uuid)` → `numeric` | 3 |
| `tc_imp_medianoche` | `(p_fecha date)` → `timestamp with time zone` | 1 |
| `tc_imp_num` | `(p_valor numeric)` → `text` | 3 |
| `tc_imp_posiciones_norma` | `(p_vehiculo uuid, p_nuevas integer, p_una_referencia boolean)` → `uuid[]` | 1 |
| `tc_imp_reconstruir_vehiculo` | `(p_vehiculo uuid)` → `integer` | 2, redefinida en 3 |
| `tc_imp_revisar_intervalo` | `(p_intervalo uuid, p_decision text, p_motivo text)` → `jsonb` | 3 |
| `tc_importar_historico` | `(p_empresa uuid, p_origen_sistema text, p_lote jsonb, p_simular boolean)` → `jsonb` | 1, redefinida en 2 y 3 |
| `tc_informes_inventario_marca_medida` | `(p_empresa uuid)` → `TABLE(marca text, medida text, total bigint)` | 2 (ya existía) |
| `tc_informes_inventario_por` | `(p_empresa uuid, p_dim text)` → `TABLE(etiqueta text, total bigint)` | 2 (ya existía) |
| `tc_informes_inventario_resumen` | `(p_empresa uuid)` → `jsonb` | 2 (ya existía) |
| `tc_informes_montajes` | `(p_empresa uuid, p_desde date, p_hasta date, p_origen text)` → `jsonb` | 2, redefinida en 3 |
| `tc_informes_recorridos_estimados` | `(p_empresa uuid, p_desde date, p_hasta date, p_vehiculo uuid)` → `jsonb` | 3 |

Dos precisiones, porque es fácil contar de más:

- **La única función que se elimina en todo el PR es
  `tc_imp_revisar_intervalo(uuid, text, text)`**, y la elimina la fase 3 justo
  antes de crear su versión de cuatro parámetros. Es una función de la propia
  fase 3, que no está desplegada en ninguna parte; el `drop` está por si
  alguien aplicó una versión anterior en una base de pruebas. Ninguna otra
  redefinición dropea nada: todas son `create or replace` sobre la **misma
  firma**.
- `tc_imp_anotar_bloqueado` devuelve `uuid`, no `void`.

### Y guardar la vuelta atrás de los informes de inventario

Las tres funciones de inventario y la vista `tc_marcas_contadores` son lo
único que la migración **redefine habiendo sido escrito por otra migración**.
Si en la base real tienen otro cuerpo, la migración se lo lleva por delante:

```bash
psql "$DATABASE_URL" -At -c "select pg_get_functiondef(p.oid) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
   ('tc_informes_inventario_por','tc_informes_inventario_marca_medida','tc_informes_inventario_resumen')" \
  > inventario-antes.sql
psql "$DATABASE_URL" -At -c "select pg_get_viewdef('tc_marcas_contadores'::regclass, true)" \
  >> inventario-antes.sql
```

Ese fichero **es** la vuelta atrás de esa parte. Y la comprobación de que la
redefinición hace lo que debe es funcional:
`scripts/importacion-historico/comprobar-inventario.sh`.

## 7. Los datos sintéticos 🔒

```bash
psql "$DESTINO_URL" -f scripts/staging/semilla-staging.sql
```

Se niega a sembrar una base que no lleve la marca `mobilink.entorno`. Crea
nueve vehículos con las configuraciones que la prueba tiene que distinguir
—2+4, 2+4+2, 2+4+4, 2+2, sin plano, sin tipo, varias referencias, con datos
vivos, y 1445HWZ— y deja **sin crear** la matrícula `PRUNOEX`, que es el caso
de «vehículo no encontrado». Ni una fila viene de producción.

## 8. Desplegar 🔒

Panel y servidor son **un solo artefacto**: Express sirve la API y entrega el
panel compilado desde `dist`. Un segundo servicio en Render apuntando a la
rama, con las variables de abajo.

### Las variables mínimas, comprobadas

`05-probar-arranque.sh` levanta el servidor con **estas 20 y ninguna más**:

`DATABASE_URL` · `PGSSLMODE` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` ·
`VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` · `NODE_ENV` · `PORT` · `TZ` ·
`PUBLIC_APP_URL` · `TYRE_CONTROL_WRITE_ENABLED` ·
`TYRE_CONTROL_REPAIR_SYNC_ENABLED` · `TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED` ·
`TYRE_CONTROL_SYNC_COMPANIES` · los seis `*_STORAGE_LOCAL`.

Copiar las 34 de producción metería en pruebas las credenciales de pagos,
mensajería, buzones y ERP, y la prueba no usa ninguna. Stripe, Twilio, SMTP,
los buzones IMAP, OpenAI, Webfleet, Movertis, Business Central, Firebase y
Google Maps **se quedan sin definir a propósito**: sin credencial no se
encienden. La plantilla está en `variables-staging.env.example`.

**Y el servidor no arrancaba sin Stripe.** El cliente se construía en el
arranque con la clave vacía y la librería lanza al instante, así que el
proceso moría antes de escuchar: dejar la variable sin definir no evitaba el
obstáculo, era el obstáculo. Ahora el cliente vive en
`server/core/stripeCliente.ts`, se crea la primera vez que se usa y solo si
hay clave; sin ella el servidor levanta y las tres rutas de cobro responden
503 antes de intentar nada. Con clave, el comportamiento es el de siempre.

## 9. Identificar el entorno antes de tocar nada

```bash
PANEL_URL=… SERVIDOR_URL=… DESTINO_URL=… REF_PRUEBAS=… REF_PRODUCCION=… \
COMMIT_ESPERADO=… bash scripts/staging/04-identificar-entorno.sh
```

Las tres piezas, **por a dónde apuntan**:

1. **Panel**: el subdominio del proyecto Supabase va **compilado dentro del
   bundle**. Si el bundle lleva el de producción, el panel habla con
   producción aunque la URL del sitio sea la de pruebas.
2. **Servidor**: `/api/health` devuelve `{ok, version, commit}` con el commit
   desplegado en 8 caracteres. Tiene que ser el que se quiere probar.
3. **Base**: la marca `mobilink.entorno = 'pruebas'` y el proyecto en la
   cadena de conexión.

`current_database()` y el número de tablas **no valen**: con el esquema real
restaurado son idénticos a los de producción.

**Si cualquiera de las tres falla, se para.**

### El arranque de Express también hace DDL

`server/index.ts` ejecuta `prepararEsquema(...)` al arrancar: `CREATE TABLE IF
NOT EXISTS` y `ADD COLUMN IF NOT EXISTS` sobre `DATABASE_URL`. **Arrancar el
servidor ya modifica la base**, sin que nadie haya pedido una migración. Antes
de arrancar, siempre:

```bash
node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.hostname,u.port,u.pathname)'
psql "$DATABASE_URL" -At -c "select current_setting('mobilink.entorno', true)"
```

## 10. Comprobar el arranque y el PDF

```bash
BASE_DB=<base> CLAVES=<ruta>/claves.json bash scripts/staging/05-probar-arranque.sh
```

Comprueba que el servidor arranca, que ninguna integración externa se ha
encendido, y que el endpoint real del PDF da **401 sin token** y **200 con
sesión de admin**.

## 11. La prueba 🔒

En este orden. Cada punto tiene su condición de parada más abajo.

1. **Simular** el lote pequeño (`p_simular = true`). No escribe nada: ni
   filas, ni numeración. Tiene que enseñar, y se comprueba uno a uno:
   **vehículos no encontrados** (`PRUNOEX`), **planes ausentes o
   incompatibles** (el vehículo sin tipo y el 2+2 con seis nuevas),
   **duplicados** (volver a simular: cero nuevos) y **documentos cambiados**
   (alterar una línea de un albarán ya importado: lo detecta por la huella y
   no toca nada).
2. **Importar** ese lote pequeño y conciliar contra el Excel: albaranes,
   montajes, desmontajes, fichas, pendientes de identidad, servicios y líneas.
3. **PDF** de una intervención con histórico, por `GET
   /api/tyrecontrol/parte/:id/pdf`. El histórico en su hoja, separado del
   bloque facturable, con la nota de las salidas.
4. **Medir el lote mayor** llamando al mismo endpoint PostgREST que usa el
   panel, con el JWT de admin, y quedarse con el tiempo. En local el lote
   mayor son ~1 MB de JSON; lo que interesa es si Supabase lo aguanta en una
   sola llamada o hay que partirlo.
5. **Inventario**: `comprobar-inventario.sh` y a ojo en el panel. Las fichas
   históricas no son existencias.
6. **Recargar** el mismo lote: cero fichas nuevas, cero numeración consumida.
7. **Deshacer** y comparar con la fotografía previa. Tiene que quedar
   idéntica. Incluye los dos casos difíciles: intervalos que cruzan lotes y
   registros modificados después de importar.

---

## Criterios de aceptación

**La importación**

1. B2_26/4905 (albarán de Plana, no una empresa): 4 montajes, 4 desmontajes,
   2 fichas nuevas, y las usadas **pendientes de identidad**, no inventadas.
2. Seis nuevas = **2 al eje 1 y 4 al eje 2**, solo con una referencia y plano
   compatible: 2+4, 2+4+2 y 2+4+4 sí; 2+2 y sin plano, no, y entonces la
   asignación queda pendiente y la posición es «desconocida».
3. Los **25 albaranes bloqueados** siguen sin importarse: cero operaciones,
   cero fichas, cero cantidades. La lista exacta, con documento, matrícula,
   fecha, kilómetros, motivo literal y filas de origen, está en
   `scripts/importacion-historico/ALBARANES_BLOQUEADOS.md`.
4. Las **OR son evidencia complementaria**: un vehículo sin OR se importa
   igual.

**Los kilómetros y las estadísticas**

5. Los kilómetros **originales se conservan** siempre, también cuando no dan
   recorrido: incompatibles y anómalos guardan los dos valores.
6. Un intervalo entra en las medias **solo** si está cerrado, tiene recorrido
   calculable, sus kilómetros no están rechazados, si hay duda de kilómetros
   está aceptada expresamente, y **la continuidad no está pendiente ni
   rechazada**. Aceptar los kilómetros **no** resuelve la continuidad.
7. Toda media publica su **cobertura**: incluidos, excluidos por motivo
   (sabiendo que **se solapan** y no se suman), las tres identidades
   —respaldada, ficha reconstruida, sin ficha— y el periodo.
8. El **rendimiento estimado no se mezcla con el confirmado**: viven en
   tablas distintas y ningún informe de rendimiento lee la reconstrucción.

**Lo que no se toca**

9. Montajes vivos, historial confirmado, stock, revisiones y `km_actual`:
   **intactos**, contador a contador.
10. Las fichas anteriores, idénticas; el inventario disponible, sin fichas
    históricas.
11. Deshacer limpio deja la fotografía previa igual. Deshacer con
    modificaciones o revisiones humanas **conserva** y explica por qué.
12. El contador de números internos **no vuelve atrás**.

**Lo que no se exige, porque no está construido**

13. La **ingesta auditada de las OR**: no existe, y no se promete.
14. La **corrección del kilometraje de origen**: propuesta escrita, sin
    implementar (`PROPUESTA_corregir_km_origen.md`).

---

## Cuándo se para la prueba

Sin discusión, en el momento:

- **La identificación del entorno falla** en cualquiera de las tres piezas
  (paso 9). Nada de «seguimos a ver qué pasa».
- **El repaso del DDL** encuentra un trabajo programado, una llamada
  saliente, una conexión a otra base o un disparador de DDL que no se haya
  comentado antes de restaurar.
- **Falta algún objeto** de los que la migración da por supuestos, o alguna
  función tiene una firma distinta de la de la tabla de arriba.
- **El volcado trae datos** (`COPY`) en vez de solo esquema.
- **La restauración de prueba no devuelve los mismos recuentos**.
- **La simulación escribe algo**: una sola fila o un número interno
  consumido.
- **Cambia algo que no debía**: montajes vivos, historial confirmado, stock,
  revisiones o `km_actual`.
- **El deshacer no deja la fotografía previa igual** sin un motivo escrito.
- **Aparece una ficha histórica en el inventario disponible.**
- **El panel de staging habla con producción** (el bundle lleva el proyecto
  equivocado) o el servidor apunta a otra base.

En cualquiera de esos casos: se para, se restaura el respaldo del paso 5 en
una base nueva y se avisa. La norma es probar lo que está bien, no terminar
la prueba pase lo que pase.

---

## Qué NO cubre este paquete

- **No crea nada de pago.** Los planes gratuitos dan para esto; el servicio
  gratuito de Render se duerme y el proyecto gratuito de Supabase se pausa
  tras una semana sin actividad.
- **No copia datos de producción**, ni anonimizados: no hay herramienta de
  anonimización para TyreControl y para esta prueba no hace falta.
- **No cubre las apps móviles**: las tres apps Flutter llevan el proyecto de
  producción escrito en el código, así que una build de pruebas seguiría
  apuntando a producción. Este PR no toca ningún fichero de `*_app/`.
- **No despliega.** `render.yaml` define un único servicio con `autoDeploy`
  sobre `main`; el segundo servicio lo crea una persona en el panel.

## Los tres rechazos, que no son el mismo

Medido contra el PostgREST local, llamando a `tc_imp_revisar_intervalo`:

| Quién | HTTP |
|---|---|
| sin cabecera `Authorization` | **401** |
| con la clave `anon` | **401** |
| operador autenticado de la empresa | **403** |
| administrador de **otra** empresa | **403** |
| administrador de la empresa | **200** |

Conviene reproducirlo igual en staging: que un 403 se convierta en 401, o al
revés, suele significar que la sesión no llega donde se cree.
