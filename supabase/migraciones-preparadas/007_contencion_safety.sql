/*
 * SEC-008 (ampliado) · CONTENCIÓN DE ESCRITURA ANÓNIMA EN SAFETY
 * PREPARADA, **SIN APLICAR**
 *
 * ── QUÉ CIERRA ─────────────────────────────────────────────────────────────
 *
 * Diez tablas del módulo Safety tienen una política
 * `ALL to anon using (true) with check (true)`. Con la clave publicable que va
 * dentro de los APK se puede hoy **modificar y borrar**:
 *
 *   · el fichero de personal (`sea_employees`), con DNI, número de la
 *     Seguridad Social, domicilio y `pin_hash`;
 *   · los registros de formación (`sea_training_records`);
 *   · las certificaciones (`sea_employee_certifications`);
 *   · las autorizaciones para trabajos de riesgo
 *     (`sea_employee_authorizations`).
 *
 * Es decir: se puede **alterar la evidencia de habilitación del personal**. No
 * es solo una fuga de datos; es poder acreditar a alguien para una tarea de
 * riesgo, o desacreditarlo, sin dejar rastro de quién lo hizo.
 *
 * ── QUÉ **NO** CIERRA, Y HAY QUE DECIRLO ───────────────────────────────────
 *
 * **La lectura sigue abierta, a propósito.** `anon` podrá seguir leyendo el
 * DNI, el número de la Seguridad Social, el domicilio y el `pin_hash` de cada
 * empleado activo.
 *
 * No se cierra porque `/portal` y `/portal/mi-ficha` dependen de esa lectura y
 * no tienen ninguna otra forma de identificar al empleado: la sesión del portal
 * es un JSON en `localStorage`. Cerrarla aquí deja a la plantilla sin poder
 * fichar.
 *
 * La exposición de lectura queda **EXPRESAMENTE ABIERTA** hasta migrar el
 * login a identidad de servidor. Ver `docs/DEUDA_credencial_en_cliente.md`.
 *
 * ── POR QUÉ ESTO NO ROMPE NADA ─────────────────────────────────────────────
 *
 * Barrido estático del panel, de las ocho APK, del servidor y de las Edge
 * Functions (`docs/SEC-008_safety.md` §2):
 *
 *   · **ninguna de las ocho APK toca estas diez tablas**, ni para leer;
 *   · las únicas escrituras son del panel, que entra autenticado y pasa por
 *     `sea_auth_all`, que esta migración no toca;
 *   · las tres páginas que entran con `anon` —`/portal`, `/portal/mi-ficha` y
 *     `/sea`— solo hacen `select`;
 *   · no hay ninguna RPC que escriba en estas tablas, ni ninguna vista sobre
 *     ellas.
 *
 * ── CAMBIO DE COMPORTAMIENTO, DECLARADO ────────────────────────────────────
 *
 * Uno, y es intencionado: hoy `sea_anon_all` (`using (true)`) deja a `anon`
 * leer también los empleados **dados de baja**. Al retirarla, la lectura queda
 * en manos de `portal_anon_employees`, que es `activo = true`.
 *
 * O sea: `anon` deja de poder leer la ficha de un ex-empleado. Los dos
 * consumidores ya filtran por activo, así que no se rompe nada, y leer el DNI
 * de quien ya no trabaja aquí no es una funcionalidad que convenga conservar.
 *
 * Si se prefiere no tocar ni eso, la alternativa es crear la política de
 * lectura con `using (true)` en vez de apoyarse en la existente. Está indicado
 * en cada sitio.
 */

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Fuera las diez políticas `ALL` de `anon`
-- ───────────────────────────────────────────────────────────────────────────
--
-- Ocho de las diez tablas ya tienen una política `portal_anon_*` de solo
-- lectura, así que al retirar la `ALL` la lectura se mantiene sola.

drop policy if exists sea_anon_all          on sea_employees;
drop policy if exists sea_anon_authorizations on sea_authorizations;
drop policy if exists sea_anon_competencies on sea_competencies;
drop policy if exists sea_anon_emp_aut      on sea_employee_authorizations;
drop policy if exists sea_anon_emp_cert     on sea_employee_certifications;
drop policy if exists sea_anon_clothing     on sea_employee_clothing;
drop policy if exists sea_anon_emp_comp     on sea_employee_competencies;
drop policy if exists sea_anon_training     on sea_training_records;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Las dos que NO tienen política de lectura aparte
-- ───────────────────────────────────────────────────────────────────────────
--
-- `sea_companies` y `sea_work_centers` solo tienen la `ALL`. Si se retira sin
-- más, `anon` deja de leerlas — y **eso sí rompería el portal**:
--
--   PortalFicha.tsx:103
--     .select("*, sea_companies(nombre), sea_work_centers(nombre)")
--
-- Es un embebido de PostgREST, y un embebido exige permiso de RLS sobre la
-- tabla embebida. Sin política, la ficha del empleado deja de cargar.
--
-- Así que aquí la `ALL` se sustituye por una de solo lectura con el MISMO
-- predicado: la lectura queda exactamente igual, la escritura desaparece.

drop policy if exists sea_anon_companies on sea_companies;
-- El `drop` de la nueva antes de crearla es lo que la hace idempotente. Sin
-- el, una segunda pasada muere con «policy already exists». Es exactamente el
-- defecto que ya aparecio en la migracion de Fase 0, y aqui volvio a aparecer:
-- se comprueba ejecutando el fichero dos veces seguidas, no leyendolo.
drop policy if exists sea_anon_companies_lectura on sea_companies;
create policy sea_anon_companies_lectura on sea_companies
  for select to anon using (true);

drop policy if exists sea_anon_centers on sea_work_centers;
drop policy if exists sea_anon_centers_lectura on sea_work_centers;
create policy sea_anon_centers_lectura on sea_work_centers
  for select to anon using (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Y el permiso de tabla, que es un control distinto de la RLS
-- ───────────────────────────────────────────────────────────────────────────
--
-- Retirar la política quita la autorización por fila; retirar el grant quita el
-- permiso de la operación. Con los dos, un fallo en cualquiera de ellos no abre
-- la puerta solo. El `select` se conserva, que es lo que necesita el portal.

do $$
declare t text;
begin
  foreach t in array array[
    'sea_employees', 'sea_companies', 'sea_work_centers', 'sea_authorizations',
    'sea_competencies', 'sea_employee_authorizations', 'sea_employee_certifications',
    'sea_employee_clothing', 'sea_employee_competencies', 'sea_training_records'
  ] loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'La tabla % no existe, se salta', t;
      continue;
    end if;
    -- PUBLIC primero: `anon` hereda de PUBLIC, así que quitárselo solo a `anon`
    -- no bastaría si alguna vez se concedió a PUBLIC. Hoy no hay ninguno, pero
    -- la línea cuesta nada y evita que reaparezca el caso.
    execute format('revoke insert, update, delete on public.%I from public', t);
    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
end $$;

commit;

/*
 * ── POSTCHECK ──────────────────────────────────────────────────────────────
 *
 * 1) No queda ninguna política de escritura para `anon` (esperado: 0 filas):
 *
 *   select tablename, policyname, cmd from pg_policies
 *    where schemaname = 'public' and 'anon' = any(roles) and cmd <> 'SELECT'
 *      and tablename like 'sea\_%';
 *
 * 2) Ni permiso de tabla (esperado: todo falso):
 *
 *   select c.relname,
 *          has_table_privilege('anon', c.oid, 'insert') as ins,
 *          has_table_privilege('anon', c.oid, 'update') as upd,
 *          has_table_privilege('anon', c.oid, 'delete') as del
 *     from pg_class c join pg_namespace n on n.oid = c.relnamespace
 *    where n.nspname = 'public' and c.relname like 'sea\_%' order by 1;
 *
 * 3) Y la lectura del portal sigue viva (esperado: todo cierto):
 *
 *   select has_table_privilege('anon', 'sea_employees', 'select')    as e,
 *          has_table_privilege('anon', 'sea_companies', 'select')    as c,
 *          has_table_privilege('anon', 'sea_work_centers', 'select') as w;
 *
 * ── VUELTA ATRÁS ───────────────────────────────────────────────────────────
 *
 * Restaura exactamente el agujero. Está escrito porque un plan de vuelta atrás
 * que no existe no se puede aprobar, no porque convenga ejecutarlo.
 *
 *   drop policy if exists sea_anon_companies_lectura on sea_companies;
 *   drop policy if exists sea_anon_centers_lectura on sea_work_centers;
 *   create policy sea_anon_all on sea_employees for all to anon using (true) with check (true);
 *   create policy sea_anon_companies on sea_companies for all to anon using (true) with check (true);
 *   create policy sea_anon_centers on sea_work_centers for all to anon using (true) with check (true);
 *   create policy sea_anon_authorizations on sea_authorizations for all to anon using (true) with check (true);
 *   create policy sea_anon_competencies on sea_competencies for all to anon using (true) with check (true);
 *   create policy sea_anon_emp_aut on sea_employee_authorizations for all to anon using (true) with check (true);
 *   create policy sea_anon_emp_cert on sea_employee_certifications for all to anon using (true) with check (true);
 *   create policy sea_anon_clothing on sea_employee_clothing for all to anon using (true) with check (true);
 *   create policy sea_anon_emp_comp on sea_employee_competencies for all to anon using (true) with check (true);
 *   create policy sea_anon_training on sea_training_records for all to anon using (true) with check (true);
 *   grant insert, update, delete on sea_employees, sea_companies, sea_work_centers,
 *     sea_authorizations, sea_competencies, sea_employee_authorizations,
 *     sea_employee_certifications, sea_employee_clothing,
 *     sea_employee_competencies, sea_training_records to anon;
 */
