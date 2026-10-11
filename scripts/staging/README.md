# Entorno de pruebas separado (opción B: esquema real, datos sintéticos)

Esto es un **paquete de preparación**. Nada de aquí se ha ejecutado y nada se
ejecuta solo: los pasos que tocan algo fuera del repositorio los lanza una
persona autorizada, en el orden de abajo. No hay credenciales en ninguno de
estos ficheros y no debe haberlas.

Por qué la opción B y no levantar el esquema de las migraciones: producción
tiene unas 437 tablas en `public`, el repositorio solo conoce las de
`supabase/migrations/`, y hay tablas creadas a mano en el dashboard. Un
entorno construido desde el repositorio probaría que la migración se aplica
sobre el esquema *del repositorio*, que no es el que hay. Con el DDL real se
prueba contra la deriva real. **Solo el esquema: ni una fila de datos de
producción.**

---

## El orden

| # | Qué | Quién | Qué toca |
|---|---|---|---|
| 0 | Leer este fichero entero | — | nada |
| 1 | `01-volcar-esquema.sh` → DDL de producción, **solo esquema** | persona con credencial | lectura de producción |
| 2 | `02-revisar-ddl.sh` → qué trae ese DDL que no debe ejecutarse en pruebas | cualquiera | un fichero local |
| 3 | Crear el proyecto Supabase de pruebas | persona autorizada | Supabase |
| 4 | `03-levantar-staging.sh` → restaurar el DDL ya revisado | persona autorizada | base de pruebas |
| 5 | `semilla-staging.sql` → datos sintéticos con las configuraciones de la prueba | persona autorizada | base de pruebas |
| 6 | Copiar `variables-staging.env.example`, rellenar y desplegar | persona autorizada | Render + Supabase |
| 7 | `04-identificar-entorno.sh` → confirmar que panel, servidor y base son los de pruebas | cualquiera | lecturas |
| 8 | Las migraciones de la importación, en orden, y la prueba | persona autorizada | base de pruebas |

Los pasos 1, 3, 4, 5, 6 y 8 **están pendientes de vuestra autorización**. Los
pasos 2 y 7 son de lectura y se pueden ejecutar sin tocar nada.

---

## Antes de restaurar el DDL: lo que hay que mirar

Un `pg_dump --schema-only` de producción no es inerte. Puede traer cosas que,
restauradas en otra base, **salen al mundo o se disparan solas**. `02-revisar-ddl.sh`
las busca y las lista; estas son las que importan y por qué:

| Qué | Por qué no puede pasar a pruebas tal cual |
|---|---|
| `cron.schedule(...)` (pg_cron) | Un trabajo programado que se restaure en pruebas se ejecutará en pruebas. Si además llama a algo externo, lo llama de verdad. |
| `net.http_post(...)` / `net.http_get(...)` (pg_net) | Llamadas HTTP salientes desde la base. Son el mecanismo de los avisos y de las Edge Functions. |
| `dblink`, `postgres_fdw`, `CREATE SERVER`, `USER MAPPING` | Conexiones a otras bases. Una de ellas podría ser producción. |
| `CREATE EVENT TRIGGER` | Se dispara con cualquier DDL, incluido el del arranque de Express. |
| `CREATE PUBLICATION` / `SUBSCRIPTION` | Replicación. Una suscripción apuntando a producción es exactamente lo que no se quiere. |
| URLs y hosts dentro de funciones | Un `security definer` con una URL de producción escrita dentro sigue llamando a producción desde pruebas. |
| `ALTER ... OWNER TO` y roles que no existen | No es peligroso, pero hace fallar la restauración a mitad. Mejor saberlo antes. |

**Lo que hay que hacer con lo que salga**: comentarlo en el DDL antes de
restaurar, no después. El script escribe un fichero `.avisos` con el número de
línea de cada hallazgo para poder ir uno por uno.

---

## Comprobado en local: el servidor arranca con 20 variables

No es una suposición. `05-probar-arranque.sh` levanta el servidor con la lista
de abajo contra una base de pruebas y pide el PDF por el endpoint real:

```
OK    el servidor arranca y escucha en 4011
OK    ni pagos, ni mensajería, ni correo: sin credencial no se encienden
OK    sin token: 401 (falta sesión)
OK    con sesión de admin: 200 y un PDF de 7.723.727 bytes
```

Las **20 variables** con las que arranca, y no hace falta ninguna más:

`DATABASE_URL` · `PGSSLMODE` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` ·
`VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` · `NODE_ENV` · `PORT` · `TZ` ·
`PUBLIC_APP_URL` · `TYRE_CONTROL_WRITE_ENABLED` ·
`TYRE_CONTROL_REPAIR_SYNC_ENABLED` · `TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED` ·
`TYRE_CONTROL_SYNC_COMPANIES` · los seis `*_STORAGE_LOCAL`.

**Y una que hizo falta arreglar en el código.** El servidor NO arrancaba sin
`STRIPE_SECRET_KEY`: el cliente de Stripe se construía en el propio arranque
con la clave vacía y la librería lanza al instante, así que el proceso entero
se caía antes de escuchar. Dejar la variable sin definir no resolvía nada,
resolvía lo contrario. Ahora el cliente se crea la primera vez que se usa y
solo si la clave existe: con clave, el comportamiento es el de siempre; sin
ella, el servidor arranca, los tres sitios que cobran responden 503 y **no hay
cliente de Stripe, así que no puede salir ni una llamada**.

Lo que el propio arranque dice que deja apagado, con esa configuración:

```
[webfleet-sync] sin credenciales Webfleet: servicio no iniciado
CheckPoint por correo: apagado (faltan las credenciales del buzón)
Therefore buzón: apagado (faltan las credenciales del buzón)
Recepciones buzón: apagado (faltan las credenciales del buzón)
```

Y sin credencial tampoco se encienden Stripe, Twilio, SMTP, OpenAI (la lectura
de partes responde 503), Movertis, Business Central, Firebase ni Google Maps.

### Qué más necesita el entorno, además de las variables

Dos cosas que en Supabase pone la plataforma y que un entorno montado a mano
puede no tener. Las dos se descubrieron levantando el servidor de verdad:

1. **`service_role` tiene que saltarse la RLS** (`alter role service_role
   bypassrls`). El endpoint del PDF lee con la service key; sin eso devuelve
   «Parte no encontrado» en pruebas y funciona en producción, que es la peor
   forma de enterarse.
2. **`anon` y `authenticated` necesitan los permisos de tabla** que dan los
   *default privileges* del esquema `public`. Sin ellos, cualquier RPC
   `security invoker` responde «permission denied for table …». Lo que
   protege los datos es la RLS, no la ausencia de GRANT.

En un proyecto Supabase recién creado las dos vienen de serie; en una base
restaurada a mano, hay que comprobarlas.

## Los tres rechazos, que no son el mismo

Medido contra el PostgREST local, llamando a `tc_imp_revisar_intervalo`:

| Quién | HTTP | Qué significa |
|---|---|---|
| sin cabecera `Authorization` | **401** | no hay sesión |
| con la clave `anon` | **401** | sigue sin haber sesión de usuario |
| operador autenticado de la empresa | **403** | hay sesión, no hay permiso |
| administrador de OTRA empresa | **403** | hay permiso, pero no sobre esta empresa |
| administrador de la empresa | **200** | |

Conviene reproducirlo en staging tal cual: que un 403 se convierta en 401, o
al revés, suele significar que la sesión no está llegando donde se cree.

## El arranque de Express también cambia el esquema

Esto no es un detalle: `server/index.ts` ejecuta `prepararEsquema(...)` al
arrancar, con `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS` sobre
la base a la que apunte `DATABASE_URL`. **Arrancar el servidor ya modifica la
base.** Un `npm start` con el `.env` equivocado delante hace DDL en producción
sin que nadie haya pedido una migración.

Así que antes de arrancar, siempre:

```bash
# 1. ¿A qué base apunta lo que voy a arrancar? Sin enseñar la contraseña.
node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.hostname, u.port, u.pathname)'

# 2. ¿Y esa base es la de pruebas? Lo dice ella misma, no yo.
psql "$DATABASE_URL" -At -c "select current_setting('mobilink.entorno', true)"
```

`03-levantar-staging.sh` **marca la base de pruebas** con
`alter database ... set mobilink.entorno = 'pruebas'`. Esa marca es la
comprobación que sí sirve: el nombre de la base se puede repetir, el número de
tablas también, y `current_database()` no distingue dos bases llamadas igual en
servidores distintos. Producción no tiene esa marca y no se le va a poner.

---

## Las variables: las que hacen falta, no las 34

Copiar las 34 variables del servicio de producción sería meter en pruebas las
credenciales de Stripe, Twilio, los buzones IMAP y el ERP. La prueba de la
importación histórica **no usa ninguna de ellas**.

`variables-staging.env.example` lleva la lista mínima, con valores de pruebas
y los interruptores que apagan lo que puede salir al mundo. Resumen:

- **Imprescindibles**: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `PORT`, `NODE_ENV`, `TZ`,
  `PUBLIC_APP_URL`. Las dos de `SUPABASE_*` sin prefijo son **de arranque**: el
  servidor no levanta sin ellas (`server/supabase.ts`).
- **Apagadas a propósito**: `TYRE_CONTROL_WRITE_ENABLED=false`,
  `TYRE_CONTROL_REPAIR_SYNC_ENABLED=false`,
  `TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED=false`,
  `TYRE_CONTROL_SYNC_COMPANIES=` (vacío = ninguna empresa).
- **Sin definir, nunca con el valor de producción**: `STRIPE_*`, `TWILIO_*`,
  `SMTP_*`, `*_IMAP_*`, `OPENAI_*`, `WEBFLEET_*`, `MOVERTIS_*`, `BC_*`,
  `IH_SECRET__*`, `FIREBASE_*`, `GOOGLE_MAPS_API_KEY`. Sin credencial, cada
  integración se queda fuera de servicio, que es lo que se busca: lo que no
  está configurado no puede cobrar, ni enviar un WhatsApp, ni vaciar un buzón.
- **Al disco, no a Storage**: `CASH_STORAGE_LOCAL=1`, `RECEPCIONES_STORAGE_LOCAL=1`,
  `OR_MANUALES_STORAGE_LOCAL=1`, `TACOGRAFOS_STORAGE_LOCAL=1`,
  `THEREFORE_STORAGE_LOCAL=1`, `SELF_STORAGE_STORAGE_LOCAL=1`.

Para la prueba de la importación histórica, el PDF se pide por
`GET /api/tyrecontrol/parte/:id/pdf`, que **devuelve el PDF en la respuesta y
no escribe en Storage**. El que sí escribe es `/pdf/enlace`, y no hace falta.

---

## Identificar el entorno: referencias y destinos, no recuentos

`04-identificar-entorno.sh` comprueba lo único que de verdad distingue un
entorno de otro: **a dónde apunta cada pieza**.

1. **Panel**: el bundle servido tiene que llevar dentro el subdominio del
   proyecto Supabase de pruebas (`VITE_SUPABASE_URL` se compila dentro del
   JavaScript). Si el bundle lleva el subdominio de producción, el panel está
   hablando con producción aunque la URL del sitio sea la de pruebas. Esto es
   lo que hay que mirar, y es un `grep` sobre el bundle.
2. **Servidor**: `GET /api/health` devuelve `{ok, version, commit}` con el
   commit desplegado (8 caracteres, de `RENDER_GIT_COMMIT`). Tiene que ser el
   commit que se quiere probar, y el host tiene que ser el de pruebas.
3. **Base**: la marca `mobilink.entorno = 'pruebas'` que pone
   `03-levantar-staging.sh`, más el subdominio del proyecto en la cadena de
   conexión. `current_database()` y el número de tablas **no valen**: dos
   bases pueden llamarse igual y tener el mismo recuento.

Si cualquiera de las tres falla, se para. No se sigue «por ver qué pasa».

---

## Las migraciones de la importación, cuando el entorno esté identificado

En este orden y cada una en su transacción:

1. `supabase/migrations/tyrecontrol_importacion_historico.sql`
2. `supabase/migrations/tyrecontrol_importacion_historico_fase2.sql`
3. `supabase/migrations/tyrecontrol_importacion_historico_fase3.sql`

Las tres son idempotentes: se pueden volver a aplicar. La 2 necesita la 1 y la
3 necesita las dos.

### Las firmas reales de las RPC de este PR

Esto importa porque `create or replace function` con una firma distinta **crea
una segunda función** en vez de sustituir la primera, y entonces PostgREST
responde `PGRST203` («Could not choose the best candidate function») a todas
las llamadas. Antes de aplicar, hay que comprobar que lo que ya existe en la
base tiene exactamente estas firmas. Son las del diff, verbatim:

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

Dos cosas que conviene decir con precisión, porque es fácil contar de más:

- **Ninguna migración de este PR hace `drop function`.** No hay ni uno en el
  diff: todas las redefiniciones son `create or replace` **sobre la misma
  firma**, y las funciones nuevas de la fase 3 no existían antes. El riesgo de
  `PGRST203` no viene de este PR; viene de que la base real pueda tener hoy
  una de las funciones de la lista con otra firma por deriva del SQL Editor. Por
  eso se comprueba antes, no porque la migración vaya a duplicar nada.
- **`tc_imp_anotar_bloqueado` devuelve `uuid`** (el vehículo cuya cadena hay
  que rehacer), no `void`. Es nueva en la fase 3; se dice porque cambiar el
  tipo de retorno de una función que ya existiera sí exigiría un `drop`, y si
  alguien aplicó una versión anterior de la fase 3 tendría que hacerlo.

Las tres funciones de inventario y la vista `tc_marcas_contadores` son las
únicas que la migración **redefine habiendo sido escritas antes por otra
migración**. Si en la base real tienen un cuerpo distinto al del repositorio,
la migración se lo lleva por delante. Antes de aplicar:

```bash
psql "$DATABASE_URL" -At -c "select pg_get_functiondef(p.oid) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
   ('tc_informes_inventario_por','tc_informes_inventario_marca_medida','tc_informes_inventario_resumen')" \
  > /tmp/inventario-antes.sql
psql "$DATABASE_URL" -At -c "select pg_get_viewdef('tc_marcas_contadores'::regclass, true)" \
  >> /tmp/inventario-antes.sql
```

Ese fichero **es** la vuelta atrás de esa parte. Y la comprobación de que la
redefinición hace lo que debe es funcional, no «el fichero no se ha tocado»:
`scripts/importacion-historico/comprobar-inventario.sh`.

---

## Qué NO cubre este paquete

- **No crea nada de pago.** Los planes gratuitos de Supabase y Render dan para
  esto, con dos límites conocidos: un proyecto gratuito de Supabase se pausa
  tras una semana sin actividad, y un servicio gratuito de Render se duerme.
- **No copia datos de producción.** Ni anonimizados: no hay herramienta de
  anonimización para TyreControl, y para esta prueba no hace falta.
- **No cubre las apps móviles.** Las tres apps Flutter llevan el proyecto de
  producción escrito a mano en el código, así que una build de pruebas
  seguiría apuntando a producción. Este PR no toca ningún fichero de `*_app/`,
  así que para esta validación no es bloqueante; para cualquier cambio con
  parte móvil, sí lo sería.
- **No despliega.** `render.yaml` define un único servicio con
  `autoDeploy: true` sobre `main`. Un segundo servicio apuntando a la rama lo
  crea una persona en el panel.
