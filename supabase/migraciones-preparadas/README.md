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

Esa última tardó dos intentos y merece quedar escrita: `revoke ... from anon` no
bastaba, porque PostgreSQL concede `EXECUTE` a `PUBLIC` en cada función que se
crea y `anon` hereda de `PUBLIC`. Hay que revocar de `PUBLIC` también. Es el
mismo patrón que el informe señaló en las 170 funciones `security definer` del
proyecto, y el motivo de comprobar las migraciones ejecutándolas en vez de
leerlas.
