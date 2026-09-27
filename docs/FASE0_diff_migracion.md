# Diff exacto: migración de Fase 0, revisión 1 → revisión 2

Generado con `git diff` sobre `supabase/migraciones-preparadas/001_seguridad_fase0.sql`.
Revisión 1 = commit `c690d9f`. Nada de esto está aplicado.

## Resumen del cambio

| | Revisión 1 | Revisión 2 |
|---|---|---|
| Sección 1 · RLS | 88 tablas, sin saber cuántas existían | Igual, con nota: 42 sin RLS, 46 ya la tenían, 0 ausentes |
| Sección 2 · SEC-010 | `revoke` sobre `pres_records` y acuses | **Retirada.** Rompía `/portal/mi-ficha`. SQL corregido en `003_` |
| Sección 3 · SEC-003 | Sustituía la política de `perfiles_usuario` | **Retirada.** Creaba una política que anulaba las reales por OR |
| Secciones 4-8 | — | Sin cambios |
| Cabecera | Cifras del repositorio | Cifras de producción, y qué cierra de verdad |

```diff
diff --git a/supabase/migraciones-preparadas/001_seguridad_fase0.sql b/supabase/migraciones-preparadas/001_seguridad_fase0.sql
index 3a061d4..f903491 100644
--- a/supabase/migraciones-preparadas/001_seguridad_fase0.sql
+++ b/supabase/migraciones-preparadas/001_seguridad_fase0.sql
@@ -1,6 +1,7 @@
 /*
  * ════════════════════════════════════════════════════════════════════════════
  *  FASE 0 DE SEGURIDAD — MIGRACIÓN PREPARADA, **SIN APLICAR**
+ *  Revisión 2 · corregida contra la fotografía real de producción (2026-09-26)
  * ════════════════════════════════════════════════════════════════════════════
  *
  * Este fichero NO está en `supabase/migrations/`: está en
@@ -8,31 +9,49 @@
  * despliegue automático. Se aplica a mano, con autorización explícita, y con el
  * plan de vuelta atrás de más abajo delante.
  *
- * Cierra cuatro agujeros del informe de seguridad que viven en la base de datos
- * y no en el código:
+ * ── QUÉ CAMBIÓ EN LA REVISIÓN 2 ────────────────────────────────────────────
  *
- *   SEC-002  88 tablas de `public` sin RLS, alcanzables con la clave pública que
- *            va embebida en las APKs. Entre ellas `central_api_tokens`, toda la
- *            caja, los expedientes de tacógrafos y los albaranes.
- *   SEC-010  `pres_records` y los acuses de documentos abiertos a `anon`:
- *            cualquiera leía los fichajes de todos y podía cambiar una hora de
- *            entrada o marcar un documento como firmado por otro.
+ * La revisión 1 se escribió leyendo el repositorio. Al contrastarla con el
+ * estado real de la base, dos de sus cinco secciones resultaron equivocadas y
+ * se han retirado. El detalle está en `docs/FASE0_correcciones.md`:
+ *
+ *   · SEC-010 (sección 2) fuera: el `revoke` sobre `pres_records` y los acuses
+ *     habría dejado sin servicio `/portal/mi-ficha`, que entra con la clave
+ *     `anon` y no por el servidor. Y retirar solo `anon` no cerraba el
+ *     hallazgo. Pasa a Fase 3. SQL preparado en `003_sec010_presencia_acuses.sql`.
+ *   · SEC-003 (sección 3) fuera: ya está corregido en producción con políticas
+ *     acotadas, y la política que esta migración creaba las habría anulado por
+ *     la semántica OR. Se retira entera.
+ *
+ * ── QUÉ CIERRA, ENTONCES ───────────────────────────────────────────────────
+ *
+ *   SEC-002  (PARCIAL) Tablas de `public` sin RLS, alcanzables con la clave
+ *            pública embebida en las APKs. La foto real son **188 tablas sin
+ *            RLS de 437**; esta migración cierra las **42** de la lista que
+ *            están sin RLS. Las otras 46 de la lista ya la tenían. Las 146
+ *            restantes se clasifican en `docs/FASE0_tablas_sin_rls.md` y van
+ *            en una migración de contención aparte. SEC-002 NO queda cerrado.
  *   SEC-004  `app_guardar_usuario` escribía `es_superadmin` sin comprobar que
- *            quien llama lo sea: un admin de módulo de una empresa cliente se
- *            hacía superadministrador de plataforma. Se cierra con un
- *            DISPARADOR sobre `app_usuarios`, no reescribiendo la función: ver
- *            la sección 4, que explica por qué reescribirla era imposible y
- *            además peligroso.
- *   SEC-005  `app_eliminar_usuario` es la misma causa raíz por otra superficie:
- *            `app_es_admin()` a secas, sin empresa y sin proteger a los
- *            superadministradores. El mismo disparador lo cubre, y la sección 5
- *            cierra además el borrado de la cuenta de Auth.
- *   SEC-003  La política de `perfiles_usuario` (`USING (true)` para cualquier
- *            autenticado) permitía escribirse `rol = 'admin'`.
+ *            quien llama lo sea. Se cierra con un DISPARADOR sobre
+ *            `app_usuarios`, no reescribiendo la función: ver la sección 4.
+ *   SEC-005  `app_eliminar_usuario` es la misma causa raíz por otra superficie.
+ *            El mismo disparador lo cubre, y la sección 5 cierra además el
+ *            borrado de la cuenta de Auth.
+ *   SEC-065  `app_login_email` contestaba a cualquiera con la clave pública.
+ *
+ * Y además endurece el `search_path` de las tres funciones de las que depende
+ * la autorización (sección 7) y crea las dos tablas que hacen falta.
  *
- * Y además: endurece el `search_path` de las funciones de las que depende la
- * autorización (hallazgo nuevo de la revisión, sección 7) y crea las dos tablas
- * que hacen falta: la de bajas de Auth y la de bloqueos de login.
+ * ── CIFRAS DE PRODUCCIÓN, NO DEL REPOSITORIO ───────────────────────────────
+ *
+ *   437 tablas en `public` · 249 con RLS · 188 sin RLS
+ *   132 funciones `SECURITY DEFINER`, las 132 sin `pg_temp`
+ *   180 de 187 funciones ejecutables vía `PUBLIC`
+ *   0 grants a `PUBLIC` sobre tablas
+ *   Las 437 tablas conceden CRUD completo a `anon` y `authenticated`
+ *
+ * Las cifras antiguas (88 tablas, ~170 funciones) eran del repositorio y se
+ * conservan solo como histórico de la auditoría.
  *
  * ── ANTES DE APLICARLA ─────────────────────────────────────────────────────
  *
@@ -61,9 +80,16 @@
 begin;
 
 -- ───────────────────────────────────────────────────────────────────────────
--- 1) SEC-002 · RLS en las tablas que no la tenían
+-- 1) SEC-002 · RLS en las tablas de la lista que no la tenían
 -- ───────────────────────────────────────────────────────────────────────────
 --
+-- Comprobado contra producción (2026-09-26): de las 88 de la lista, 42 están
+-- sin RLS y 46 ya la tienen (con cero políticas, que es el cierre completo).
+-- Para esas 46 esta sección es inocua. Ninguna de las 88 falta.
+--
+-- Las 146 tablas sin RLS que NO están en esta lista no se tocan aquí: van en
+-- la migración de contención, después de clasificarlas.
+--
 -- Sin políticas a propósito: a estas tablas solo llega el servidor, que usa la
 -- clave de servicio y no pasa por RLS. Activar RLS sin políticas es la forma
 -- correcta de decir «por PostgREST no se entra». Añadir políticas permisivas
@@ -194,96 +220,61 @@ alter default privileges in schema public revoke all on tables from anon;
 alter default privileges in schema public revoke all on tables from authenticated;
 
 -- ───────────────────────────────────────────────────────────────────────────
--- 2) SEC-010 · Fuera las políticas abiertas a `anon`
+-- 2) SEC-010 · SE SACA DE LA FASE 0 (ver `003_sec010_presencia_acuses.sql`)
 -- ───────────────────────────────────────────────────────────────────────────
 --
--- Las migraciones 007-009 endurecieron `pres_login` pero nunca retiraron estas
--- políticas, así que la puerta de al lado siguió abierta: con la clave pública
--- se listaban todos los fichajes, se cambiaba una hora de entrada o se marcaba
--- un documento como firmado en nombre de otro empleado. Eso es registro de
--- jornada y evidencia de firma.
+-- Aquí había un `revoke` sobre `pres_records` y los acuses, con el argumento de
+-- que «las apps de Presencia y Safety entran por /api/presencia-operator/*».
 --
--- Las apps de Presencia y Safety no se quedan sin nada: entran por
--- `/api/presencia-operator/*`, que va por el servidor.
-
-drop policy if exists "pres_anon_select" on pres_records;
-drop policy if exists "pres_anon_insert" on pres_records;
-drop policy if exists "pres_anon_update" on pres_records;
-revoke all on pres_records from anon;
-
-do $$
-begin
-  if to_regclass('public.sm_document_acknowledgements') is not null then
-    execute 'drop policy if exists "sm_ack_anon_select" on sm_document_acknowledgements';
-    execute 'drop policy if exists "sm_ack_anon_insert" on sm_document_acknowledgements';
-    execute 'drop policy if exists "sm_ack_anon_update" on sm_document_acknowledgements';
-    execute 'revoke all on sm_document_acknowledgements from anon';
-  end if;
-end $$;
+-- La fotografía de producción del 2026-09-26 demostró que ese argumento era
+-- FALSO para la web. `/portal/mi-ficha` (src/pages/PortalFicha.tsx) y
+-- `/portal` (src/pages/PortalLogin.tsx) hablan con Supabase DIRECTAMENTE con la
+-- clave `anon`: leen `pres_records`, lo actualizan al fichar la salida, y crean
+-- y modifican filas de `sm_document_acknowledgements`.
+--
+-- Aplicar aquel `revoke` habría dejado sin servicio el portal del empleado.
+--
+-- Y el otro lado tampoco estaba cubierto: las políticas `pres_auth_all` y
+-- `sm_auth_all` (`ALL to authenticated using (true)`) siguen dando acceso
+-- transversal a cualquier autenticado del proyecto, y el panel de Presencia
+-- depende de ellas. Retirar solo `anon` no cerraba SEC-010: lo dejaba a medias.
+--
+-- SEC-010 pasa a la Fase 3 con un rediseño que aísla por empleado y por
+-- empresa. En la Fase 0 queda **ABIERTO**, no mitigado y no cerrado: no existe
+-- ninguna restricción que se pueda aplicar hoy sin tirar el portal.
+--
+-- El SQL corregido, con los nombres reales de las políticas, está preparado en
+-- `003_sec010_presencia_acuses.sql`, que NO forma parte de esta migración y no
+-- se aplica hasta que el portal deje de entrar con la clave pública.
 
 -- ───────────────────────────────────────────────────────────────────────────
--- 3) SEC-003 · `perfiles_usuario` deja de ser escribible por cualquiera
+-- 3) SEC-003 · SE SACA DE LA FASE 0: ya está corregido, y esto lo empeoraba
 -- ───────────────────────────────────────────────────────────────────────────
 --
--- La política era `for all to authenticated using (true) with check (true)`.
--- Con ella, cualquier usuario autenticado del proyecto —incluido un operario de
--- otra app, porque el proyecto de Supabase es uno— podía escribir su propia
--- fila y ponerse `rol = 'admin'`. A partir de ahí, la Edge Function
--- `admin-update-user` le dejaba cambiar la contraseña de cualquiera.
---
--- Se separa lectura de escritura: leer sigue abierto a los autenticados (lo
--- usan las pantallas de almacén), y escribir pasa a ser solo de quien ya es
--- admin, sin poder tocar su propio rol.
-
-do $$
-begin
-  if to_regclass('public.perfiles_usuario') is null then
-    raise notice 'perfiles_usuario no existe en este proyecto, se salta';
-    return;
-  end if;
-
-  execute 'drop policy if exists almacen_solo_autenticados on perfiles_usuario';
-  -- Idempotente: sin estos tres `drop`, una segunda pasada moría con
-  -- «policy "perfiles_lectura" already exists». Comprobado ejecutándola dos
-  -- veces seguidas.
-  execute 'drop policy if exists perfiles_lectura on perfiles_usuario';
-  execute 'drop policy if exists perfiles_escritura_admin on perfiles_usuario';
-  execute 'drop policy if exists perfiles_alta_admin on perfiles_usuario';
-
-  execute $pol$
-    create policy perfiles_lectura on perfiles_usuario
-      for select to authenticated using (true)
-  $pol$;
-
-  -- Escribir: solo un admin activo, y el rol propio no se toca.
-  execute $pol$
-    create policy perfiles_escritura_admin on perfiles_usuario
-      for update to authenticated
-      using (
-        exists (
-          select 1 from perfiles_usuario p
-          where p.user_id = auth.uid() and p.activo and p.rol = 'admin'
-        )
-      )
-      with check (
-        exists (
-          select 1 from perfiles_usuario p
-          where p.user_id = auth.uid() and p.activo and p.rol = 'admin'
-        )
-      )
-  $pol$;
-
-  execute $pol$
-    create policy perfiles_alta_admin on perfiles_usuario
-      for insert to authenticated
-      with check (
-        exists (
-          select 1 from perfiles_usuario p
-          where p.user_id = auth.uid() and p.activo and p.rol = 'admin'
-        )
-      )
-  $pol$;
-end $$;
+-- Aquí había una sustitución de la política `almacen_solo_autenticados`
+-- (`for all to authenticated using (true)`) por tres políticas separadas.
+--
+-- Esa política YA NO EXISTE en producción. SEC-003 está corregido, y mejor de
+-- lo que esta migración proponía. Lo que hay hoy:
+--
+--   perfiles_usuario_select_propio_o_admin  SELECT  usuario_actual_es_admin() OR user_id = ...
+--   perfiles_usuario_insert_admin           INSERT  usuario_actual_es_admin()
+--   perfiles_usuario_update_admin           UPDATE  usuario_actual_es_admin()
+--   perfiles_usuario_delete_admin           DELETE  usuario_actual_es_admin()
+--
+-- La política `perfiles_lectura` que esta sección creaba era
+-- `for select to authenticated using (true)`. **Las políticas permisivas se
+-- combinan con OR**, así que habría anulado la restricción de
+-- `perfiles_usuario_select_propio_o_admin` y devuelto la lectura de TODOS los
+-- perfiles a cualquier autenticado del proyecto. Un arreglo de seguridad que
+-- reabre lo que ya estaba cerrado.
+--
+-- Queda pendiente, como hallazgo aparte y NO en esta migración, la política
+-- `anon_read_activos` (`SELECT to anon using (activo = true)`), que sí sigue
+-- viva. Su consumidor está identificado: `almacen_app` valida el código de
+-- operario leyendo `perfiles_usuario` con la clave `anon`. Retirarla sin
+-- sustituir ese flujo deja la APK sin poder validar a nadie. Ver
+-- `docs/FASE0_correcciones.md` §3.
 
 -- ───────────────────────────────────────────────────────────────────────────
 -- 4) SEC-004 y SEC-005 · nadie concede ni borra lo que no le corresponde
```
