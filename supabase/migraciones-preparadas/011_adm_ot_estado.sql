/*
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  DESCARTADA · NO APLICAR                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Esta migración se escribió para resolver una regresión que NO EXISTÍA.
 *
 * `adm_ot_estado` aparecía vacía porque **`adm_work_orders` no tiene ni una
 * fila** (medido el 2026-09-27: 11 clientes, 0 órdenes de trabajo). No había
 * ningún fallo de autorización que corregir.
 *
 * Lo que sí hacía falta era cerrar el salto de privilegios, y eso lo hace
 * `014_adm_ot_estado_invoker.sql` con una sola línea, ya aplicada.
 *
 * Se conserva el fichero como registro de lo que se llegó a proponer y por
 * qué. Su predicado sobra: con `security_invoker`, la RLS de las tablas base
 * ya hace ese trabajo.
 *
 * Lo único de aquí que sigue teniendo valor por su cuenta es el endurecimiento
 * de `search_path` de `adm_rol_actual`, `adm_can_read` y `adm_can_manage`, que
 * son tres de las 132 de SEC-067. Va con el barrido de SEC-067, no aquí.
 */

/*
 * SEC-068 · `adm_ot_estado` deja de autorizar por omisión
 * PREPARADA, **SIN APLICAR**
 *
 * ── EL PROBLEMA, EN UNA LÍNEA ──────────────────────────────────────────────
 *
 * La vista se ejecuta con los privilegios de su dueño y **no comprueba quién
 * la llama**. Cualquier usuario autenticado del proyecto —de cualquiera de las
 * ocho apps— lee todas las órdenes de trabajo y los nombres de cliente.
 *
 * ── POR QUÉ NO SE PONE `security_invoker` ──────────────────────────────────
 *
 * Se intentó el 2026-09-27 dentro de `005` y **vació la pantalla**.
 *
 * La primera explicación que di —que faltaba el rol `tecnico` en
 * `adm_can_read()`— **era falsa**: producción no tiene ningún `tecnico`. En
 * `adm_usuarios` hay 2 `admin` y 1 `recepcion`, y nada más.
 *
 * La causa real está en `src/modules/administracion/contexts/AdminAuthContext.tsx`,
 * función `cargarPerfil()`:
 *
 *     // Un superadmin de la plataforma entra aunque no tenga ficha en
 *     // adm_usuarios: se le da perfil de admin sintético para este módulo.
 *     if (await esSuperadmin(userId)) {
 *       return { id: userId, nombre: "Superadmin", rol: "admin", activo: true };
 *     }
 *
 * O sea: **el panel le fabrica al superadministrador de plataforma un perfil
 * de «admin» en el navegador, y la base de datos no sabe nada de eso.**
 * `adm_rol_actual()` solo mira `adm_usuarios`, donde ese usuario no tiene
 * fila, así que devuelve la cadena vacía y `adm_can_read()` es falso.
 *
 * Reproducido en PostgreSQL 17.6 con el esquema real:
 *
 *   superadmin sin ficha, hoy        -> ve 1 OT por la vista
 *   superadmin, adm_rol_actual()     -> «», adm_can_read() -> false
 *   superadmin, acceso DIRECTO       -> 0 filas
 *   superadmin, con invoker          -> 0 filas   <- la pantalla vacía
 *   admin CON ficha, con invoker     -> 1 fila
 *
 * ── LO QUE ESO IMPLICA, Y ES MÁS GRANDE QUE ESTA VISTA ─────────────────────
 *
 * El superadministrador **no puede leer ninguna tabla del módulo**: ni
 * `adm_work_orders`, ni `adm_customers`, ni facturas, ni cobros. La interfaz
 * le abre la puerta y la base de datos le devuelve cero filas en todo.
 *
 * `estado-ots` es la única pantalla que le funciona, y le funciona
 * **precisamente por el salto de privilegios de esta vista**.
 *
 * Así que esta migración cierra el bypass, pero no arregla la incoherencia de
 * fondo: la interfaz y la base no se ponen de acuerdo sobre quién es
 * administrador. Eso se decide aparte (ver el final del fichero).
 *
 * La vista, además, es el mecanismo de restricción por columnas:
 * `adm_work_orders` lleva `total_amount` y la vista no lo selecciona.
 *
 * Con un solo rol de base de datos para todo el panel (`authenticated`), la
 * RLS no puede hacer eso: filtra filas, no columnas. Así que el salto se
 * conserva **a propósito**, y lo que se corrige es que sea incondicional.
 *
 * Quitar esa dependencia del dueño exige mover la pantalla a un endpoint del
 * servidor, y eso es Fase 3.
 *
 * ── LO QUE SE COMPROBÓ ANTES DE ESCRIBIR ESTO ──────────────────────────────
 *
 * Contra PostgreSQL 17.6, porque son supuestos que no conviene dar por buenos:
 *
 *   · `create or replace view` **CONSERVA los grants**. El `revoke` que 005
 *     hizo sobre `anon` sigue en pie después. No se reabre nada.
 *   · `create or replace view` **PIERDE las `reloptions`**. Si la vista
 *     tuviera `security_invoker`, este fichero lo borraría en silencio. Hoy no
 *     la tiene (se revirtió con la restauración mínima), así que el efecto es
 *     nulo — pero queda dicho, porque es una forma de perder esa opción sin
 *     enterarse.
 *   · `create or replace view` **permite AÑADIR columnas** al final sin avisar,
 *     y solo rechaza quitarlas. O sea que un descuido aquí podría añadir
 *     `total_amount`. La lista de columnas de abajo es idéntica a la actual:
 *     mismos nombres, mismo orden, mismos tipos.
 *   · **El llamante SÍ necesita EXECUTE sobre la función**, aunque la vista
 *     corra como su dueño. Yo escribí aquí lo contrario —que los permisos de
 *     todo lo que la vista referencia se comprueban contra el dueño— y era
 *     falso: eso vale para las TABLAS, no para las funciones. El EXECUTE de
 *     una función usada en la consulta de una vista se comprueba contra el
 *     usuario que llama.
 *
 *     Lo descubrió la prueba, no la lectura: con el EXECUTE retirado a todo el
 *     mundo, la vista devolvía
 *     `ERROR: permission denied for function adm_puede_ver_estado_ot`.
 *     De ahí que abajo se le conceda a `authenticated`, y solo a él.
 */

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) El permiso, declarado en una función con nombre
-- ───────────────────────────────────────────────────────────────────────────
--
-- En vez de esconder `'tecnico'` dentro de un `where`, el conjunto autorizado
-- vive en un sitio que se puede leer, conceder y auditar.
--
-- PROPIETARIO: el rol que ejecute esta migración, normalmente `postgres`, que
-- es también el dueño de `adm_usuarios`. Es lo que necesita para leerla sin
-- depender de su RLS. Si se aplicara con otro rol, hay que comprobar que ese
-- rol puede leer `adm_usuarios`.
--
-- `security definer` + `search_path = public, pg_temp`: el `pg_temp` al final
-- es lo que impide suplantar `adm_usuarios` con una tabla temporal. Es el
-- endurecimiento de SEC-067 aplicado SOLO a esta cadena, no el barrido de las
-- 132.
create or replace function public.adm_puede_ver_estado_ot()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Cualificado a propósito: `public.adm_usuarios`, no `adm_usuarios` a secas.
  -- No basta con que el enum admita el rol: hace falta una fila real, activa,
  -- del usuario autenticado de verdad.
  select
    -- (a) quien tiene ficha activa en el módulo, con un rol autorizado
    exists (
      select 1
        from public.adm_usuarios u
       where u.id = auth.uid()        -- identidad del JWT, no del cliente
         and u.activo                 -- las bajas no entran
         and u.rol in ('admin','administracion','recepcion','supervisor')
    )
    -- (b) o un superadministrador de plataforma activo.
    --
    -- Esta segunda rama existe porque el panel ya se los trata como admin
    -- (AdminAuthContext.cargarPerfil), y sin ella la corrección vaciaría la
    -- pantalla a quien hizo el smoke test. Es la base poniéndose de acuerdo
    -- con la interfaz, no un permiso nuevo: hoy ya ven estas OTs.
    or exists (
      select 1
        from public.app_usuarios a
       where a.id = auth.uid()
         and a.activo
         and coalesce(a.es_superadmin, false)
    )
$$;

-- SOBRE `tecnico`, QUE NO ESTÁ EN LA LISTA
--
-- El enum `adm_rol` lo admite y el enrutado del panel dice que `estado-ots` es
-- «la pantalla del técnico». Pero en producción **no hay ningún `tecnico`**,
-- ni activo ni inactivo, así que incluirlo sería autorizar a nadie basándose
-- en una intención de diseño y no en un hecho.
--
-- Queda como decisión pendiente: el día que se cree un técnico, esta pantalla
-- NO le funcionará hasta añadirlo aquí. Es una línea, y está dicho para que no
-- sorprenda.

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Y que no la pueda ejecutar quien no la necesita
-- ───────────────────────────────────────────────────────────────────────────
--
-- PostgreSQL concede EXECUTE a PUBLIC en cada función nueva, y eso alcanza a
-- `anon`, que hereda de PUBLIC. Se retira, y se concede solo a quien la
-- necesita de verdad.
--
-- Quien la necesita es `authenticated`: la función aparece en la consulta de
-- la vista, y el EXECUTE de una función se comprueba contra el USUARIO QUE
-- LLAMA, no contra el dueño de la vista. Con el EXECUTE retirado a todos, la
-- vista falla con «permission denied for function».
--
-- PUBLIC primero, porque `anon` hereda de él y quitárselo solo a `anon` no
-- bastaría.
revoke execute on function public.adm_puede_ver_estado_ot() from public;
revoke execute on function public.adm_puede_ver_estado_ot() from anon;
grant execute on function public.adm_puede_ver_estado_ot() to authenticated;

-- Conceder este EXECUTE no da información: la función solo responde «sí» o
-- «no» sobre quien la llama, y con su propia identidad. No revela nada de
-- otros usuarios ni de las OTs.

-- ───────────────────────────────────────────────────────────────────────────
-- 3) `adm_rol_actual()`, el eslabón de esta cadena que le falta `pg_temp`
-- ───────────────────────────────────────────────────────────────────────────
--
-- No se toca su cuerpo, solo el `search_path`. `alter function` no cambia el
-- comportamiento de nada que funcione hoy. Es una de las 132 de SEC-067, y
-- aquí se endurece porque `adm_can_read()` —que sigue decidiendo el acceso
-- DIRECTO a las tablas— depende de ella.
alter function public.adm_rol_actual() set search_path = public, pg_temp;
alter function public.adm_can_read()   set search_path = public, pg_temp;
alter function public.adm_can_manage() set search_path = public, pg_temp;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) La vista, con las MISMAS columnas y un predicado
-- ───────────────────────────────────────────────────────────────────────────
--
-- Siete columnas, mismo orden, mismos tipos que la actual. PostgREST sigue
-- viendo la misma interfaz. `total_amount` no está, y no debe estar nunca.
--
-- No filtra por `center`: hoy el técnico ve los dos centros y eso se conserva
-- tal cual. Restringir por centro sería un cambio funcional que este hallazgo
-- no justifica; queda anotado como decisión de producto pendiente.
create or replace view public.adm_ot_estado as
  select wo.id,
         wo.ot_number,
         wo.vehicle_plate,
         wo.status,
         wo.center,
         wo.created_at,
         c.name as customer_name
    from public.adm_work_orders wo
    join public.adm_customers c on c.id = wo.customer_id
   where public.adm_puede_ver_estado_ot();

-- No hay ningún `grant` aquí, y es deliberado: `create or replace view`
-- conserva los privilegios que ya hay, así que `anon` sigue fuera. Un `grant
-- select ... to authenticated` sería inofensivo —ya lo tiene— pero un
-- `to anon, authenticated` copiado de la migración original reabriría el
-- agujero que 005 cerró.

commit;

/*
 * ── POSTCHECK ──────────────────────────────────────────────────────────────
 *
 * select 'anon sigue sin la vista' as comprobacion,
 *        has_table_privilege('anon','adm_ot_estado','select')::text as valor,
 *        'false' as esperado
 * union all select 'authenticated conserva el select',
 *        has_table_privilege('authenticated','adm_ot_estado','select')::text, 'true'
 * union all select 'authenticated sin escritura',
 *        (has_table_privilege('authenticated','adm_ot_estado','insert')
 *      or has_table_privilege('authenticated','adm_ot_estado','update')
 *      or has_table_privilege('authenticated','adm_ot_estado','delete'))::text, 'false'
 * union all select 'la vista NO expone total_amount',
 *        exists (select 1 from information_schema.columns
 *                 where table_schema='public' and table_name='adm_ot_estado'
 *                   and column_name='total_amount')::text, 'false'
 * union all select 'siguen siendo 7 columnas',
 *        (select count(*)::text from information_schema.columns
 *          where table_schema='public' and table_name='adm_ot_estado'), '7'
 * union all select 'sigue sin security_invoker',
 *        (select coalesce(array_to_string(reloptions,','),'(ninguna)')
 *           from pg_class where relname='adm_ot_estado'), '(ninguna)'
 * union all select 'PUBLIC no ejecuta la funcion de permiso',
 *        has_function_privilege('public','public.adm_puede_ver_estado_ot()','execute')::text, 'false'
 * union all select 'anon tampoco',
 *        has_function_privilege('anon','public.adm_puede_ver_estado_ot()','execute')::text, 'false'
 * union all select 'las tres funciones de la cadena llevan pg_temp',
 *        (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 *          where n.nspname='public'
 *            and p.proname in ('adm_rol_actual','adm_can_read','adm_can_manage','adm_puede_ver_estado_ot')
 *            and coalesce(array_to_string(p.proconfig,','),'') like '%pg_temp%'), '4';
 *
 * ── VUELTA ATRÁS ───────────────────────────────────────────────────────────
 *
 * Devuelve la vista a como está ahora mismo: sin predicado. Reabre el bypass
 * para `authenticated`, no para `anon`.
 *
 *   create or replace view public.adm_ot_estado as
 *     select wo.id, wo.ot_number, wo.vehicle_plate, wo.status, wo.center,
 *            wo.created_at, c.name as customer_name
 *       from public.adm_work_orders wo
 *       join public.adm_customers c on c.id = wo.customer_id;
 *   drop function if exists public.adm_puede_ver_estado_ot();
 *   alter function public.adm_rol_actual() set search_path = public;
 *   alter function public.adm_can_read()   set search_path = public;
 *   alter function public.adm_can_manage() set search_path = public;
 *
 * Restauración MÍNIMA, si lo que falla es que alguien legítimo se queda fuera:
 * no revertir la vista. Añadir su rol al conjunto de la función, que es una
 * línea y no reabre nada:
 *
 *   -- después de comprobar en adm_usuarios qué rol tiene esa persona
 *   create or replace function public.adm_puede_ver_estado_ot() ... in (..., 'el_rol_que_falta')
 */
