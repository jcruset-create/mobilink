# Runbook de despliegue — Fase 0 de seguridad

Rama `claude/mobilink-security-5ge9b1`, 21 commits sobre `origin/main` (`593ebd3`).
Versión `package.json`: 1.84.0.

**Nada de este documento se ha ejecutado.** Es el procedimiento, en orden, con
sus criterios de parada y su vuelta atrás.

Tres estados, y no se mezclan:

| Estado | Qué significa |
|---|---|
| **Cerrado en código/laboratorio** | Corregido en la rama, con pruebas que lo demuestran contra PostgreSQL real o por HTTP contra el servidor arrancado |
| **Preparado** | Existe la corrección y está probada en laboratorio, pero no se ha aplicado al entorno real |
| **Cerrado en producción** | Código desplegado, migración o configuración aplicada donde corresponda, y comprobación posterior confirmada |

Ningún hallazgo de esta fase está **cerrado en producción** todavía.

---

# FASE A · PRECHECK

Todo de solo lectura. Si algo sale NO-GO, no se continúa.

## A.1 Twilio — la URL del webhook

Es lo primero porque condiciona si se puede desplegar el código tal cual.

En la consola de Twilio: **Messaging → Senders / tu número de WhatsApp → «A
message comes in»**. Anotar la URL **literalmente**, sin interpretarla:

| Campo | Valor configurado | Lo que usa el servidor |
|---|---|---|
| Protocolo | | `https` siempre (lo construye el código) |
| Host | | el de `x-forwarded-host`, o `PUBLIC_APP_URL`, o `app.mobilink.es`, o `sea-tarragona.onrender.com` |
| Puerto | | ninguno (implícito 443) |
| Path | | `/api/whatsapp/inbound`, sin barra final |
| Query string | | **ninguna** |
| Método | | POST |

Dónde mirarlo en el código: el webhook de `server/index.ts` construye la lista
de candidatas y les añade `/api/whatsapp/inbound`. Como una de las candidatas
sale del host de la propia petición, la firma cuadra con el nombre por el que
Twilio llame de verdad.

**GO / NO-GO:**

- **GO** si la URL es `https://<host>/api/whatsapp/inbound`, sin query string, sin
  puerto explícito, sin barra final, método POST.
- **NO-GO si hay query string.** Twilio firma la URL completa incluyendo el `?…`,
  y el servidor la construye sin él: la firma no cuadraría y el webhook
  empezaría a devolver 403 a Twilio. Dos salidas: quitar la query string en
  Twilio, o hacer que el servidor incluya `req.originalUrl` en el cálculo. Hasta
  entonces **no se despliega el rechazo obligatorio**: se revierte el commit
  `a8a9a03` o se deja el webhook en observación.
- **NO-GO si el protocolo es `http`**. El servidor construye `https`.
- Si hay **varios Senders o números** apuntando al mismo webhook, todos tienen
  que cumplir lo anterior.

Lo que ya está comprobado desde fuera, y lo que no: `sea-tarragona.onrender.com`
responde 200 y sale por Cloudflare delante de Render;
`app.mobilink.es` resuelve a una IP que no es la de Render y no contestó al
health check. **Eso no dice cuál es la URL configurada**: la configuración de
Twilio hay que leerla en Twilio, no deducirla del DNS.

## A.2 Supabase — estado real de la base

Ejecutar `supabase/migraciones-preparadas/verificacion-previa.sql` contra
producción con un rol que lea los catálogos. Trece bloques; guardar la salida,
que es la referencia del postcheck.

| Bloque | Lo que hay que mirar | NO-GO si |
|---|---|---|
| 1 | Todas las tablas de `public` sin RLS | Aparecen tablas que **no** están en la lista de la migración: son las creadas a mano en el dashboard. Hay que decidir sobre ellas antes de aplicar |
| 2 | Qué puede hacer hoy `anon`/`authenticated` | — (es la foto del antes) |
| 3 | Políticas con `USING (true)` / `WITH CHECK (true)` | — (dimensiona la Fase 3) |
| 4 | Políticas abiertas a `anon` | — (las que se retiran) |
| 8 | Recuento: total, con RLS, sin RLS | — (la cifra del antes/después) |
| 9 | Privilegios concedidos a `PUBLIC` | — (importante: el `revoke` de `anon` no los quita) |
| 10 | Funciones por rol, `security definer`, sin `pg_temp` | — (dimensiona SEC-067) |
| 11 | Las `security definer` suplantables | — (inventario de SEC-067) |
| 12 | Buckets y visibilidad | — (SEC-023, Fase 3) |
| 13 | Si `authenticated` puede crear tablas temporales | Si es **falso**, SEC-067 baja de prioridad |

## A.3 Supabase Auth — configuración

Dashboard → Authentication. Solo lectura. Detalle de dónde mirar cada cosa en
`supabase/migraciones-preparadas/COMPROBACIONES-ENTORNO.md` §2.

| Qué | Para qué | NO-GO / alerta |
|---|---|---|
| **¿Registro público activo?** | Si lo está, SEC-008 sube a crítico inmediato: cualquiera se crea cuenta y las políticas `USING (true)` le dan los empleados con sus `pin_hash` | No bloquea la Fase 0, pero **reordena la Fase 3**: pasa a lo más urgente |
| Longitud mínima de contraseña | SEC-064 | — |
| Protección de contraseñas filtradas | SEC-064 | — |
| Rate limits de Auth | El login del hub va hoy directo a GoTrue, así que el freno del servidor no lo ve | — |
| MFA / TOTP disponible | Requisito de Fase 1C | — |
| TTL del access token | Hace viable la Alternativa A | — |
| Método de firma del JWT y JWKS | Decide cómo se verifica en Fase 1A | — |
| Claims reales (`aal`, `amr`, `session_id`) | **Bloquea el diseño de MFA.** Se leen decodificando un token propio | Si falta alguno, cambia el diseño de 1C |

## A.4 SEC-064 — lo que hay que saber antes de la Fase 1A

Sigue abierto. No es bloqueante de la Fase 0, pero sí de autorizar 1A:

1. ¿Hay algún superadministrador con clave corta heredada? (hoy toda contraseña
   del hub es `<lo que se teclea> + "#SEA"`, así que la entropía real es la del
   PIN);
2. ¿está el registro público habilitado?;
3. política mínima de contraseña actual;
4. rate limits reales de Auth;
5. ¿está disponible y activa la protección contra contraseñas comprometidas?

Los puntos 2-5 salen de A.3. El 1 se responde con la consulta 6 de la
verificación previa (cuántos superadministradores hay) más una decisión:
cualquiera que no haya cambiado la contraseña desde el alta la tiene corta.

## A.5 Repositorio contra producción

Comando en `COMPROBACIONES-ENTORNO.md` §1. Interesa la primera lista: tablas que
están en producción y no en ninguna migración. Son las que nadie ha revisado.

## A.6 Criterio GO global

Hay **tres bloqueantes distintos** y no se mezclan. Cada uno gobierna una fase
diferente, así que un NO-GO en uno no es un NO-GO en los otros.

### Bloqueante 1 · SEC-007 (Twilio) → gobierna la FASE B

Depende de A.1: la URL y el método configurados hoy en la consola de Twilio,
comparados campo a campo (https, host, puerto, path, query, método) con la URL
que el backend reconstruye, con resultado **COMPATIBLE**.

Afecta directamente a los commits `a8a9a03` y `f823973` (validación de firma del
webhook de WhatsApp): si la URL configurada no coincide con la reconstruida, la
firma no valida y el webhook empieza a devolver 403 en producción.

**No se cherry-pickea un subconjunto de Fase 0 para esquivar este dato.** Los 26
commits se despliegan juntos o no se despliegan: mientras A.1 no sea GO, la Fase
B entera está en NO-GO.

### Bloqueante 2 · Fotografía de Supabase → gobierna la FASE D

Depende de A.2 y A.4: la salida real de `verificacion-previa.sql` con tablas de
`public`, estado de RLS, grants efectivos de `anon`/`authenticated`/`PUBLIC`,
inventario de funciones, `SECURITY DEFINER`, `search_path`, políticas y objetos
que están en producción pero en ninguna migración.

**No se aplica ninguna migración sin esa evidencia**, ni adaptada ni parcial. RLS
y GRANT/REVOKE se evalúan como dos controles independientes: una tabla con RLS
activo puede seguir siendo legible por un grant a `PUBLIC`, y una tabla sin
grants puede quedar abierta por una política permisiva.

Este bloqueante **no afecta a la Fase B**: el código de Fase 0 está diseñado para
funcionar antes de la migración (el limitador degrada a memoria si
`app_auth_intentos` no existe).

### Bloqueante 3 · Configuración de Auth → gobierna la FASE 1A/1C, no la Fase 0

TTL de los JWT, JWKS y rotación de firma, claims de MFA, política de contraseñas,
signup público y visibilidad de buckets.

**Estos datos no entran en el GO/NO-GO de la Fase 0**, ni del código ni de la
migración. Se recogen para diseñar la Fase 1A (login por usuario) y la Fase 1C
(MFA) y su ausencia no debe contabilizarse como un impedimento de Fase 0.

### Resumen

| Fase | Bloqueante que la gobierna | Estado hoy |
|---|---|---|
| B · Despliegue del código | 1 (Twilio, A.1) | NO-GO: A.1 NO VERIFICADO |
| D · Migración SQL | 2 (Supabase, A.2/A.4) | **NO-GO por contenido**: la evidencia ya está (2026-09-26), y ha destapado defectos. Ver `docs/PRECHECK_fase0_supabase.md` §4 |
| 1A / 1C | 3 (Auth) | No aplica a Fase 0. Dos supuestos resueltos a favor: 2 superadmins con email de recuperación, 0 colisiones de username |

**Sobre el bloqueante 2, actualización del 2026-09-26.** Dejó de ser falta de
evidencia: la fotografía de Supabase está tomada. Lo que bloquea ahora es lo
que esa fotografía dice, y son tres cosas concretas:

1. La sección 3 de la migración **introduce una regresión** en
   `perfiles_usuario`: SEC-003 ya está corregido en producción con políticas
   acotadas, y la política `perfiles_lectura` que la migración crearía se
   combina con ellas por OR y devuelve la lectura de todos los perfiles a
   cualquier autenticado.
2. Los `drop policy` de `sm_document_acknowledgements` usan nombres que no
   existen (`sm_ack_anon_*` frente a los reales `portal_anon_acks_*`): no
   fallan, se quedan en nada.
3. SEC-010 quedaría cerrado a medias: las políticas `pres_auth_all` y
   `sm_auth_all` (`ALL to authenticated using (true)`) siguen abiertas.

Y el tamaño real del problema es otro: **188 tablas sin RLS**, no 88. La
migración cubre 42. Las 146 restantes incluyen `connect_api_keys`, `licenses`,
`payments` y `cobros`, todas con `anon` en CRUD completo.

Precondición nueva de la Fase D: producción va en **PostgreSQL 17.6** y la
migración se probó contra 16.13. Repetir las pruebas antes de aplicar.

El NO-GO global de hoy lo es **por falta de evidencia del entorno, no por un
fallo del código de Fase 0**, que está cerrado en laboratorio (334 ficheros de
test, 5755 tests, 0 fallos).

---

# FASE B · DESPLIEGUE DEL CÓDIGO

## B.1 Qué entra

21 commits, en este orden (el orden importa: los dos primeros son módulos de los
que dependen los demás).

| # | Commit | Qué |
|---|---|---|
| 1 | `ada924d` | `core/red.ts`: peticiones salientes con lista blanca de hosts |
| 2 | `c5a7f57` | `core/rateLimit.ts` + `trust proxy` |
| 3 | `a8a9a03` | WhatsApp: firma obligatoria ← **el que depende de A.1** |
| 4 | `c76135f` | Reset de contraseña acotado por empresa |
| 5 | `05ce493` | Licencias solo superadministrador |
| 6 | `32e9c22` | Cierra los endpoints sin credencial |
| 7 | `e1e68fd` | `exigirCredencial` en modo observación |
| 8 | `f823973` | El guarda de citas fija la decisión nueva |
| 9 | `669da6a` | Sin credencial → 401 ← **el revertible en caliente** |
| 10 | `e50fa0e` | Fuera «sea123»; secretos fuera de URL y logs |
| 11 | `dab6577` | El SSO deja de entregar contraseñas |
| 12 | `fdea8da` | Freno en los logins; SSRF de `files-from-url` |
| 13 | `a686cc2` | Edge Functions (código; **su despliegue es la Fase E**) |
| 14 | `ffe52f8` | Migración preparada (**no se aplica aquí**) |
| 15 | `0a31281` | Guardas de no regresión; versión 1.84.0 |
| 16 | `c7b2773` | Connect: un cc_admin no se hace superadministrador |
| 17 | `26985c7` | Revisión de la migración: cuatro defectos y SEC-067 |
| 18 | `240b1cd` | `eliminar-auth` autoriza contra la empresa apuntada |
| 19 | `e0e7a02` | Arnés de pruebas por HTTP |
| 20 | `d5f383c` | El registro de baja completo; `search_path` estrechado a tres funciones |
| 21 | `2e1327a` | Este runbook |

Merge a `main` → Render despliega solo (`autoDeploy: true`, rama `main`).

**Variables nuevas: ninguna obligatoria.** El código funciona con el entorno tal
como está. Opcional: `RESET_PASSWORD` fuera de producción (en producción el
endpoint contesta 410 y no la mira).

## B.1b Cómo se ejecutan las pruebas de esta fase

| Qué | Comando | Dónde corre |
|---|---|---|
| Unitarias y de integración (lo que ejecuta la CI) | `npm test` | Con `RUN_DB_TESTS=1` y `DATABASE_URL` para las de integración |
| Migración contra PostgreSQL real | `RUN_DB_TESTS=1 DATABASE_URL=… npx vitest run server/seguridadMigracion` | Carga las funciones REALES del repositorio, aplica la migración y comprueba comportamiento. 25 comprobaciones |
| Negativas por HTTP contra el servidor arrancado | `RUN_DB_TESTS=1 RUN_HTTP_TESTS=1 DATABASE_URL=… npx vitest run server/seguridadHttp` | **Fuera de la suite normal a propósito** |

El arnés HTTP lleva su propia variable porque arranca un servidor entero, con sus
catorce trabajos en segundo plano, contra la misma base que usan los demás
ficheros: que un fichero de pruebas monte un proceso que escribe en la base
compartida es algo que se pide a propósito, no algo que se herede de
`RUN_DB_TESTS`. Conviene darle una base propia. Su salida queda en un fichero del
temporal, para poder ver por qué no arrancó si algún día no arranca.

Un fallo aparte que salió por el camino: la primera versión del arnés **filtraba
el proceso del servidor**. Con `spawn("npx", …)` el árbol es sh → npx → node, y
matar al primero deja vivo al que hace el trabajo, así que cada ejecución olvidaba
un servidor hablando con la base. Se encontraron dos rondando. Ahora se lanza con
`detached` y se mata el grupo, y se comprueba que no queda ninguno.

Las tres mediciones, porque el diagnóstico costó dos intentos:

| Ejecución | Arnés | Huérfanos | Duración | Resultado |
|---|---|---|---|---|
| 1 | dentro de la suite | sí | no terminaba en 7 min | 1 fallo real (el guarda de `eliminar-auth`) |
| 2 | fuera | sí | **222,41 s** | 334 ficheros, 5.755 pruebas, 0 fallos |
| 3 | fuera | no | **218,55 s** | 334 ficheros, 5.755 pruebas, 0 fallos |

La línea base sobre `origin/main`, para comparar: 329 ficheros, 5.654 pruebas,
222 s. O sea que la Fase 0 añade 101 pruebas y no cuesta tiempo medible.

O sea: lo que ralentizaba la suite era el arnés corriendo dentro, no los
huérfanos. La fuga era un fallo real por sí mismo, pero no era la causa de la
lentitud, y atribuírsela habría mandado a la siguiente persona a buscar donde no
estaba.

## B.2 Health check

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/health        # 200
curl -s https://<host>/api/health                                          # cuerpo esperado
```

En los logs de Render, al arrancar, tiene que aparecer una de estas dos líneas:

```
[limites] app_auth_intentos no existe todavía: el freno de login funciona en memoria
[limites] bloqueos de login persistidos en app_auth_intentos
```

Antes de la Fase D será la primera. **Si no aparece ninguna**, el arranque se ha
quedado a medias: mirar el log completo.

## B.3 Smoke tests

Sin credenciales, desde cualquier sitio:

```bash
H=https://<host>
# 1) Lo que antes devolvía datos de clientes, ahora 401
for r in /api/jobs /api/techs "/api/roadside-assistances?includeClosed=true" /api/logs; do
  printf '%-45s %s\n' "$r" "$(curl -s -o /dev/null -w '%{http_code}' "$H$r")"   # 401
done
# 2) Los endpoints de IA y el borrado de historial
curl -s -o /dev/null -w 'analizar-impagado  %{http_code}\n' -X POST "$H/api/administracion/analizar-impagado"          # 401
curl -s -o /dev/null -w 'leer-albaran-pdf   %{http_code}\n' -X POST "$H/api/almacen/leer-albaran-pdf"                  # 401
curl -s -o /dev/null -w 'old-interrupted    %{http_code}\n' -X DELETE "$H/api/assigned-maintenance-tasks/old-interrupted" # 401
# 3) El reinicio total ya no acepta la contraseña que estaba en el código
curl -s -X POST "$H/api/reset" -H 'Content-Type: application/json' -d '{"password":"sea123"}' -w ' [%{http_code}]\n'   # 401 o 410
```

**NO se prueba el webhook de WhatsApp con un POST contra producción.** Un POST
sin firma queda registrado y, si algo fuera mal, se procesaría. Se comprueba
mirando los logs de Twilio (Monitor → Logs → Errors) en la Fase C.

Con credencial, desde el navegador de alguien del equipo:

1. Entrar en el panel de taller con el login del hub → tiene que cargar trabajos
   y técnicos como siempre;
2. Entrar con el login clásico (contraseña compartida) → igual;
3. Abrir un informe en PDF desde una asistencia → tiene que descargarse;
4. Descargar una copia de seguridad → pide la contraseña y descarga (y el
   fichero **ya no** trae `roadsideOperatorCode`);
5. En una APK de operario: entrar, listar asistencias y **subir una foto** (es la
   prueba del camino multipart);
6. Recobros: analizar la imagen de un impagado → tiene que funcionar con sesión;
7. Licencias: un superadministrador entra; un admin de empresa recibe 403 (es el
   cambio buscado).

## B.4 Rollback de la Fase B

| Situación | Acción | Alcance |
|---|---|---|
| Un cliente recibe 401 y no debería | `git revert 669da6a` y desplegar | Vuelve a modo observación: sigue registrando en el log, deja de rechazar. Un solo commit |
| Twilio empieza a dar errores de firma | `git revert a8a9a03` y desplegar | Vuelve a procesar sin exigir firma. **Reabre SEC-007**: hacerlo solo si el servicio está caído, y con A.1 en la mano |
| El panel no carga | `git revert dab6577` | Vuelve a entregar el token al navegador. Reabre SEC-006 |
| Algo peor | `git revert -m 1 <merge>` | Toda la fase |

Nada de la Fase B toca la base de datos, así que cualquier rollback es solo
código.

---

# FASE C · OBSERVACIÓN (24-48 h)

No es burocracia: es el único momento en que se puede descubrir un consumidor
que nadie recordaba, y el commit que permite revertirlo está aislado para eso.

## C.1 Qué mirar en los logs de Render

| Señal | Qué significa | Acción |
|---|---|---|
| `[credencial] RECHAZADA sin credencial válida: <método> <ruta>` | Alguien llamó sin identificarse. Si es un escáner de internet, es lo esperado. Si la ruta y el user-agent son de un cliente propio, hay un consumidor sin inventariar | Si es un cliente propio: **rollback de `669da6a`** y añadir su credencial antes de volver |
| `[whatsapp] firma de Twilio ausente o inválida` con las URLs probadas | Twilio no cuadra con ninguna candidata | Comparar con A.1. Si la URL tiene query string: rollback de `a8a9a03` |
| `[login] bloqueado <tipo> identidad=… ip=…` | El freno actuó | Normal si son intentos fallidos. Si bloquea a gente legítima en ráfaga, subir los topes de `core/rateLimit.ts` |
| `[files-from-url] URL rechazada (<motivo>)` | Se intentó descargar de un host no permitido | Si es un host legítimo, añadirlo a la lista de `core/red.ts` |
| `[eliminar-auth] app_bajas_auth no existe todavía` | Alguien intentó borrar una cuenta de Auth sin ser superadministrador, antes de la migración | Esperado. Se resuelve en la Fase D |
| `[limites] persistencia desactivada` | Falló la escritura del bloqueo | El freno sigue en memoria. Mirar la base |

## C.2 Qué vigilar funcionalmente

- **401/403 nuevos** en el panel, en cualquier pantalla. Especialmente:
  administración, licencias, Recobros, almacén, mantenimiento.
- **Subidas desde las APKs**: fotos de asistencia, escaneo de matrícula, firmas.
  Es el camino que se decidió no romper y por el que no se activó
  `AUTH_MODE=strict`.
- **WhatsApp entrante**: que sigan llegando mensajes y creándose borradores. En
  Twilio: Monitor → Logs → Errors, buscando 403 sobre el webhook.
- **Login del panel** por las dos vías (hub y contraseña clásica).
- **Descarga de PDF e informes**, que iban con el token en la URL.

## C.3 Qué obliga a rollback

**Rollback inmediato** (sin esperar):

1. Un cliente propio en `[credencial] RECHAZADA` → revertir `669da6a`.
2. Twilio devolviendo 403 sobre el webhook → revertir `a8a9a03`.
3. El panel no carga para nadie → revertir `dab6577`.
4. Las APKs no pueden subir ficheros → revertir toda la fase y replantear.

**No es rollback** (se corrige hacia delante):

- un escáner de internet en `[credencial] RECHAZADA`;
- un admin de empresa recibiendo 403 en licencias: es el cambio buscado;
- `[eliminar-auth] app_bajas_auth no existe todavía`: se resuelve en la Fase D;
- `[login] bloqueado` por intentos fallidos reales.

**Criterio para pasar a la Fase D:** 24 h sin ninguna señal de rollback, y
`[credencial] RECHAZADA` sin ninguna entrada atribuible a un cliente propio.

---

# FASE D · MIGRACIÓN SQL

Solo después de superar la Fase C.

## D.1 Precheck SQL

```
\i supabase/migraciones-preparadas/verificacion-previa.sql
```

Guardar la salida como «antes». Confirmar que la consulta 1 no ha cambiado desde
A.2 (si aparecen tablas nuevas, alguien ha creado tablas mientras tanto y hay
que decidir sobre ellas).

## D.2 Aplicar

```
\i supabase/migraciones-preparadas/001_seguridad_fase0.sql
```

Va toda en una transacción: si algo falla, no se aplica nada. La salida esperada
son `ALTER TABLE`, `REVOKE`, `DROP POLICY`, `CREATE POLICY`, `CREATE FUNCTION`,
`CREATE TRIGGER`, `CREATE TABLE`, `CREATE INDEX` y un `COMMIT` final, más avisos
`NOTICE` por cada tabla de la lista que no exista en el proyecto y por cada
función cuyo `search_path` se endurece.

**Si sale `cannot change name of input parameter`**: la migración que se está
aplicando no es la revisada. La versión correcta **no reescribe ninguna
función**.

## D.3 Postcheck — salida esperada

```sql
-- 1) Ninguna tabla de public sin RLS (o solo las que se hayan decidido dejar)
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;          -- esperado: 0

-- 2) anon sin permisos sobre lo que se ha cerrado
select count(*) from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','PUBLIC');                  -- esperado: mucho menor que antes

-- 3) Ninguna política de anon en los fichajes
select count(*) from pg_policies where tablename='pres_records' and 'anon'=any(roles);  -- esperado: 0

-- 4) app_login_email cerrada a la clave pública
select has_function_privilege('anon','app_login_email(text)','execute');        -- esperado: f

-- 5) Los disparadores existen y las funciones llevan pg_temp
select tgname from pg_trigger where tgrelid='app_usuarios'::regclass and not tgisinternal;
-- esperado: trg_app_usuarios_guardia_escritura, trg_app_usuarios_guardia_borrado,
--           trg_app_usuarios_apunta_baja
select p.proname, pg_get_userbyid(p.proowner) as propietario, array_to_string(p.proconfig,', ')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('app_usuarios_guardia','app_apunta_baja_auth',
       'app_es_admin','app_empresa_actual','app_login_email');
-- esperado: todas con `search_path=public, pg_temp`

-- 6) Las tablas nuevas, cerradas
select has_table_privilege('anon','app_bajas_auth','select'),
       has_table_privilege('authenticated','app_auth_intentos','select');       -- esperado: f, f
```

Y una prueba funcional, con una cuenta de prueba: un administrador de empresa
intenta marcarse `es_superadmin` desde la pantalla de usuarios → tiene que
fallar con «Solo un superadministrador puede conceder el superadministrador».

En los logs de Render, al siguiente reinicio, la línea de límites tiene que
pasar a `[limites] bloqueos de login persistidos en app_auth_intentos`.

## D.4 Criterios de rollback de la Fase D

| Síntoma | Acción | Sección del rollback |
|---|---|---|
| Un alta o edición de usuario falla | Quitar los dos disparadores de `app_usuarios` | 3b |
| Una pantalla de almacén no puede escribir | Restaurar la política única de `perfiles_usuario`, mirando antes qué escritura era | 3 |
| Una lectura concreta de un cliente dejó de funcionar | Devolver el permiso de **esa** tabla | 1b |
| El login del hub falla | `grant execute on function app_login_email(text) to anon` — y revisar: significa que el código no estaba desplegado | 4 |
| Hay que reabrirlo todo | Sección 1 (comentada). Restaura la vulnerabilidad | 1 |

El fichero es `001_seguridad_fase0_rollback.sql`. Está casi todo comentado a
propósito: se descomenta la sección que toque, no el fichero entero.

---

# FASE E · EDGE FUNCTIONS

Después de la migración, porque `admin-update-user` se apoya en que
`perfiles_usuario` ya no sea escribible por cualquiera.

## E.1 Secreto requerido

`ALERTAS_CRON_SECRET` en el proyecto de Supabase (Edge Functions → Secrets).
**Sin él, `alertas-email` responde 503 y no hace nada**: es fail-closed a
propósito, no un fallo.

## E.2 Despliegue

Las tres: `admin-create-user`, `admin-update-user`, `alertas-email`.

## E.3 Test positivo

```bash
curl -i -X POST "https://<proyecto>.supabase.co/functions/v1/alertas-email" \
  -H "x-alertas-cron-secret: <el secreto>"
# esperado: 200 con {ok:...}, o 200 con «Sin alertas activas»
```

Y quien dispare la función periódicamente tiene que empezar a mandar esa
cabecera, o dejará de funcionar.

## E.4 Test negativo

```bash
curl -i -X POST "https://<proyecto>.supabase.co/functions/v1/alertas-email"                     # 401
curl -i -X POST "https://<proyecto>.supabase.co/functions/v1/alertas-email" \
  -H "x-alertas-cron-secret: incorrecto"                                                         # 401
```

Y con `admin-update-user`, desde una sesión de un usuario **no** admin: tiene que
contestar 403 aunque ese usuario haya intentado escribirse `rol = 'admin'` en
`perfiles_usuario` (que después de la Fase D ya no puede).

---

# FASE F · CIERRE

Para cada hallazgo: estado antes, corrección, evidencia de laboratorio, evidencia
de producción y estado final. La columna de producción se rellena al ejecutar
este runbook; hoy está vacía a propósito.

| SEC | Estado antes | Corrección aplicada | Evidencia en laboratorio | Evidencia en producción | Estado final |
|---|---|---|---|---|---|
| **001** | ~50 rutas respondían sin credencial (`protectWhenStrict` era un `next()`) | `exigirCredencial`: acepta las tres familias que los clientes ya envían, rechaza la ausencia | 7 rutas → 401 y las 3 familias → entran (`seguridadHttp`, 24 pruebas); 4 guardas de fuente | B.3 smoke 1 + C.1 sin clientes propios | Cerrado en código/laboratorio |
| **002** | Exposición de tablas de backend: 188 sin RLS de 437, y CRUD global a `anon`/`authenticated` en las 437 | RLS + `revoke` de PUBLIC/anon/authenticated + privilegios por defecto | RLS activa y `anon` sin permisos, incluido el heredado de PUBLIC (`seguridadMigracion`) | D.3 consultas 1 y 2 | **Preparado, PARCIAL** (42 de 188) |
| **003** | `perfiles_usuario` escribible por cualquier autenticado; las Edge Functions preguntaban el rol al interesado | Código: rol leído con service role y solo por `user_id`. SQL: políticas separadas | Un no-admin no se autopromociona ni inserta fila admin (probado en PostgreSQL) | E.4 + D.3 | Código **cerrado en laboratorio**; SQL **preparado** |
| **004** | `app_guardar_usuario` escribía `es_superadmin` sin comprobar quién llama. **Superficie adicional: `app_eliminar_usuario`**, con el mismo patrón para desactivar y borrar | Disparador sobre `app_usuarios` (no se reescribe ninguna función): cubre las dos RPC y cualquier otro camino de escritura | 4 pruebas: ni por la RPC real, ni escribiendo la tabla, ni dando de alta a otro; y un superadmin sí puede | D.3 prueba funcional | **Preparado** |
| **005** | Dos endpoints reseteaban la contraseña de cualquier cuenta de Auth. **Superficies adicionales: `app_eliminar_usuario`** (desactivaba o borraba a cualquiera, superadministradores incluidos) **y `eliminar-auth`** (aceptaba cualquier id porque la ficha ya no existía) | Código: empresa y nivel comprobados, superadmin protegido, `eliminar-auth` consume una baja autorizada y de un solo uso. SQL: el mismo disparador | 3 pruebas de superadmin protegido + 3 de aislamiento entre empresas + 4 del registro de baja | B.3 smoke + D.3 | Código **cerrado en laboratorio**; SQL **preparado** |
| **006** | `login-sso` devolvía `ADMIN_PASSWORD` al navegador | Deja de devolver cualquier contraseña; el panel usa el Bearer que ya tiene | Barrido de respuestas sin la contraseña compartida; 2 guardas de fuente | B.3 pruebas 1-3 con credencial | **Mitigado** (cerrado en laboratorio; el login clásico se retira en 1B) |
| **007** | Firma de Twilio calculada y no exigida; `MediaUrl0` descargada con las credenciales de Twilio | 403 sin firma; medios solo de `api.twilio.com`; patrón de enlace cerrado | Webhook sin firma → 403; 19 pruebas de `fetchSeguro`; 5 del patrón de mapa | **A.1 primero**, y C.1 sin errores en Twilio | Cerrado en código/laboratorio, **con A.1 pendiente** |
| **009** | Un cc_admin de Connect se hacía superadministrador | Rol validado contra la lista del alta, filtro por central, no se cambia el rol propio | Guarda de fuente + typecheck | Prueba manual en el back office | Cerrado en código/laboratorio |
| **010** | Fichajes y acuses abiertos a `anon` para leer y escribir | `drop policy` + `revoke` | Ninguna política de `anon` ni permiso de tabla | D.3 consulta 3 | **Preparado** |
| **012** | 4 endpoints de IA y 1 DELETE sin middleware | `authenticate`/`requireModule`/`requireSupervisorRole` | 3 pruebas HTTP + 5 guardas | B.3 smoke 2 | Cerrado en código/laboratorio |
| **015** | Ningún límite en 8 logins con PIN de 4 dígitos | Freno por identidad y por origen, con bloqueo creciente | 13 pruebas del módulo + 2 por HTTP (429 al undécimo; otra identidad no bloqueada) | C.1 señal `[login] bloqueado` | **Mitigado** (hashear códigos y PIN ≥ 6 son de 1A) |
| **017** | `login-operario` de TyreControl no validaba el PIN y concedía todas las empresas | PIN verificado antes de responder; `upsert` detrás de la verificación | 2 guardas de orden | Prueba manual con la APK | Cerrado en código/laboratorio |
| **018** | Secretos en la URL y en los logs; backup con códigos de operario | `req.path`; contraseña en cabecera; columnas secretas fuera | 4 guardas | B.3 prueba 4 con credencial | Cerrado en código/laboratorio |
| **019** | Licencias accesibles a cualquier admin de empresa o con la contraseña compartida | `requireSuperadmin`, sin respaldo | Prueba HTTP: 403 con el token clásico | B.3 prueba 7 | Cerrado en código/laboratorio |
| **021** | `files-from-url` leía la red interna y publicaba el resultado | `fetchSeguro` con lista blanca; `kind` acotado | 2 guardas + las 19 de `fetchSeguro` | C.1 señal de URL rechazada | Cerrado en código/laboratorio |
| **025** | `RESET_PASSWORD = "sea123"` en el código | 410 en producción; env fuera de producción | Prueba HTTP: 410/503 con «sea123» | B.3 smoke 3 | Cerrado en código/laboratorio |
| **029** | `alertas-email` sin autenticación e inyección HTML | Secreto de cron obligatorio (503 sin él) y escape | Revisión de código | E.3 y E.4 | **Preparado** (requiere despliegue) |
| **033** | Rol de admin comprobado con la sesión del interesado; emparejamiento por email | Service role y solo por `user_id`; ubicación comprobada | Revisión de código | E.4 | **Preparado** (requiere despliegue) |
| **036** | `kind` sin sanitizar en la ruta del objeto | Patrón acotado | 1 guarda | — | **Mitigado** (el resto de subidas es de Fase 4) |
| **047** | Comparaciones de credencial con `===` | `safeEquals` | 1 guarda + las del módulo | — | Cerrado en código/laboratorio |
| **049** | Auditoría de licencias con `x-user-name` del cliente | Id del superadministrador que pasó el guard | Guarda de fuente | — | Cerrado en código/laboratorio |
| **053** | `mi-contexto` devolvía los talleres sin credencial | `requirePanelRole` | Prueba HTTP: 401 | B.3 smoke 1 | Cerrado en código/laboratorio |
| **065** | `app_login_email` respondía a la clave pública | `revoke` de PUBLIC, anon y authenticated | `anon` no puede ejecutarla | D.3 consulta 4 | **Preparado** |
| **067** (nuevo) | Funciones `security definer` con `search_path` incompleto, suplantables por `pg_temp` | Endurecidas las 3 de las que depende esta fase (de 132 reales, todas sin `pg_temp`) | Suplantación reproducida y bloqueada | D.3 consulta 5 | **Preparado** (el barrido de las 132 va en su propia migración) |
| **064** | Contraseña del hub = PIN corto + sufijo público | — | — | — | **Abierto**. Contención en A.3/A.4, solución en 1A |

## F.1 Qué queda después de este runbook

- **SEC-064** abierto, con la contención identificada y la solución en la Fase 1A.
- **SEC-067** con las tres funciones críticas endurecidas; el barrido de las 132
  necesita su propia migración con inventario y pruebas.
- Todo lo de las fases 1 a 6 del plan de remediación, sin empezar.
- Rotación de secretos: va **después** de la Fase 1A, no ahora. Rotar mientras la
  contraseña siga siendo el token solo invalida sesiones sin cerrar la vía.
- Las APKs no necesitan publicarse para nada de esta fase.
