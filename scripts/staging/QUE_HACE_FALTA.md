# Lo que hace falta para empezar staging

Lista corta de lo que tenéis que aportar. **Nada de esto se pide por el chat
ni se escribe en el repositorio**: cada valor va en el sitio que se indica, y
en este documento solo se nombran.

Una distinción que importa: los **identificadores** (el subdominio de un
proyecto, el nombre de un servicio, una región) no son credenciales y se
pueden decir en voz alta. Las **claves, contraseñas y cadenas de conexión**
no: se pegan directamente en el panel correspondiente.

---

## 1. Proyecto Supabase de pruebas

| Qué | Dónde se configura |
|---|---|
| Crear el proyecto (plan gratuito basta) | panel de Supabase → **New project** |
| `pgcrypto` **habilitada antes de restaurar** — el DDL usa `gen_random_uuid()` 214 veces y `crypt()` 3 | Supabase → **Database → Extensions** |
| La cadena de conexión (`DATABASE_URL`) | Supabase → **Project Settings → Database → Connection string**. Se pega en el fichero de variables de la máquina que ejecuta los scripts y en Render. **No por chat** |
| La `service_role key` y la `anon key` | Supabase → **Project Settings → API**. Se pegan en Render. **No por chat** |

**Lo único que necesito saber yo** son dos identificadores, que no son
secretos:

- `REF_PRUEBAS`: el subdominio del proyecto de pruebas (`xxxxxxxx` en
  `https://xxxxxxxx.supabase.co`).
- `REF_PRODUCCION`: el del proyecto de producción, **para descartarlo**. Los
  dos controles del destino lo usan para negarse a tocar producción.

## 2. Servicio Render separado

| Qué | Dónde se configura |
|---|---|
| Un **segundo** servicio, distinto del de producción | panel de Render → **New → Web Service**. `render.yaml` define solo el de producción, con `autoDeploy` sobre `main`; este se crea a mano |
| Rama a desplegar: la del PR, no `main` | Render → servicio → **Settings → Branch** |
| **Auto-Deploy apagado**, para que staging no se mueva solo | Render → servicio → **Settings → Auto-Deploy** |
| Las **20 variables mínimas**, y ninguna más | Render → servicio → **Environment**. La plantilla es [`variables-staging.env.example`](variables-staging.env.example) |
| Secretos de acceso (`ADMIN_TOKEN`, `ADMIN_PASSWORD`, `SUPERVISOR_PASSWORD`, `APP_PASSWORD`, `LICENSE_SECRET`): **valores nuevos**, nunca los de producción | Render → **Environment** |

Lo que **no** se copia del servicio de producción: Stripe, Twilio, SMTP, los
buzones IMAP, OpenAI, Webfleet, Movertis, Business Central, Firebase y Google
Maps. Sin credencial, cada integración se apaga sola, y eso es lo que se
busca. Comprobado en local: con esas 20 el servidor arranca y el endpoint del
PDF responde.

## 3. El esquema revisado

| Qué | Quién / dónde |
|---|---|
| El volcado `pg_dump --schema-only --no-owner --no-privileges` de `public` de producción | lo lanza una persona autorizada con `01-volcar-esquema.sh`. **Yo no leo producción** |
| El repaso del DDL (`02-revisar-ddl.sh`) y el visto bueno sobre lo que aparezca: trabajos de `pg_cron`, `net.http_post`, `dblink`/`postgres_fdw`, `event trigger`, replicación, URLs dentro de funciones | el fichero `.avisos` que deja el script, revisado antes de restaurar |
| Confirmar que los objetos y las **28 firmas de RPC** del procedimiento son los del esquema real | se compara con el DDL delante, en el paso 6 |

El fichero del volcado se queda en la máquina donde se ejecuta. **No se sube
al repositorio.**

## 4. Configuración para ejecutar los scripts

| Qué | Dónde |
|---|---|
| Copia de `variables-staging.env.example` rellenada | en la máquina que ejecuta los pasos, **fuera del repositorio** (el `.gitignore` no es la defensa: simplemente no se guarda ahí) |
| `REF_PRUEBAS` y `REF_PRODUCCION` exportadas | en la misma sesión donde se lanzan los scripts |
| `psql` y `pg_dump` de una versión compatible con el PostgreSQL del proyecto | máquina local |

## 5. La autorización, por escrito y por pasos

Hoy no está autorizado nada. Para empezar hace falta decir **cuáles** de
estas acciones quedan autorizadas, porque son distintas:

- [ ] crear el proyecto Supabase de pruebas y el servicio de Render
- [ ] volcar el esquema de producción (lectura de producción)
- [ ] restaurar ese esquema en la base de pruebas
- [ ] aplicar las tres migraciones en la base de pruebas
- [ ] sembrar los datos sintéticos
- [ ] desplegar el panel y el servidor de staging
- [ ] ejecutar la importación de prueba
- [ ] (aparte, y no antes) **merge** del PR

---

## Lo que NO hace falta, y conviene no dar

- **Ninguna clave ni contraseña por el chat.** Si algo falla por una
  credencial, el síntoma se describe y se corrige en el panel donde vive.
- **Ningún dato de producción**, ni anonimizado: la prueba va con datos
  sintéticos.
- **Las 34 variables del servicio de producción.** Son más de las que hacen
  falta y meterían pagos, mensajería y ERP en un entorno de pruebas.
- **Las apps móviles.** Las tres apps Flutter llevan el proyecto de
  producción escrito en el código: una build de pruebas seguiría apuntando a
  producción. Quedan fuera.

## Y antes de dar la prueba por buena

Léase [`DIFERENCIAS_CON_PRODUCCION.md`](DIFERENCIAS_CON_PRODUCCION.md):
**staging no es una réplica de los permisos de producción**, y hay resultados
que no se pueden extrapolar.
