-- ============================================================
-- Mobilink TyreControl — El informe ejecutivo dejaba de salir por caducidad
--
-- EL SÍNTOMA (pantalla Informes → Ejecutivo, 21-08-2026)
--
--     No se ha podido generar el informe.
--     canceling statement due to statement timeout
--
-- La pantalla sugiere que falta ejecutar tyrecontrol_informe_ejecutivo.sql.
-- No es eso: la función está y funciona. Sencillamente tarda demasiado.
--
-- LA CAUSA, MEDIDA
--
-- Reproducido en un PostgreSQL 16 con volúmenes de producción (818 vehículos,
-- 4.908 neumáticos montados, 3.272 revisiones, 19.632 mediciones):
--
--     con JIT   5.100 ms   ← 4.656 ms de ellos son COMPILAR, no consultar
--     sin JIT     350 ms
--
--   JIT: Functions: 522
--   Timing: Generation 32 ms, Inlining 154 ms, Optimization 2.656 ms,
--           Emission 1.814 ms, Total 4.656 ms
--
-- Leer las tablas y agregarlas cuesta 350 ms. Todo lo demás es PostgreSQL
-- compilando a código máquina 522 funciones para una consulta que lee 25.000
-- filas y se ejecuta una sola vez. No hay ninguna tabla lenta que arreglar.
--
-- Se enciende porque el coste ESTIMADO del plan sale 4.081.610, muy por
-- encima de jit_above_cost (100.000) y de jit_optimize_above_cost e
-- jit_inline_above_cost (500.000). Y ese coste está mal calculado: `meses` es
-- un generate_series de 12 filas que el planificador estima en 1.000, y con
-- ese error el join de evol_bandas se estima en 2.181.336 filas cuando de
-- verdad son 16.584. Estimación mala → coste inflado → JIT → caducidad.
--
-- Con más datos no se arregla solo, al revés: compilar cuesta lo mismo pase
-- lo que pase (~5 s) mientras el trabajo real crece. Triplicando los datos:
-- 5.900 ms con JIT contra 800 ms sin. Hoy el informe se pasa el 90 % del
-- tiempo compilando.
--
-- QUÉ HACE: apagar el JIT en las dos funciones del informe. Nada más. No se
-- toca ni una línea de la lógica y los números salen idénticos —comprobado
-- comparando el md5 del jsonb con JIT y sin él, mismo periodo y mismos datos.
--
-- POR QUÉ AQUÍ Y TAMBIÉN DENTRO DE LAS FUNCIONES: este fichero arregla lo que
-- YA está en producción. Pero `create or replace function` borra el
-- proconfig, así que este alter se perdería la próxima vez que se desplegara
-- tyrecontrol_informe_ejecutivo.sql o tyrecontrol_informe_cobertura_
-- periodicidad.sql. Por eso esos dos ficheros llevan además el `set jit = off`
-- dentro de la propia definición. Uno sin el otro no basta.
--
-- Idempotente: se puede ejecutar las veces que haga falta.
-- ============================================================

do $$
declare
  v_tocadas int := 0;
  f record;
begin
  -- Las dos funciones del informe, se llamen como se llamen: si se ha
  -- ejecutado tyrecontrol_informe_cobertura_periodicidad.sql existen la base
  -- y el envoltorio; si no, solo tc_informe_ejecutivo.
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('tc_informe_ejecutivo', 'tc_informe_ejecutivo_base')
  loop
    execute format('alter function %s set jit = off', f.firma);
    v_tocadas := v_tocadas + 1;
  end loop;

  if v_tocadas = 0 then
    raise exception 'No existe ninguna función del informe ejecutivo: ejecuta antes tyrecontrol_informe_ejecutivo.sql';
  end if;

  -- Comprobación de verdad: que hayan quedado con el ajuste puesto.
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('tc_informe_ejecutivo', 'tc_informe_ejecutivo_base')
       and coalesce(array_to_string(p.proconfig, ','), '') not like '%jit=off%'
  ) then
    raise exception 'Alguna función del informe se ha quedado sin jit=off';
  end if;

  raise notice 'OK: % función(es) del informe ejecutivo con jit=off. El informe pasa de ~5 s a ~0,4 s sin cambiar ni un número.', v_tocadas;
end $$;
