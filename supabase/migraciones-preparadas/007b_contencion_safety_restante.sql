/*
 * SEC-008 · CONTENCIÓN DE LAS NUEVE TABLAS `sea_*` RESTANTES
 * PREPARADA, **SIN APLICAR**
 *
 * Incremental sobre `007`, que ya está aplicada. **No vuelve a tocar las diez
 * tablas que 007 contuvo.**
 *
 * ── PRIMERO, LA GRAVEDAD REAL: NO HAY ESCRITURA ANÓNIMA AQUÍ ──────────────
 *
 * El postcheck de producción encontró estas nueve con `anon` conservando los
 * grants de INSERT, UPDATE y DELETE. Eso es cierto, y hay que decir también lo
 * que ese postcheck NO medía: **el grant no basta para escribir.**
 *
 * Las nueve tienen RLS activa y **ninguna política para `anon`** (la única
 * excepción es `sea_modules`, que tiene un SELECT). Comprobado contra
 * PostgreSQL 17.6 reproduciendo el caso exacto:
 *
 *   anon INSERT  ->  ERROR: new row violates row-level security policy
 *   anon UPDATE  ->  permitido, UPDATE 0   (ninguna fila visible)
 *   anon DELETE  ->  permitido, DELETE 0
 *
 * O sea: **estas nueve no son un agujero abierto hoy.** No son el caso de las
 * diez de 007, que sí tenían `ALL to anon using (true)` y sí se podían
 * modificar de verdad.
 *
 * Lo que son es una cerradura de menos. El día que alguien añada a una de
 * ellas una política de `anon` —como ya existe en `sea_modules`— el grant que
 * sigue puesto convierte esa política en escritura. Por eso se cierra: no por
 * urgencia, sino porque el permiso no tiene ninguna razón de ser.
 *
 * El error del postcheck era mío y queda corregido en `010_postchecks.sql`:
 * medía `has_table_privilege`, que es el grant, y lo presentaba como si fuera
 * la capacidad efectiva. Son dos cosas distintas y hay que medir las dos.
 *
 * ── QUÉ HAY EN ESTAS NUEVE ─────────────────────────────────────────────────
 *
 * Aunque hoy no sean escribibles, conviene saber qué protegen, porque explica
 * por qué no se deja el grant «hasta que haya tiempo»:
 *
 *   sea_roles            roles con su `permisos jsonb`: es el modelo de
 *                        autorización del módulo
 *   sea_company_modules  qué módulos tiene contratados cada empresa
 *   sea_signatures       firmas: `firma_url`, `hash` del documento firmado,
 *                        dispositivo e IP. Evidencia de firma
 *   sea_consents         consentimientos con fecha, dispositivo e IP.
 *                        Evidencia de RGPD
 *   sea_certifications   catálogo de certificaciones
 *   sea_audit_logs       la traza de auditoría del módulo
 *   sea_modules, sea_notifications, sea_suppliers
 *
 * Cuatro de ellas —roles, módulos contratados, firmas y consentimientos— son
 * autorización o evidencia. Un grant de escritura sobre la traza de auditoría
 * es, además, lo que permitiría borrar el rastro de lo demás.
 *
 * ── CONSUMIDORES ───────────────────────────────────────────────────────────
 *
 * **Ninguna de las nueve se usa en ninguna parte del repositorio.** No aparecen
 * en el panel, ni en las ocho APK, ni en el servidor, ni en las Edge
 * Functions, ni siquiera para leer. Solo existen en
 * `supabase/migrations/001_sea_core.sql`, que las crea.
 *
 * `sea_suppliers` sí se menciona en `server/recepciones/schema.ts`, pero en un
 * comentario que dice expresamente que NO se usa: el servidor tiene su propia
 * tabla de proveedores.
 *
 * Así que retirar la escritura de `anon` no tiene a quién romper.
 *
 * ── LO QUE NO TOCA ─────────────────────────────────────────────────────────
 *
 * · Ninguna política, ni de `anon` ni de `authenticated`. En particular,
 *   `sea_anon_modules_read` se queda: es la única lectura anónima de las nueve
 *   y no se sabe si algo futuro depende de ella.
 * · El `select` de `anon`, que no se retira.
 * · Las diez tablas de 007.
 * · `authenticated`, que conserva todo.
 */

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'sea_audit_logs', 'sea_certifications', 'sea_company_modules', 'sea_consents',
    'sea_modules', 'sea_notifications', 'sea_roles', 'sea_signatures', 'sea_suppliers'
  ] loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'La tabla % no existe, se salta', t;
      continue;
    end if;
    -- PUBLIC primero: `anon` hereda de PUBLIC. Hoy no hay ningún grant a
    -- PUBLIC sobre tablas, pero la línea no cuesta nada.
    execute format('revoke insert, update, delete on public.%I from public', t);
    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
end $$;

commit;

/*
 * ── POSTCHECK ──────────────────────────────────────────────────────────────
 * Está en `010_postchecks.sql`, bloque «POSTCHECK DE 007 + 007b», reescrito
 * para no asumir ningún número de tablas: compara el conjunto consigo mismo.
 *
 * ── VUELTA ATRÁS ───────────────────────────────────────────────────────────
 *
 * Esta migración solo retira grants, y solo a `anon` y a `PUBLIC`. La
 * restauración exacta sale de la fotografía previa (`009`), campo
 * `rollback_generado_grants`, filtrando estas nueve tablas.
 *
 * La restauración genérica, si hiciera falta y no se tuviera la fotografía:
 *
 *   grant insert, update, delete on
 *     sea_audit_logs, sea_certifications, sea_company_modules, sea_consents,
 *     sea_modules, sea_notifications, sea_roles, sea_signatures, sea_suppliers
 *     to anon;
 *
 * Devolver esto no reabre ninguna escritura efectiva —la RLS sigue negándola—,
 * así que su riesgo es menor que el de los rollbacks de 005, 007 y 008.
 */
