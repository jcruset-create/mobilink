/*
 * VUELTA ATRÁS de `001_seguridad_fase0.sql`.
 *
 * Existe porque un plan de vuelta atrás que no está escrito es un plan que no
 * se puede aprobar. Pero conviene decirlo claro:
 *
 *   **Ejecutar la sección 1 restaura la vulnerabilidad.** Deja otra vez 88
 *   tablas —caja, facturación, tokens de la API de Central, expedientes de
 *   tacógrafos— al alcance de la clave pública que va embebida en las APKs.
 *
 * Así que este fichero está pensado para usarse por partes, no de golpe. Si algo
 * se rompe después de aplicar la migración, lo primero es mirar QUÉ se ha roto:
 * casi siempre será una lectura concreta de una tabla concreta desde un cliente,
 * y entonces la respuesta correcta es devolver el permiso de ESA tabla (sección
 * 1b) y no abrir las otras 87.
 *
 * Nada de esto borra datos. Las funciones vuelven a su versión anterior, que
 * está en `supabase/migrations/administracion_fase11_usuarios_unificados.sql` y
 * `administracion_fase12_licencia_en_alta_usuario.sql`: para restaurarlas se
 * vuelven a ejecutar esos dos ficheros, que son idempotentes
 * (`create or replace`).
 */

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1b) RECOMENDADO: devolver el acceso a UNA tabla concreta
-- ───────────────────────────────────────────────────────────────────────────
--
-- Sustituir `la_tabla` y ejecutar solo esto. Es lo que hay que hacer si un
-- cliente dejó de funcionar por una lectura concreta.
--
--   alter table public.la_tabla disable row level security;
--   grant select on public.la_tabla to anon, authenticated;
--
-- Mejor aún: dejar la RLS activa y añadir una política que permita solo lo que
-- ese cliente necesita de verdad.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) NO RECOMENDADO: reabrir todas las tablas (restaura la vulnerabilidad)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Comentado a propósito. Descomentar solo con una decisión explícita detrás.
--
-- do $$
-- declare t text;
-- begin
--   for t in
--     select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
--        and not exists (select 1 from pg_policies p
--                        where p.schemaname = 'public' and p.tablename = c.relname)
--   loop
--     execute format('alter table public.%I disable row level security', t);
--     execute format('grant all on public.%I to anon, authenticated', t);
--   end loop;
-- end $$;
--
-- alter default privileges in schema public grant all on tables to anon;
-- alter default privileges in schema public grant all on tables to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Fichajes y acuses abiertos a anon otra vez
-- ───────────────────────────────────────────────────────────────────────────
--
-- Esto era la lectura y la ESCRITURA de los registros de jornada por parte de
-- cualquiera con la clave pública. Solo tiene sentido si se descubre que alguna
-- app entra por aquí y no por `/api/presencia-operator/*`.

-- grant select, insert, update on pres_records to anon;
-- create policy "pres_anon_select" on pres_records for select to anon using (true);
-- create policy "pres_anon_insert" on pres_records for insert to anon with check (true);
-- create policy "pres_anon_update" on pres_records for update to anon using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3) `perfiles_usuario`: volver a la política única
-- ───────────────────────────────────────────────────────────────────────────
--
-- Esta sí puede hacer falta de verdad si alguna pantalla de almacén escribe en
-- la tabla con la sesión del usuario y no por el servidor. Antes de ejecutarla,
-- merece la pena comprobar qué escritura es: lo que la política anterior
-- permitía era que cualquiera se pusiera `rol = 'admin'`.

-- drop policy if exists perfiles_lectura on perfiles_usuario;
-- drop policy if exists perfiles_escritura_admin on perfiles_usuario;
-- drop policy if exists perfiles_alta_admin on perfiles_usuario;
-- create policy almacen_solo_autenticados on perfiles_usuario
--   for all to authenticated using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 4) `app_login_email` ejecutable otra vez por la clave pública
-- ───────────────────────────────────────────────────────────────────────────
--
-- Hace falta si el login del hub se despliega SIN el cambio del servidor que
-- resuelve el usuario por su cuenta. Es la combinación que hay que evitar:
-- desplegar la migración antes que el código.

-- grant execute on function app_login_email(text) to anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5) Tabla de bloqueos de login
-- ───────────────────────────────────────────────────────────────────────────
--
-- Quitarla no rompe nada: el freno vuelve a funcionar en memoria del proceso,
-- que es como funciona hoy. Solo se pierde que los bloqueos sobrevivan a un
-- reinicio. No se borra por defecto porque no molesta a nadie.

-- drop table if exists app_auth_intentos;

commit;
