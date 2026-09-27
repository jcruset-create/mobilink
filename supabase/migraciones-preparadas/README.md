# Migraciones preparadas, sin aplicar

> **Cifras de referencia, actualizadas el 2026-09-26.** Las operativas son las
> de producción; las del repositorio se conservan solo como histórico de la
> auditoría.
>
> | Magnitud | Auditoría (repositorio) | **Producción** |
> |---|---|---|
> | Tablas en `public` | no medido | **437** (249 con RLS, **188 sin**) |
> | Funciones `SECURITY DEFINER` | «~170» | **132**, las 132 sin `pg_temp` |
> | Funciones ejecutables vía `PUBLIC` | no medido | **180 de 187** |
> | Grants a `PUBLIC` sobre tablas | supuesto «los hay» | **0** |
>
> Esta migración es la **revisión 2**: se le han retirado las secciones de
> SEC-003 y SEC-010, que estaban equivocadas. Ver `docs/FASE0_correcciones.md`.


Lo que hay aquí **no se ejecuta solo**. Esta carpeta no es
`supabase/migrations/` a propósito: ningún despliegue la recoge.

Son los cambios de base de datos de la Fase 0 de seguridad, escritos para poder
revisarlos antes de tocar nada, con su verificación previa y su vuelta atrás.

## Orden

1. **`verificacion-previa.sql`** — solo lectura. Se ejecuta primero y **hay que
   mirar la salida**, no solo que no dé error. La consulta 1 es la importante:
   este repositorio solo conoce las tablas creadas en migraciones, y hay tablas
   creadas a mano en el dashboard cuyo estado no se puede saber leyendo el
   código. La lista de la migración es un suelo, no un techo.
2. **`001_seguridad_fase0.sql`** — los cambios. Cierra SEC-002 PARCIALMENTE (42 de las 188 tablas sin
   RLS alcanzables con la clave pública), SEC-010 (fichajes y acuses abiertos a
   `anon`), SEC-003 (`perfiles_usuario` escribible por cualquiera), SEC-004 y
   SEC-005 (las dos funciones que dejaban a un admin de empresa hacerse
   superadministrador o borrar uno), SEC-065 (`app_login_email` respondiendo a
   cualquiera), y crea la tabla de bloqueos de login.
3. **`001_seguridad_fase0_rollback.sql`** — la vuelta atrás, casi toda
   comentada a propósito. Léelo antes de usarlo: reabrir esas tablas es
   restaurar la vulnerabilidad, y lo que suele hacer falta es devolver el
   permiso de UNA tabla concreta.

## Orden de despliegue respecto al código

**Primero el código, después la migración.** El código de la Fase 0 funciona con
la base tal como está hoy:

- el freno de login usa `app_auth_intentos` si existe y, si no, funciona en
  memoria;
- el servidor ya no necesita que `app_login_email` sea pública.

Al revés no: si se aplica la migración antes de desplegar el código, el login
del hub se queda sin resolver el usuario, porque hoy el navegador llama a
`app_login_email` directamente.

## Revisión estática del 26-09-2026: cuatro defectos corregidos

La primera versión de esta migración tenía cuatro defectos. Los cuatro salieron
**ejecutándola**, no leyéndola, y por eso queda escrito aquí:

| Defecto | Cómo se vio | Corrección |
|---|---|---|
| `create or replace function` con un parámetro renombrado | El último parámetro real se llama `p_accesos` y la migración escribía `p_modulos`. PostgreSQL responde «cannot change name of input parameter» y habría abortado la migración entera | Ya no se reescribe ninguna función: la regla va en un disparador |
| Reescribir la función habría borrado lógica de negocio | Al comparar con el original: unicidad del nombre de usuario, «un empleado no puede tener dos cuentas», licencia de cada módulo que se añade, aforo de usuarios y la auditoría del aforo superado | Un disparador no toca el cuerpo, y además cubre cualquier camino de escritura |
| `revoke ... from anon` sobre TABLAS dejaba el acceso heredado de PUBLIC | `grant select on t to public` + `revoke all on t from anon` deja `has_table_privilege('anon','t','select')` en cierto | Se revoca de PUBLIC primero, en tablas y en funciones |
| No era idempotente | Una segunda pasada moría con «policy "perfiles_lectura" already exists» | `drop policy if exists` antes de cada `create policy` |

Y un hallazgo nuevo, que no estaba en el informe: todas las funciones
`security definer` del proyecto usan `set search_path = public`, y eso no
protege del esquema temporal. Reproducido con `app_es_admin()`: creando
`pg_temp.app_usuarios` con `es_superadmin = true`, la función devuelve cierto.
Con `set search_path = public, pg_temp` ya no. Requiere conexión directa a la
base (por PostgREST no se puede hacer DDL), así que es endurecimiento en
profundidad y no una escalada con la clave pública. La migración lo arregla en
las funciones de las que depende la autorización; el barrido de las 132 va con
SEC-043, en la Fase 3.

## Comprobado

Las tres se han ejecutado contra un PostgreSQL 16 local sobre un esquema mínimo
(`begin/commit`, sin errores). Además se ha comprobado el efecto, no solo la
sintaxis:

| Comprobación | Resultado |
|---|---|
| Un admin de módulo llamando a `app_guardar_usuario` con `p_es_superadmin := true` | falla: «Solo un superadministrador puede conceder el superadministrador» |
| El mismo editando la ficha de un superadministrador | falla |
| El mismo llamando a `app_eliminar_usuario` sobre un superadministrador | falla |
| Un alta normal sin superadmin | sigue funcionando |
| RLS en las tablas de la lista | activada |
| Permisos de `anon` sobre ellas | ninguno |
| Políticas de `anon` en `pres_records` | ninguna |
| `anon` ejecutando `app_login_email` | no puede |
| `anon` leyendo una tabla que estaba concedida a PUBLIC | no puede |
| Segunda pasada de la migración | sin error |
| Un admin de módulo escribiendo `es_superadmin = true` directamente en la tabla | falla |
| Un admin de la empresa A borrando un usuario de la B | falla |
| Un admin borrando a alguien de su empresa | funciona, y queda la baja apuntada con su empresa |
| Suplantación por tabla temporal tras endurecer el `search_path` | no entra |

Las 21 comprobaciones automatizadas están en
`server/seguridadMigracion.integration.test.ts`, que carga las funciones REALES
del repositorio sin reescribirlas, aplica esta migración y comprueba
comportamiento. Se ejecutan con `RUN_DB_TESTS=1`.

Esa última tardó dos intentos y merece quedar escrita: `revoke ... from anon` no
bastaba, porque PostgreSQL concede `EXECUTE` a `PUBLIC` en cada función que se
crea y `anon` hereda de `PUBLIC`. Hay que revocar de `PUBLIC` también. Es el
mismo patrón que la fotografía de producción midió en las 132 funciones `security definer` del
proyecto, y el motivo de comprobar las migraciones ejecutándolas en vez de
leerlas.

## Trazabilidad: superficies afectadas, sin inflar el número de hallazgos

Durante la Fase 0 aparecieron dos superficies que no estaban nombradas en el
informe. Ninguna recibe número nuevo, y conviene decir por qué.

### `app_eliminar_usuario` → **manifestación adicional de SEC-004 y SEC-005**

No es un hallazgo distinto. La causa raíz es la misma que ya está descrita en el
informe como RC-4, «un único admin indiferenciado»: `app_es_admin()` devuelve
cierto para cualquier `adm_usuarios.rol = 'admin'` de cualquier empresa, y la
función confía en ese sí sin mirar ni la empresa del objetivo ni si es
superadministrador.

Es exactamente lo que SEC-004 describe para `app_guardar_usuario` (escribir) y lo
que SEC-005 describe para los endpoints de reset (actuar sobre una cuenta ajena),
por una tercera superficie: desactivar y borrar. El vector, el requisito previo y
la corrección son los mismos. Numerarlo aparte inflaría la cuenta sin añadir
información: quien lea SEC-004 y SEC-005 ya sabe qué buscar.

Queda, por tanto, como **superficie adicional de SEC-004 (escritura de
`es_superadmin`) y SEC-005 (operar sobre una cuenta de otra empresa o de un
superadministrador)**, cubierta por el disparador de la sección 4 de la
migración y verificada en
`server/seguridadMigracion.integration.test.ts`.

### `eliminar-auth` sin relación usuario → empresa → **misma causa, corregido, no residual**

El endpoint `POST /api/administracion/usuarios/eliminar-auth` no podía comprobar
la empresa porque cuando le llega el turno la ficha ya se ha borrado. También es
RC-4 más RC-3 («el tenant se lee de la petición»), no un hallazgo nuevo. Lo que sí
era nuevo es que **no tenía corrección posible dentro del propio endpoint**, y por
eso se resolvió cambiando el flujo: el disparador apunta la baja con la empresa
que tenía la ficha, y el endpoint solo borra lo apuntado. Ver la sección 5 de la
migración y el apartado de abajo.

### El `search_path` de las funciones `security definer` → **sí es un hallazgo distinto**

Aquí la causa raíz es otra: no es «falta una comprobación» ni «el tenant viene
del cliente», es que el mecanismo de resolución de nombres de PostgreSQL permite
suplantar las tablas que lee una función con privilegios del definidor. No lo
cubre ningún hallazgo del informe: SEC-043 habla del permiso EXECUTE implícito,
que es un problema de *quién puede llamar*, no de *qué lee* la función cuando se
la llama.

Se propone numerarlo como **SEC-067**, con severidad MEDIA por su precondición:
hace falta una conexión directa a PostgreSQL, porque por PostgREST no se puede
ejecutar DDL. No es explotable con la clave publicable de las APKs.

## Orden exacto de despliegue y vuelta atrás de la Fase 0

### Despliegue

| Paso | Qué | Por qué en ese orden | Reversible con |
|---|---|---|---|
| 0 | Comprobar la URL del webhook en Twilio (ver `COMPROBACIONES-ENTORNO.md` §3) | La firma pasa a ser obligatoria: una URL con cadena de consulta empezaría a dar 403 a Twilio | — (es lectura) |
| 1 | Ejecutar `verificacion-previa.sql` y revisar la salida | Dice si la lista de tablas de la migración está completa y si el registro público está abierto | — (es lectura) |
| 2 | Mergear y desplegar **el código** | Funciona con la base tal como está hoy: el freno de login usa `app_auth_intentos` si existe y si no va en memoria; `eliminar-auth` exige superadministrador mientras no exista `app_bajas_auth` | `git revert` del merge |
| 3 | Mirar los logs 24-48 h buscando `[credencial] RECHAZADA` | Es lo que dirá si algún cliente no inventariado llamaba sin credencial | `git revert` de un solo commit (`669da6a`), que vuelve a modo observación |
| 4 | Aplicar `001_seguridad_fase0.sql` | Después del código, nunca antes: hoy el navegador llama a `app_login_email` directamente y la migración le quita el permiso | `001_seguridad_fase0_rollback.sql`, por secciones |
| 5 | Volver a ejecutar `verificacion-previa.sql` y comparar | Confirma el efecto: tablas sin RLS a cero, `anon` sin permisos, políticas de `anon` a cero | — |
| 6 | Desplegar las tres Edge Functions y añadir `ALERTAS_CRON_SECRET` | `alertas-email` responde 503 hasta que el secreto exista: es fail-closed a propósito | Volver a desplegar la versión anterior |

El paso 3 no es burocracia: es el único momento en que se puede descubrir un
consumidor que nadie recordaba, y el commit que lo permite revertir está aislado
justo para eso.

### Vuelta atrás, en orden de menor a mayor daño

1. **Un cliente da 401 que no debería** → `git revert 669da6a` (vuelve a modo
   observación, sigue registrando en el log). Un solo commit, sin tocar la base.
2. **Un alta o edición de usuario falla** → quitar los dos disparadores de
   `app_usuarios` (sección 3b del rollback). Inmediato, y no hay que restaurar
   ningún cuerpo de función porque la migración no reescribió ninguna.
3. **Una pantalla de almacén no puede escribir** → restaurar la política única de
   `perfiles_usuario` (sección 3 del rollback), mirando antes qué escritura era:
   lo que la política anterior permitía era ponerse `rol = 'admin'`.
4. **Una lectura concreta de un cliente dejó de funcionar** → devolver el permiso
   de ESA tabla (sección 1b), no de las 88.
5. **Reabrir todo** → sección 1, comentada a propósito. Restaura la
   vulnerabilidad; solo con una decisión explícita detrás.

---

## Ficha técnica de la migración

Lo que hay que poder consultar sin abrir el SQL.

### Precondiciones de ejecución

| Requisito | Por qué |
|---|---|
| Ejecutarla con un rol que pueda `alter table`, `create trigger` y `create function` en `public` | Normalmente `postgres` desde el editor SQL del dashboard |
| Ese mismo rol debe poder **leer** `app_usuarios` | Será el propietario de las funciones `security definer`, y con sus privilegios se leerá la tabla |
| El código de la Fase 0 ya desplegado | La migración quita a `anon` el permiso de `app_login_email`, y hoy el navegador la llama directamente. Al revés se rompe el login del hub |
| Haber ejecutado `verificacion-previa.sql` y leído la consulta 1 | La lista de tablas del fichero solo cubre las creadas en migraciones |
| Ventana en la que se pueda mirar el resultado | No es una migración de despliegue automático |

No hace falta parar el servicio. Todo son `alter`, `revoke`, `drop policy`,
`create policy`, `create trigger`, `create function` y `create table`: ninguna
operación reescribe datos ni toma bloqueos largos.

### Objetos que crea, con su propietario y su `search_path`

| Objeto | Tipo | `security definer` | Propietario esperado | `search_path` |
|---|---|---|---|---|
| `app_usuarios_guardia()` | función de disparador | **Sí** | el rol que aplica la migración (normalmente `postgres`) | `public, pg_temp` |
| `app_apunta_baja_auth()` | función de disparador | **Sí** | el rol que aplica la migración | `public, pg_temp` |
| `trg_app_usuarios_guardia_escritura` | disparador `before insert or update` | — | — | — |
| `trg_app_usuarios_guardia_borrado` | disparador `before delete` | — | — | — |
| `trg_app_usuarios_apunta_baja` | disparador `after delete` | — | — | — |
| `app_bajas_auth` | tabla | — | el rol que aplica la migración | — |
| `app_auth_intentos` | tabla | — | el rol que aplica la migración | — |

Las dos funciones son `security definer` porque tienen que leer `es_superadmin`
del que llama en cualquier contexto, incluido uno en el que la RLS de
`app_usuarios` no le dejara ver su propia fila. Ninguna ejecuta SQL dinámico, y
las dos llevan `pg_temp` nombrado al final, que es lo que impide suplantar
`app_usuarios` con una tabla temporal.

**Comprobar el propietario después de aplicarla:**

```sql
select p.oid::regprocedure as objeto, pg_get_userbyid(p.proowner) as propietario,
       p.prosecdef as security_definer, array_to_string(p.proconfig, ', ') as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('app_usuarios_guardia','app_apunta_baja_auth');
```

### Funciones cuyo `search_path` se endurece (y las que NO)

Solo tres, y a propósito: `app_es_admin`, `app_empresa_actual` y
`app_login_email`. Son las que deciden la autorización de esta fase. Las dos RPC
de usuarios (`app_guardar_usuario`, `app_eliminar_usuario`) **no** están, porque
quien decide ahora es el disparador, que ya lleva `pg_temp`: suplantar lo que
ellas leen no salta ninguna regla de seguridad. El barrido del resto va en la
migración propia de SEC-067, con inventario y pruebas.

La lista no filtra por `security definer`, y conviene saber por qué: el esquema
temporal se resuelve **por sesión**, no por privilegios, así que una función
`invoker` llamada desde el disparador también se podría suplantar.

### Grants: antes y después

| Objeto | Antes | Después |
|---|---|---|
| Las 42 de la lista que están sin RLS (de 88; las otras 46 ya la tenían) | RLS desactivada; `anon` y `authenticated` con los privilegios por defecto de Supabase (todo); alguna con grant a `PUBLIC` | RLS activada sin políticas; `revoke all` de `PUBLIC`, `anon` y `authenticated` |
| Privilegios por defecto del esquema `public` (tablas) | conceden todo a `anon` y `authenticated` en cada tabla nueva | revocados: una tabla nueva ya no nace abierta |
| `pres_records` | políticas `pres_anon_select/insert/update` para `anon`; grant `select, insert, update` a `anon` | sin políticas de `anon`; `revoke all` de `anon` |
| `sm_document_acknowledgements` | políticas de `anon` | sin políticas de `anon`; `revoke all` |
| `perfiles_usuario` | `almacen_solo_autenticados`: `for all to authenticated using (true) with check (true)` | `perfiles_lectura` (select, abierto a autenticados) + `perfiles_escritura_admin` (update, solo admins) + `perfiles_alta_admin` (insert, solo admins). **Sin política de delete**: los borrados pasan por el servidor |
| `app_login_email(text)` | `execute` a `anon` y `authenticated`, más el implícito de `PUBLIC` | `revoke` de `PUBLIC`, `anon` y `authenticated`. Solo el servidor |
| `app_bajas_auth`, `app_auth_intentos` | no existían | RLS activada; `revoke all` de `PUBLIC`, `anon` y `authenticated` |

**El orden importa:** `PUBLIC` se revoca primero. `revoke ... from anon` no
quita nada de lo concedido a `PUBLIC`, porque `anon` hereda de `PUBLIC`.
Comprobado en PostgreSQL 16 y con prueba automatizada.

### Operación de vuelta atrás

Está en `001_seguridad_fase0_rollback.sql`, casi todo comentado a propósito, y
ordenada de menor a mayor daño. Lo que conviene saber de memoria:

| Si pasa esto | Se hace esto | Coste |
|---|---|---|
| Un alta o edición de usuario falla | `drop trigger` de los dos disparadores de `app_usuarios` | Inmediato. **No hay que restaurar ningún cuerpo de función**, porque la migración no reescribió ninguna. SEC-004 y SEC-005 vuelven a quedar abiertos |
| Una pantalla de almacén no puede escribir | Restaurar la política única de `perfiles_usuario` | Reabre que cualquiera se ponga `rol = 'admin'` |
| Una lectura concreta de un cliente dejó de funcionar | Devolver el permiso de **esa** tabla, no de las 88 | Acotado |
| El login del hub falla | `grant execute on function app_login_email(text) to anon` | Señal de que se aplicó la migración antes del código |
| Hay que reabrirlo todo | Sección 1, comentada | Restaura la vulnerabilidad completa |

`app_bajas_auth` se puede dejar puesta sin coste. Si se borra, `eliminar-auth`
pasa a exigir superadministrador de plataforma: es el modo degradado, escrito a
propósito para no abrirse cuando la tabla falta.
