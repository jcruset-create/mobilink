-- ============================================================================
-- Informes y Dashboard: sin JIT en TODAS las funciones de informes
-- ============================================================================
-- El Dashboard y los Informes (también con una sola empresa elegida) fallaban
-- con «canceling statement due to statement timeout».
--
-- La causa ya está medida en tyrecontrol_informe_ejecutivo_jit.sql (agosto,
-- con volúmenes de producción): el 90 % del tiempo PostgreSQL lo pasa
-- COMPILANDO la consulta a código máquina (JIT), no consultándola.
--
--     con JIT   5.100 ms   ← 4.656 ms de ellos, compilar
--     sin JIT     350 ms
--
-- El JIT se enciende porque el coste ESTIMADO del plan pasa del umbral, y en
-- estas funciones esa estimación sale muy inflada (generate_series que el
-- planificador cree de 1.000 filas, joins que estima en millones). Compilar
-- cuesta ~5 s pase lo que pase, y el límite de una consulta de la API es de
-- unos pocos segundos.
--
-- Aquel arreglo se aplicó solo a las dos funciones del informe ejecutivo. El
-- Dashboard usa otras —tc_informes_kpis, tc_informes_estado_flota,
-- tc_informes_inventario_por— y el resto de pestañas, otras más. Esto apaga
-- el JIT en TODAS las funciones de informes que existan, se llamen como se
-- llamen (tc_informe_* y tc_informes_*).
--
-- NO SE TOCA NI UNA LÍNEA DE LÓGICA. El JIT solo cambia cómo se ejecuta la
-- consulta, no qué devuelve: los resultados salen idénticos.
--
-- OJO: `create or replace function` borra este ajuste. Si se vuelve a
-- ejecutar la migración que define alguna de estas funciones, hay que volver
-- a pasar esta. Es idempotente: se puede ejecutar las veces que haga falta.
-- ============================================================================

do $$
declare
  f record;
  v_tocadas int := 0;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'tc\_informe\_%' or p.proname like 'tc\_informes\_%')
  loop
    execute format('alter function %s set jit = off', f.firma);
    v_tocadas := v_tocadas + 1;
  end loop;

  if v_tocadas = 0 then
    raise exception 'No hay ninguna función de informes (tc_informe_* / tc_informes_*): nada que ajustar';
  end if;

  -- Comprobación: que no quede ninguna sin el ajuste.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'tc\_informe\_%' or p.proname like 'tc\_informes\_%')
       and not coalesce('jit=off' = any(p.proconfig), false)
  ) then
    raise exception 'Alguna función de informes se ha quedado con el JIT encendido';
  end if;

  raise notice 'OK: JIT apagado en % función(es) de informes.', v_tocadas;
end $$;
