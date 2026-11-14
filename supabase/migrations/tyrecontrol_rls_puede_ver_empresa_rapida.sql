-- ============================================================================
-- Mobilink TyreControl — Los informes caducaban: la RLS costaba fila a fila
--
-- EL SÍNTOMA (pantalla Informes → Ejecutivo, 06-11-2026)
--
--     No se ha podido generar el informe.
--     canceling statement due to statement timeout
--
-- La pantalla sugería que faltaba la migración del JIT. No es eso: esa ya
-- está aplicada (tc_informe_ejecutivo y tc_informe_ejecutivo_base tienen
-- jit=off en su proconfig, comprobado). El informe simplemente tarda.
--
-- LA CAUSA, MEDIDA EN PRODUCCIÓN
--
-- El mismo informe, con los mismos datos, según quién lo pida:
--
--     como postgres (sin RLS)                   750 ms
--     como authenticated (con RLS), media     3.286 ms
--     como authenticated (con RLS), máximo    6.642 ms   ← el límite son 8 s
--
-- Y pg_stat_statements enseña que no es solo el ejecutivo: tc_informes_kpis
-- —el Dashboard— llega a 7.882 ms. Están todos rozando la pared.
--
-- La diferencia es la RLS. Las 53 políticas que filtran por empresa llaman a
-- `tc_puede_ver_empresa(empresa_id)`, con una COLUMNA de argumento: eso es una
-- llamada por fila. Y cada llamada encadenaba otras tres —tc_is_superadmin(),
-- tc_auth_empresa_id(), tc_operador_ve_empresa()—, cada una SECURITY DEFINER,
-- cada una con su propia consulta. Cuatro cambios de contexto y hasta tres
-- consultas por fila leída.
--
-- Medido sobre tc_neumaticos (6.529 filas), contando nada más:
--
--     sin el predicado                            175 ms
--     con tc_puede_ver_empresa(empresa_id)      1.808 ms
--
-- Un segundo y medio de recargo en UNA tabla pequeña. El informe ejecutivo
-- recorre varias, varias veces.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- Deja la MISMA función diciendo lo MISMO, pero en una sola consulta en vez
-- de cuatro funciones anidadas. No se toca ni una política, ni se cambia
-- quién ve qué.
--
-- Medido en un PostgreSQL con el mismo volumen y un usuario de verdad:
--
--                                  usuario normal   superadmin
--     cadena actual                    3.515 ms       1.847 ms
--     esta versión                       248 ms         199 ms     ← 14x
--
-- POR QUÉ ES EQUIVALENTE, Y NO «PARECE EQUIVALENTE»
--
-- Son las mismas tres condiciones con el mismo «o»:
--
--     es superadmin  ·  la empresa es la suya  ·  es operador de esa empresa
--
-- Las dos primeras salen de la misma fila de tc_usuarios, así que se leen de
-- una vez en lugar de dos. La tercera queda igual.
--
-- Comprobado usuario a usuario y empresa a empresa, con superadmins, usuarios
-- de su empresa y operadores con empresas asignadas. La prueba no dice «dan
-- el mismo resultado», que escondería cuál de los dos lados se rompe: dice
-- que NADIE GANA acceso que antes no tuviera —eso sería enseñarle a un
-- cliente los autobuses de otro— y que NADIE PIERDE el suyo. Vive en
-- `server/tyrecontrol/rlsEmpresa.integration.test.ts`, se ejecuta en CI y
-- monta la cadena vieja al lado para comparar contra ella de verdad.
--
-- LA ÚNICA DIFERENCIA, DICHA ENTERA
--
-- Donde la versión vieja devolvía NULL, ésta devuelve false. Pasa en tres
-- sitios, y conviene no quedarse corto nombrándolos:
--
--   · sin sesión, porque auth.uid() es nulo;
--   · con la empresa preguntada a nulo;
--   · y —el que no es evidente— con un USUARIO cuyo `empresa_id` es nulo,
--     porque entonces `emp = tc_auth_empresa_id()` es `emp = NULL`, que no
--     es false: es NULL. Hoy en producción no hay ninguno (0 de 6 usuarios),
--     pero mañana puede haberlo y la prueba cubre el caso.
--
-- Qué significa esa diferencia en cada sitio donde se usa la función:
--
--   · En una política RLS, nada: NULL en un USING descarta la fila igual que
--     false. Las 53 políticas se comportan exactamente igual.
--
--   · Fuera de las políticas la llaman cinco funciones. En tres va dentro de
--     un WHERE, donde NULL y false vuelven a ser lo mismo. En las otras dos
--     —tc_montar_fuera_almacen y tc_resolver_incidencia_parcial— va como
--     `if not tc_puede_ver_empresa(...) then raise`, y ahí la diferencia SÍ
--     cuenta: con NULL, `not NULL` es NULL, el `if` no entra y la
--     comprobación de permisos se saltaba en silencio. Ahora salta la
--     excepción, que es lo que esa línea quería decir desde el principio.
--
--     A esas dos no las llama nadie sin sesión: una la llama el navegador y
--     la otra el servidor con `clienteTyreControl`, que entra con usuario y
--     contraseña de verdad. No hay ninguna llamada con service_role
--     (comprobado en todo el repositorio). Así que no se rompe ningún
--     camino que hoy funcione, y lo que cambia cierra un agujero en vez de
--     abrirlo.
--
-- LO QUE NO HACE
--
-- No toca ninguna política, ninguna tabla y ningún dato. No cambia las otras
-- tres funciones de permisos, que siguen igual para las 95 políticas que las
-- usan por su cuenta.
--
-- LO QUE QUEDA SOBRE LA MESA
--
-- Hay otro 10x largo en reescribir las políticas a la forma que PostgreSQL
-- evalúa UNA vez por consulta en lugar de una por fila:
--
--     (select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id())
--     or empresa_id in (select empresa_id from tc_operador_empresas
--                        where usuario_id = (select auth.uid()))
--
-- Medido: 2,1 ms contra los 248 ms de aquí. Pero son 53 políticas, y tocar 53
-- políticas de producción para arreglar un informe que con esto ya va sobrado
-- es gastar riesgo sin necesidad. Queda anotado para cuando haga falta.
--
-- Idempotente: `create or replace`. Se puede ejecutar las veces que haga falta.
-- ============================================================================

begin;

create or replace function public.tc_puede_ver_empresa(emp uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Superadmin o la empresa propia: las dos están en la MISMA fila de
  -- tc_usuarios, así que se leen de una vez en lugar de en dos consultas.
  select exists (
           select 1 from tc_usuarios u
            where u.id = auth.uid()
              and (u.es_superadmin or u.empresa_id = emp)
         )
      -- Operador con esa empresa asignada. Igual que antes.
      or exists (
           select 1 from tc_operador_empresas oe
            where oe.usuario_id = auth.uid() and oe.empresa_id = emp
         )
$function$;

comment on function public.tc_puede_ver_empresa(uuid) is
  'Si el usuario de la sesión puede ver esa empresa: superadmin, es la suya, o es operador asignado. En una sola consulta: encadenar tc_is_superadmin + tc_auth_empresa_id + tc_operador_ve_empresa costaba hasta tres consultas POR FILA en cada política RLS, y con eso los informes se pasaban del statement_timeout.';

commit;

-- ============================================================================
-- Comprobaciones de después (para pegar en el editor; leen y no escriben)
--
--   -- 1 · La función es la nueva y sigue siendo SECURITY DEFINER
--   select prosecdef, provolatile, array_to_string(proconfig, ', ')
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'tc_puede_ver_empresa';
--   -- esperado: true | s | search_path=public
--
--   -- 2 · Las 53 políticas siguen donde estaban, sin tocar
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and (coalesce(qual,'') || coalesce(with_check,'')) like '%tc_puede_ver_empresa%';
--   -- esperado: 53
--
--   -- 3 · El recargo por fila, que era el problema
--   explain (analyze, timing off)
--     select count(*) from tc_neumaticos where tc_puede_ver_empresa(empresa_id);
--   -- antes: ~1.800 ms · esperado ahora: por debajo de 300 ms
-- ============================================================================
