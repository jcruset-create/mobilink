# Procedimiento de staging del PR #492

Un solo documento, en orden. **Nada de esto se ha ejecutado** y nada se
ejecuta solo: los pasos marcados con 🔒 los lanza una persona autorizada.
No hay credenciales en ningún fichero de esta carpeta y no debe haberlas.

Tres documentos acompañan a este:

- [`QUE_HACE_FALTA.md`](QUE_HACE_FALTA.md) — lo que hay que aportar para
  empezar, y **dónde se configura cada cosa**. Ninguna clave se pide ni se
  escribe aquí.
- [`DIFERENCIAS_CON_PRODUCCION.md`](DIFERENCIAS_CON_PRODUCCION.md) —
  **staging no es una réplica de los permisos de producción**: en qué se
  diferencian y qué resultados de la validación no se pueden extrapolar.
- [`REGISTRO.md`](REGISTRO.md) — la plantilla donde se anota cada paso, su
  resultado y el SHA probado, cuando se autorice.

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
| 2b | **Ensayar la restauración** (PRELIMINAR, con stubs locales) | | `08-ensayar-restauracion.sh` |
| 3 | Crear el proyecto Supabase de pruebas | 🔒 | — (panel) |
| **★A** | **Inicializar el destino: identificar, comprobar que está vacía y MARCAR.** Una sola vez, antes de restaurar | 🔒 | `00-inicializar-destino.sh` |
| **★B** | **Comprobar el destino. Antes de restaurar, migrar, sembrar y arrancar.** Exige destino **y** marca | | `00-comprobar-destino.sh` |
| 4 | Restaurar el DDL y aplicar los **permisos por nombre** | 🔒 | `03-levantar-staging.sh` |
| 4b | Comprobar los permisos de la base de pruebas | | `10-comprobar-permisos.sh` |
| 5 | Respaldo y **prueba de restauración** | 🔒 | `06-respaldo-y-restauracion.sh` |
| 5b | Guardar y **probar** la vuelta atrás de inventario | | `07-guardar-vuelta-atras.sh` |
| 6 | Aplicar las **tres migraciones**, en orden (★B antes) | 🔒 | SQL Editor |
| 7 | Sembrar los datos sintéticos (★B antes) | 🔒 | `semilla-staging.sql` |
| 8 | Desplegar panel y servidor de la misma versión (★B antes) | 🔒 | — (Render) |
| 9 | **Identificar el entorno** ya desplegado: bundle, servidor y base | | `04-identificar-entorno.sh` |
| 10 | Comprobar el arranque y el PDF | | `05-probar-arranque.sh` |
| 11 | Simular, importar, medir, PDF, inventario, recarga y deshacer | 🔒 | abajo |

**★A y ★B no son el mismo control y no se pueden confundir.**

- **★A, inicialización**, se hace **una sola vez** sobre el proyecto recién
  creado: identifica el proyecto de pruebas autorizado y el destino de la
  conexión, rechaza producción sin llegar a conectarse, comprueba que la base
  está **vacía** (sin marca previa, sin tablas ni funciones `tc_*`), pide una
  confirmación escrita y **solo entonces pone la marca**
  `mobilink.entorno = 'pruebas'`. Antes de restaurar, no después.
- **★B, operaciones**, se repite **antes de cada** restauración, migración,
  siembra y arranque, y exige **las dos cosas**: destino autorizado **y**
  marca. Nunca pone la marca.

La marca no sustituye a la comprobación del destino —una marca se puede poner
en cualquier base— y el destino no sustituye a la marca: el proyecto correcto
puede tener una base que no es la que se preparó. Por eso ★B pide las dos, y
por eso poner la marca es un paso aparte que antes comprueba que la base está
vacía. **No se le pone la marca a una base para que pase el control.**

Los dos controles están probados, con sus rechazos incluidos:

```bash
bash scripts/staging/09-probar-controles.sh   # 10 casos, sobre bases locales de usar y tirar
```

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

## ★A Inicializar el destino — una sola vez, con el proyecto recién creado 🔒

```bash
DATABASE_URL=… \
REF_PRUEBAS=<subdominio de pruebas> REF_PRODUCCION=<subdominio de producción> \
bash scripts/staging/00-inicializar-destino.sh
```

Hace, en este orden:

1. **Identifica** el proyecto de pruebas autorizado (`REF_PRUEBAS`) y el
   destino de la conexión (`DATABASE_URL`). Si el host es el de producción, o
   no es ni el de pruebas ni local, **sale sin abrir conexión**: a producción
   no se le abre ni una sesión de lectura por error.
2. Mira `SUPABASE_URL` y `VITE_SUPABASE_URL` si están definidas (en este
   momento pueden faltar todavía) y avisa de credenciales externas.
3. **Comprueba que la base es nueva**: sin marca previa, sin tablas `tc_*`,
   sin funciones `tc_*`, y avisa si `public` ya tiene tablas.
4. Pide escribir `marcar como pruebas`. Cualquier otra respuesta cancela.
5. **Y solo entonces** ejecuta
   `alter database "…" set mobilink.entorno = 'pruebas'`.

Si cualquiera de esas comprobaciones falla, **no marca nada**. Producción no
tiene la marca y no se le pone.

## ★B Comprobar el destino — antes de restaurar, migrar, sembrar y arrancar

```bash
DATABASE_URL=… SUPABASE_URL=… VITE_SUPABASE_URL=… \
REF_PRUEBAS=<subdominio de pruebas> REF_PRODUCCION=<subdominio de producción> \
bash scripts/staging/00-comprobar-destino.sh
```

**Por qué va antes y no después.** El arranque de Express ejecuta DDL sobre
`DATABASE_URL` (`prepararEsquema`, en `server/index.ts`): `npm start` con el
`.env` equivocado delante **modifica la base** antes de que nadie haya pedido
ninguna migración. Identificar el entorno después del despliegue llega tarde,
porque para entonces ya está tocada. Lo mismo vale para restaurar y para
migrar.

Comprueba cuatro cosas y **sale con error a la primera que falle**:

1. **`DATABASE_URL`**: host, puerto y base, sin enseñar la contraseña. Si el
   host contiene el proyecto de producción, falla.
2. **La marca de la base**: `current_setting('mobilink.entorno')` tiene que
   decir `pruebas`. Es la segunda llave, no la única: el nombre de la base se
   repite y, con el esquema real restaurado, el número de tablas es idéntico
   al de producción, así que la marca distingue lo que el nombre no
   distingue — pero **no sustituye** a la comprobación del destino, que se
   hace igual. Este script **nunca pone la marca**; la pone ★A.
3. **`SUPABASE_URL` y `VITE_SUPABASE_URL`**: a qué proyecto va a hablar el
   servidor y qué se va a compilar en el panel.
4. **Lo que NO debería estar definido**: `STRIPE_SECRET_KEY`,
   `TWILIO_AUTH_TOKEN`, `SMTP_PASS`, `OPENAI_API_KEY`, `WEBFLEET_PASSWORD`,
   `MOVERTIS_TOKEN`, `BC_CLIENT_SECRET`, `FIREBASE_SERVICE_ACCOUNT`… Si hay
   credenciales externas en el entorno, avisa.

`05-probar-arranque.sh` lo ejecuta por su cuenta y **se niega a arrancar el
servidor** si no pasa. `03-levantar-staging.sh` lo ejecuta antes de restaurar.
`permisos-pruebas.sql` y `semilla-staging.sql` llevan además su propio
guardián dentro: si la base no está marcada, la transacción se para con un
`raise exception`, aunque alguien los lance a mano sin pasar por el script.

Probado en `09-probar-controles.sh`, con sus diez casos: base nueva sin marcar
rechazada; host de producción rechazado por los dos controles y sin conectar;
host desconocido rechazado; los dos ficheros SQL negándose en una base sin
marca; la inicialización marcando una base vacía y **negándose** sobre una ya
marcada, sobre una que ya tiene tablas `tc_*` y cuando no se escribe la frase
de confirmación; y, con la marca puesta, el control de operaciones rechazando
igualmente un `SUPABASE_URL` de producción y unas credenciales externas.

Después del despliegue se repite la comprobación, pero **la otra**: la del
paso 9, que mira el bundle servido, el commit del servidor y la base. Son
complementarias, no la misma: esta mira lo que se va a usar, aquella lo que
ya está desplegado.

## 4. Restaurar el DDL y poner los permisos 🔒

```bash
DATABASE_URL='postgresql://…' REF_PRUEBAS=… REF_PRODUCCION=… \
SUPABASE_URL=… VITE_SUPABASE_URL=… \
bash scripts/staging/03-levantar-staging.sh esquema-produccion.sql
```

La base **ya tiene que estar marcada** por ★A: el script empieza llamando a
★B, que exige destino autorizado **y** marca, y no sigue si falta cualquiera
de las dos. Después se niega si la base ya tiene tablas `tc_*`, restaura el
DDL, aplica `permisos-pruebas.sql` y pasa `10-comprobar-permisos.sh`. Aquí no
se marca nada: marcar es ★A, y va antes.

### Ensayo PRELIMINAR: ¿entra ese DDL en una imitación de proyecto nuevo?

```bash
DDL=esquema-produccion.sql BASE=banco_nuevo_supabase \
bash scripts/staging/08-ensayar-restauracion.sh
```

**Preliminar, y conviene no llamarlo de otra manera.** Crea una base
desechable con **stubs**: los roles `anon`/`authenticated`/`service_role`
creados a mano, los esquemas `auth`/`storage`/`extensions` vacíos, `pgcrypto`
y cuatro funciones `auth.*` escritas en el propio script. Un proyecto Supabase
de verdad trae GoTrue, Storage, Realtime, sus extensiones en el esquema
`extensions`, sus roles con sus atributos y sus *default privileges*. Lo que
falle aquí fallará allí; **lo que pase aquí todavía no está validado**. La
compatibilidad queda comprobada cuando el mismo DDL entra en el **proyecto
Supabase de pruebas**, en el paso 4, y no antes.

**Qué errores se dan por buenos.** Solo los de una lista escrita en el script,
conflictos concretos identificados de antemano y comprobados uno a uno.
«Ya existe» a secas no vale como excusa: que una tabla, una función o un tipo
ya existan en una base supuestamente nueva significa que la base no estaba
limpia o que el volcado trae algo repetido, y eso hay que mirarlo. Hoy la
lista tiene **una sola entrada**:

| Error tolerado | Por qué |
|---|---|
| `schema "public" already exists` | PostgreSQL crea `public` al crear la base y `pg_dump` emite su `CREATE SCHEMA` igualmente. Comprobado: el esquema resultante es el mismo con y sin ese error. |

Cualquier otro error **para la restauración** y el script sale con código 1.
Para añadir una entrada hay que escribir el motivo en el script, no ignorarlo.

Ensayado en local con el esquema completo (463 tablas, 256 funciones, 7
vistas, 304 políticas RLS, 86 triggers):

> restaurado · 1 error(es), todos de la lista de conflictos previstos

Y comprobado que el filtro no es un adorno: metiendo a propósito un
`create type` repetido en el DDL, el ensayo se para con
«1 error(es) que NO están en la lista de conflictos previstos».

### Lo que NO viaja en el volcado, y hay que poner aparte

Comprobado sobre la base restaurada, no supuesto:

| Qué | Por qué no viaja | Quién lo pone |
|---|---|---|
| **Permisos de tabla** de `anon` y `authenticated` (salen a **0**) | el volcado va con `--no-privileges`, y en Supabase vienen de los *default privileges* del esquema `public` | `scripts/staging/permisos-pruebas.sql`, **por nombre** (ver más abajo). Ni `grant ... on all ...` ni `alter default privileges` |
| **`bypassrls` de `service_role`** | es un atributo del ROL, y los roles son del clúster, no del volcado | el proyecto Supabase ya lo trae; en una base a mano, `alter role service_role bypassrls` |
| **Extensiones** | con `--schema=public` no viajan las de otros esquemas. El DDL usa `gen_random_uuid()` (214 veces) y `crypt()` (3), así que **`pgcrypto` tiene que estar habilitado ANTES de restaurar** | el panel de Supabase, o `create extension` |
| **Los roles** `anon`, `authenticated`, `service_role` | ídem: son del clúster | el proyecto los trae de serie |
| **Objetos de `auth`, `storage`, `cron`, `net`** | el volcado es solo de `public` | el proyecto trae `auth` y `storage`; `cron` y `net` se habilitan si hacen falta, y **para esta prueba no hacen falta** |
| **TODOS los datos**, incluidos los catálogos | `--schema-only` | `semilla-staging.sql` |

El catálogo merece un aviso aparte, porque no es evidente: **`tc_cat_servicios`
queda vacío**, y la importación valida cada servicio contra él. Sin esas doce
filas, **todos** los albaranes con servicios salen bloqueados. Comprobado:

```
sin catálogo:  {"estado": "bloqueado", "motivo": "Servicio desconocido: equilibrado"}
con catálogo:  {"estado": "se_crearia", "servicios": 1, …}
```

`semilla-staging.sql` las pone.

### Qué más necesita la base, además del DDL

Dos cosas que en Supabase pone la plataforma y que una base restaurada a mano
puede no tener. Las dos se descubrieron levantando el servidor de verdad:

1. **`service_role` tiene que saltarse la RLS** (`alter role service_role
   bypassrls`). El endpoint del PDF lee con la service key; sin eso devuelve
   «Parte no encontrado» en pruebas y funciona en producción.
2. **`anon` y `authenticated` necesitan permisos de tabla**: sin ellos,
   cualquier RPC `security invoker` responde «permission denied for table …».
   En un proyecto Supabase vienen de los *default privileges* de `public`,
   que abren el esquema entero. Aquí **no se copia eso**: los pone
   `permisos-pruebas.sql`, objeto por objeto. La sección siguiente explica
   qué concede y qué deja fuera.

### Los permisos: por nombre, no en bloque

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/staging/permisos-pruebas.sql
DESTINO_URL="$DATABASE_URL" bash scripts/staging/10-comprobar-permisos.sh
```

El banco local tenía, hasta ahora, un
`grant all on all tables/sequences/functions in schema public to anon,
authenticated, service_role` con sus `alter default privileges` detrás. Eso
abría **470 relaciones y 266 funciones** a los tres roles —módulos que esta
prueba ni toca incluidos— y hacía que cualquier objeto creado después naciera
igual de abierto, el arranque de Express incluido, que crea tablas. **Se ha
retirado.** La RLS no tapa ese agujero: no se aplica a las funciones, no se
aplica a las tablas que no la tienen activada y no se aplica a las vistas que
no son `security_invoker`.

En su lugar, `permisos-pruebas.sql` concede por nombre lo que usa esta prueba:

| Sección | Qué | Cuántos |
|---|---|---|
| 0 | `revoke execute ... from public` y retirada de los *default privileges* | — |
| 2 | Tablas que el panel solo **lee** | 21 |
| 3 | Tablas que el panel **lee y escribe** (todas con RLS y política) | 55 |
| 4 | Tablas que solo usa el **servidor** con la service key | 15 |
| 5 | **Excepción declarada**: `productos_neumaticos`, sin RLS, solo `select` | 1 |
| 5b | Vistas que se saltaban la RLS, pasadas a `security_invoker` | 3 |
| 6 | RPC del panel y RPC solo del servidor | 35 + 4 |
| 7 | Lo que ya conceden las **migraciones**, repetido tal cual | 91 |
| 8 | Auxiliares de las políticas RLS y de los valores por defecto | 14 |
| 9 | La auditoría de revisiones: `select` y nada más | 1 |
| 10 | Nueve comprobaciones que **paran la transacción** | — |

De dónde sale la lista: las llamadas `.from("…")` y `.rpc("…")` del panel y
del servidor, cruzadas con el catálogo de la base y con los `grant` de
`supabase/migrations`. El cruce lo rehace `10-comprobar-permisos.sh`, que
falla si el fichero se queda atrás; `generar-permisos.py` lo regenera.

**Lo que queda fuera a propósito:**

- `anon` **no recibe ninguna tabla ni vista**. Solo las seis funciones que las
  migraciones le conceden expresamente (el quiosco del operario y el login por
  correo).
- `clientes` no tiene RLS y **no se concede a nadie**.
- Los módulos Seguridad, Presencia, Caja, Asistencia y Administración no
  entran en esta prueba: sus páginas darán 403. Si hiciera falta alguna, se
  añade por nombre.
- Ninguna secuencia (todas las tablas concedidas tienen clave primaria uuid) y
  **ningún `alter default privileges`**.

**Dos hallazgos del esquema real, que esta prueba tapa pero el proyecto de
producción no:**

1. **`productos_neumaticos` no tiene RLS.** Viene del módulo Almacén, fuera de
   `supabase/migrations`, y el panel de TyreControl la necesita (el embed de
   la ficha del vehículo y `profundidadDibujoPorProducto()`, que lee el
   catálogo entero sin filtrar por empresa). Se concede `select` y nada más,
   como **excepción declarada** y con el motivo escrito. Si en el proyecto de
   pruebas llega igual desde el volcado, el aviso será el mismo: la decisión
   —ponerle RLS en el módulo Almacén o volver a declarar la excepción— es de
   quien autorice el staging.
2. **Tres vistas concedidas por las migraciones se saltaban la RLS**:
   `tc_marcas_contadores` (cuenta neumáticos de todas las empresas),
   `tc_tipos_plano_descuadrado` y `adm_ot_estado`. Ninguna es
   `security_invoker` ni filtra por empresa dentro, así que con permisos del
   dueño enseñan de más. En la base de pruebas se pasan a `security_invoker`.
   Eso **no cambia las migraciones ni producción**: queda anotado aquí para
   que lo decida quien corresponda.

`10-comprobar-permisos.sh` comprueba las cinco cosas que importan, en SQL y
—si se le dan `REST_URL` y `JWT_SECRET`— también por HTTP, que es como entra
el panel:

| Qué | Resultado en el banco local |
|---|---|
| RPC de escritura solo para los roles autorizados | `authenticated` **no** ejecuta `tc_imp_bloquear`, `tc_imp_exigir_admin` ni `tc_imp_medianoche` (403 por HTTP); `service_role` sí (204) |
| Funciones auxiliares sin ejecución pública | **0** funciones del esquema ejecutables por `PUBLIC`; los `tc_imp_intervalo_*` fuera del alcance de `anon` |
| Auditoría sin escritura desde la aplicación | `POST`, `PATCH` y `DELETE` sobre `tc_reconstruccion_revisiones` → **403** para `authenticated`; la escribe solo `tc_imp_revisar_intervalo`, que es `security definer` |
| Tablas sin RLS no expuestas | la única con permisos es la excepción declarada, y en solo lectura; `clientes` → **403**; `anon` no lee ninguna tabla ni vista |
| Aislamiento entre empresas | un usuario de otra empresa ve **0 de 580** vehículos y **0** intervalos; el control de la misma empresa ve 580 y 1.452 |

Con estos permisos, las **26 comprobaciones del panel** de la fase 3 siguen
en verde, revisiones incluidas: la escritura va por los RPC `security
definer`, así que no hace falta `insert` ni `update` en las tablas de la
reconstrucción.

> **Cuidado al leer estos resultados.** Estos permisos son **de pruebas**, y
> son **más estrictos** que los de producción, donde `anon` y `authenticated`
> reciben el esquema entero por los *default privileges*. Lo que aquí sale
> **cerrado no demuestra** que esté cerrado en producción; lo que aquí
> **funciona** sí funcionará allí. La excepción son los `revoke` que están en
> las **migraciones** —la auditoría de revisiones y los nueve auxiliares de la
> importación—, que viajan a los dos sitios, y la RLS, que es la que da el
> aislamiento entre empresas. El reparto exacto, resultado por resultado, está
> en [`DIFERENCIAS_CON_PRODUCCION.md`](DIFERENCIAS_CON_PRODUCCION.md). Y los
> dos hallazgos y los tres ajustes de aquí **no se llevan a producción con
> esta prueba**: son una revisión aparte.

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

| Función | Firma (de `pg_get_function_identity_arguments` en la base de pruebas) | Fase |
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
| `tc_imp_intervalo_duda_continuidad` | `(p_intervalo tc_reconstruccion_montajes)` → `boolean` | 3 |
| `tc_imp_intervalo_duda_km` | `(p_intervalo tc_reconstruccion_montajes)` → `boolean` | 3 |
| `tc_imp_intervalo_en_medias` | `(p_intervalo tc_reconstruccion_montajes)` → `boolean` | 3 |
| `tc_imp_intervalo_motivos` | `(p_intervalo tc_reconstruccion_montajes)` → `text[]` | 3 |
| `tc_imp_limite_km_dia` | `(p_empresa uuid)` → `numeric` | 3 |
| `tc_imp_medianoche` | `(p_fecha date)` → `timestamp with time zone` | 1 |
| `tc_imp_num` | `(p_valor numeric)` → `text` | 3 |
| `tc_imp_posiciones_norma` | `(p_vehiculo uuid, p_nuevas integer, p_una_referencia boolean)` → `uuid[]` | 1 |
| `tc_imp_reconstruir_vehiculo` | `(p_vehiculo uuid)` → `integer` | 2, redefinida en 3 |
| **`tc_imp_revisar_intervalo`** | **`(p_intervalo uuid, p_ambito text, p_decision text, p_motivo text)` → `jsonb`** | **3 · cuatro parámetros** |
| `tc_importar_historico` | `(p_empresa uuid, p_origen_sistema text, p_lote jsonb, p_simular boolean)` → `jsonb` | 1, redefinida en 2 y 3 |
| `tc_informes_inventario_marca_medida` | `(p_empresa uuid)` → `TABLE(marca text, medida text, total bigint)` | 2 (ya existía) |
| `tc_informes_inventario_por` | `(p_empresa uuid, p_dim text)` → `TABLE(etiqueta text, total bigint)` | 2 (ya existía) |
| `tc_informes_inventario_resumen` | `(p_empresa uuid)` → `jsonb` | 2 (ya existía) |
| `tc_informes_montajes` | `(p_empresa uuid, p_desde date, p_hasta date, p_origen text)` → `jsonb` | 2, redefinida en 3 |
| `tc_informes_recorridos_estimados` | `(p_empresa uuid, p_desde date, p_hasta date, p_vehiculo uuid)` → `jsonb` | 3 |

Son 29 funciones y **ninguna está duplicada** en la base de pruebas:

```sql
select p.proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (p.proname like 'tc_imp%' or p.proname like 'tc_informes_%')
 group by 1 having count(*) > 1;     -- no devuelve nada
```

Tres precisiones, porque es fácil contar de más:

- **`tc_imp_revisar_intervalo` tiene CUATRO parámetros**, no tres:
  `(p_intervalo uuid, p_ambito text, p_decision text, p_motivo text)`. El
  ámbito es lo que separa la decisión sobre los kilómetros de la decisión
  sobre la continuidad. **La versión de tres parámetros ya no existe**, y se
  ha comprobado llamando por PostgREST:

  | Llamada | Respuesta |
  |---|---|
  | `{p_intervalo, p_decision, p_motivo}` (la vieja) | **404 `PGRST202`** · «Searched for the function … with parameters p_decision, p_intervalo, p_motivo» |
  | `{p_intervalo, p_ambito:"kilometros", p_decision, p_motivo}` | **200** · `uso_estadistico: aceptado`, `continuidad_decision: pendiente`, `en_medias: false`, motivo `continuidad_pendiente` |
  | `{p_intervalo, p_ambito:"continuidad", p_decision, p_motivo}` | **200** · `continuidad_decision: aceptada`, `en_medias: true` |

  Un 404 `PGRST202` y no un 409 `PGRST203`: la función vieja **no está**, no
  es que haya dos candidatas. Que la llamada antigua falle es lo correcto; el
  panel ya llama con los cuatro.
- **La única función que se elimina en todo el PR es esa misma**, con su
  firma de tres parámetros, y la elimina la fase 3 justo antes de crear la
  nueva. Es una función de la propia fase 3, que no está desplegada en
  ninguna parte; el `drop` está por si alguien aplicó una versión anterior en
  una base de pruebas. Ninguna otra redefinición dropea nada: todas son
  `create or replace` sobre la **misma firma**.
- `tc_imp_anotar_bloqueado` devuelve `uuid`, no `void`.

### Y guardar la vuelta atrás de los informes de inventario

Las tres funciones de inventario y la vista `tc_marcas_contadores` son lo
único que la migración **redefine habiendo sido escrito por otra migración**.
Si en la base real tienen otro cuerpo, la migración se lo lleva por delante.

```bash
ORIGEN_URL="$DESTINO_URL" bash scripts/staging/07-guardar-vuelta-atras.sh vuelta-atras-inventario.sql
```

El fichero que sale es **ejecutable**, no un apunte. Dos cosas que no salen
solas y que antes faltaban:

- **`pg_get_viewdef` devuelve la CONSULTA de la vista, no una sentencia.**
  Pegar su salida en un `psql` no restaura nada: hay que envolverla en un
  `create or replace view … as …;`, y con sus `reloptions` si las lleva
  (`security_invoker`). `pg_get_functiondef`, en cambio, sí devuelve la
  sentencia completa.
- **Los permisos tampoco viajan.** Se reconstruyen desde `relacl` y `proacl`,
  un `grant` por línea. Sin ellos, restaurar la definición deja los objetos
  sin acceso para `anon`/`authenticated` y el panel deja de leer.

Y no se llama «vuelta atrás» hasta que se prueba en una base desechable:

```bash
bash scripts/staging/07-guardar-vuelta-atras.sh --probar vuelta-atras-inventario.sql <base_desechable>
```

El modo `--probar` guarda la huella de las definiciones **y** los permisos,
los **rompe** como lo haría la migración —mismo nombre, mismo tipo de
retorno, otro cuerpo, y los permisos revocados—, ejecuta el fichero y
comprueba que la huella vuelve a ser **exactamente** la de antes. Probado en
local sobre una copia del esquema completo:

```
huella antes:     ec9b53b7ca47d7ffda04567622084702
huella rota:      1448f2c4bb43d24017ac15f597062988
huella después:   ec9b53b7ca47d7ffda04567622084702
OK: el fichero devuelve las definiciones Y los permisos exactamente como estaban.
```

Si el `create or replace view` falla porque la vista nueva tiene **otras
columnas**, hay que borrarla antes (`drop view tc_marcas_contadores;`) y
mirar primero qué depende de ella. El fichero lo avisa en su cabecera.

Y la comprobación de que la redefinición hace lo que debe es funcional:
`scripts/importacion-historico/comprobar-inventario.sh`.

## 7. Los datos sintéticos 🔒

```bash
bash scripts/staging/00-comprobar-destino.sh   # ★B: destino Y marca
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/staging/semilla-staging.sql
```

Sembrar también pasa por ★B. Y el propio fichero **se niega** a sembrar una
base que no lleve la marca `mobilink.entorno`, aunque alguien lo lance a mano
saltándose el control. Lo
primero que pone son **las doce filas de `tc_cat_servicios`**: son datos, no
viajan en el volcado, y sin ellas la importación bloquea todos los albaranes
que lleven servicios. Después crea
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

## 9. Identificar el entorno YA DESPLEGADO

```bash
PANEL_URL=… SERVIDOR_URL=… DESTINO_URL=… REF_PRUEBAS=… REF_PRODUCCION=… \
COMMIT_ESPERADO=… bash scripts/staging/04-identificar-entorno.sh
```

Esta es la **segunda** comprobación, la de después del despliegue, y mira
cosas distintas de la del paso ★B: allí se miraba la configuración que se iba
a usar; aquí, lo que de verdad se ha desplegado. Las tres piezas, **por a
dónde apuntan**:

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
servidor ya modifica la base**, sin que nadie haya pedido una migración.

Por eso la comprobación obligatoria es la del paso ★B y va **antes** de
arrancar, no aquí. `05-probar-arranque.sh` la ejecuta solo y se niega a
levantar el servidor si no pasa.

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

Cada resultado se anota en [`REGISTRO.md`](REGISTRO.md) marcando de dónde
viene: **`[migración]`** si lo garantiza una migración (vale también para
producción) o **`[staging]`** si lo garantiza el entorno de pruebas (**no se
puede afirmar de producción**). Los criterios 1 a 14 son `[migración]`; el 15
y el 16 son del entorno. El detalle está en
[`DIFERENCIAS_CON_PRODUCCION.md`](DIFERENCIAS_CON_PRODUCCION.md).

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

**El entorno**

15. La base lleva la marca `mobilink.entorno = 'pruebas'`, **puesta por ★A
    sobre una base vacía y antes de restaurar**, y ★B se ha pasado antes de
    cada restauración, migración, siembra y arranque. Ninguna de las dos
    comprobaciones se ha saltado, y la marca no se ha puesto a mano.
16. Los permisos son los de `permisos-pruebas.sql` —concedidos por nombre—,
    y `10-comprobar-permisos.sh` sale en verde: sin `grant ... on all ...`,
    sin *default privileges*, sin funciones ejecutables por `PUBLIC`, con la
    auditoría en solo lectura y con el aislamiento entre empresas probado.

**Lo que no se exige, porque no está construido**

13. La **ingesta auditada de las OR**: no existe, y no se promete.
14. La **corrección del kilometraje de origen**: propuesta escrita, sin
    implementar (`PROPUESTA_corregir_km_origen.md`).

---

## Cuándo se para la prueba

Sin discusión, en el momento:

- **La comprobación del destino falla** (paso ★B): no se restaura, no se
  migra, no se siembra y no se arranca. Nada de «seguimos a ver qué pasa».
- **La base no está marcada y alguien propone marcarla a mano** para seguir.
  La marca la pone ★A sobre una base vacía, o no se pone.
- **La identificación del entorno desplegado falla** en cualquiera de las
  tres piezas (paso 9).
- **La restauración da un error que no está en la lista de conflictos
  previstos** de `08-ensayar-restauracion.sh`. No vale «es un “ya existe”,
  será inofensivo»: se mira qué objeto es y por qué estaba ya ahí.
- **`10-comprobar-permisos.sh` falla**, en cualquiera de sus apartados: en
  particular, si aparece una tabla sin RLS con permisos que no sea la
  excepción declarada, o si el aislamiento entre empresas no sale a cero.
- **La prueba de la vuelta atrás** (paso 5b) no devuelve la misma huella de
  definiciones y permisos.
- **`tc_cat_servicios` está vacío** cuando empieza la importación: todo lo
  que lleve servicios saldría bloqueado y el resultado no mediría nada.
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
- **No valida la compatibilidad del DDL por sí solo.** El ensayo del paso 2b
  es **preliminar**: corre contra stubs locales. La compatibilidad queda
  comprobada al restaurar en el proyecto Supabase de pruebas, en el paso 4.
- **No arregla los dos hallazgos de permisos** del esquema real
  (`productos_neumaticos` sin RLS, y tres vistas sin `security_invoker`
  concedidas por las migraciones), ni las 212 funciones que en producción
  siguen siendo ejecutables por `PUBLIC`. Aquí se tapan **para la base de
  pruebas** y quedan anotados en
  [`DIFERENCIAS_CON_PRODUCCION.md`](DIFERENCIAS_CON_PRODUCCION.md);
  cambiarlos en producción es **una revisión aparte**, con su propio análisis
  de impacto, y no entra en este PR.
- **No demuestra nada sobre los permisos de producción.** Staging es más
  estricto a propósito; ver el documento de diferencias antes de dar por
  buena cualquier conclusión sobre qué está cerrado allí.

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
