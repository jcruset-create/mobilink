/*
 * SEC-010 · Fichajes y acuses — PREPARADO, **FUERA DE LA FASE 0**
 *
 * NO SE APLICA TODAVÍA. Aplicarlo hoy deja sin servicio `/portal/mi-ficha` y
 * `/portal`, que hablan con Supabase directamente con la clave `anon`.
 *
 * ── POR QUÉ ESTÁ AQUÍ Y NO EN LA FASE 0 ────────────────────────────────────
 *
 * La revisión 1 de la Fase 0 retiraba las políticas de `anon` con el argumento
 * de que las apps entran por `/api/presencia-operator/*`. Es cierto para las
 * APKs y FALSO para la web:
 *
 *   src/pages/PortalLogin.tsx   lee `sea_employees` con `anon` y **se descarga
 *                               `codigo_operario` al navegador** para
 *                               compararlo en el cliente;
 *   src/pages/PortalFicha.tsx   lee y actualiza `pres_records` con `anon`, y
 *                               crea y modifica `sm_document_acknowledgements`.
 *
 * Y el otro lado tampoco estaba cubierto: `pres_auth_all` y `sm_auth_all` son
 * `ALL to authenticated using (true)`, de las que depende el panel de
 * Presencia (src/modules/presencia/pages/Fichajes.tsx escribe, valida y borra
 * fichajes directamente).
 *
 * ── LA PROPIEDAD QUE FALTA ─────────────────────────────────────────────────
 *
 * Hoy NO existe ninguna identidad autenticada detrás del empleado: la sesión
 * del portal es un JSON en `localStorage` que el propio navegador escribe. No
 * hay `auth.uid()`, no hay JWT, no hay nada contra lo que escribir una política
 * de RLS. **Por eso SEC-010 no se puede cerrar con SQL solo.**
 *
 * ── PRECONDICIÓN DE CÓDIGO (Fase 3) ────────────────────────────────────────
 *
 * 1. El portal del empleado pasa a `/api/presencia-operator/*`, que ya existe y
 *    ya tiene `requirePresenciaEmployee`. El código de operario se valida en el
 *    servidor y no se descarga nunca al navegador.
 * 2. Los acuses pasan por un endpoint equivalente de Safety.
 * 3. El panel de Presencia pasa a leer y escribir por el servidor, o bien se
 *    acota con las políticas de abajo, que sí dependen de `auth.uid()`.
 *
 * Solo cuando 1 y 2 estén desplegadas puede aplicarse este fichero.
 */

begin;

-- ── 1) Fuera el acceso anónimo ─────────────────────────────────────────────
-- Nombres REALES, comprobados contra producción el 2026-09-26. La revisión 1
-- usaba `sm_ack_anon_*`, que no existe: los `drop` no fallaban, simplemente no
-- hacían nada, y las políticas permisivas se quedaban vivas.

drop policy if exists pres_anon_select on pres_records;
drop policy if exists pres_anon_insert on pres_records;
drop policy if exists pres_anon_update on pres_records;
revoke all on pres_records from public;
revoke all on pres_records from anon;

do $$
begin
  if to_regclass('public.sm_document_acknowledgements') is not null then
    execute 'drop policy if exists portal_anon_acks_select on sm_document_acknowledgements';
    execute 'drop policy if exists portal_anon_acks_insert on sm_document_acknowledgements';
    execute 'drop policy if exists portal_anon_acks_update on sm_document_acknowledgements';
    execute 'revoke all on sm_document_acknowledgements from public';
    execute 'revoke all on sm_document_acknowledgements from anon';
  end if;
end $$;

-- ── 2) Y fuera el «cualquier autenticado» ──────────────────────────────────
-- Esto es lo que la revisión 1 no tocaba, y sin lo cual SEC-010 seguía abierto:
-- un operario de cualquier app del proyecto podía leer todos los fichajes,
-- cambiar una hora de entrada y marcar un documento como firmado por otro.

drop policy if exists pres_auth_all on pres_records;
drop policy if exists sm_auth_all on sm_document_acknowledgements;

-- ── 3) Y en su lugar, acotado por empleado y por empresa ───────────────────
-- Cada operación con el alcance mínimo, en vez de un `using (true)` global.

create policy pres_lectura_propia on pres_records
  for select to authenticated
  using (
    employee_id = app_empleado_actual()
    or (app_es_admin() and app_empresa_de_empleado(employee_id) = app_empresa_actual())
  );

-- Insertar: el empleado se ficha a sí mismo; el administrador, a los suyos.
create policy pres_alta on pres_records
  for insert to authenticated
  with check (
    employee_id = app_empleado_actual()
    or (app_es_admin() and app_empresa_de_empleado(employee_id) = app_empresa_actual())
  );

-- Corregir un fichaje es cosa del administrador de su empresa, no del empleado:
-- que el interesado pueda reescribir su propia hora de entrada anula el valor
-- probatorio del registro de jornada.
create policy pres_correccion_admin on pres_records
  for update to authenticated
  using (app_es_admin() and app_empresa_de_empleado(employee_id) = app_empresa_actual())
  with check (app_es_admin() and app_empresa_de_empleado(employee_id) = app_empresa_actual());

create policy sm_acks_propios on sm_document_acknowledgements
  for select to authenticated
  using (
    employee_id = app_empleado_actual()
    or (app_es_admin() and app_empresa_de_empleado(employee_id) = app_empresa_actual())
  );

-- Firmar es un acto personal: solo el interesado crea su acuse, y una vez
-- firmado no se modifica (por eso no hay política de UPDATE sobre firmados).
create policy sm_acks_alta_propia on sm_document_acknowledgements
  for insert to authenticated
  with check (employee_id = app_empleado_actual());

commit;

/*
 * ── POSTCHECK ──────────────────────────────────────────────────────────────
 * Tiene que devolver CERO filas. Si devuelve alguna, queda acceso anónimo vivo.
 *
 *   select tablename, policyname, cmd
 *     from pg_policies
 *    where schemaname = 'public'
 *      and tablename in ('pres_records', 'sm_document_acknowledgements')
 *      and 'anon' = any(roles);
 *
 * Y estas dos tienen que dar todo en falso:
 *
 *   select has_table_privilege('anon', 'pres_records', 'select')            as a1,
 *          has_table_privilege('anon', 'pres_records', 'insert')            as a2,
 *          has_table_privilege('anon', 'pres_records', 'update')            as a3,
 *          has_table_privilege('anon', 'sm_document_acknowledgements', 'select') as a4,
 *          has_table_privilege('anon', 'sm_document_acknowledgements', 'insert') as a5,
 *          has_table_privilege('anon', 'sm_document_acknowledgements', 'update') as a6;
 *
 * Y no puede quedar ninguna política transversal:
 *
 *   select policyname from pg_policies
 *    where schemaname = 'public'
 *      and tablename in ('pres_records', 'sm_document_acknowledgements')
 *      and (qual = 'true' or with_check = 'true');
 *
 * ── LO QUE FALTA ANTES DE PODER APLICARLO ──────────────────────────────────
 *
 * `app_empleado_actual()` y `app_empresa_de_empleado(uuid)` NO EXISTEN todavía.
 * Son la pieza que traduce la identidad autenticada a empleado y a empresa, y
 * no se pueden escribir hasta saber cómo va a quedar el vínculo
 * `auth.users` → `sea_employees`, que hoy no existe: el portal no autentica.
 * Por eso este fichero está preparado y no aplicado.
 */
