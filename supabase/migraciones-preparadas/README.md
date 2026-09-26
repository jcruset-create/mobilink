# Migraciones preparadas, sin aplicar

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
2. **`001_seguridad_fase0.sql`** — los cambios. Cierra SEC-002 (88 tablas sin
   RLS alcanzables con la clave pública), SEC-010 (fichajes y acuses abiertos a
   `anon`), SEC-003 (`perfiles_usuario` escribible por cualquiera), SEC-004 y
   SEC-005 (las dos funciones que dejaban a un admin de empresa hacerse
   superadministrador o borrar uno), SEC-065 (`app_login_email` respondiendo a
   cualquiera), y crea la tabla de bloqueos de login.
3. **`001_seguridad_fase0_rollback.sql`** — la vuelta atrás, casi toda
   comentada a propósito. Léelo antes de usarlo: reabrir las 88 tablas es
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
las funciones de las que depende la autorización; el barrido de las ~170 va con
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
mismo patrón que el informe señaló en las 170 funciones `security definer` del
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
