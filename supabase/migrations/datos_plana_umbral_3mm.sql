-- El mínimo de profundidad de Plana, a 3 mm (aviso a 4 mm).
--
-- Decidido por Jordi el 16/11/2026. Sin umbral propio, a Plana le regía el de
-- la llanta: 4 mm en 22,5". Medido en solo lectura antes de escribir esto:
--
--                                  con 4 mm   con 3 mm
--   neumáticos para cambiar             53         13
--   vehículos urgentes                  35         12
--   próximos al mínimo (inicio)        237        112
--
-- Es el mismo dato que guarda la pantalla de umbrales de la empresa: una fila
-- en tc_config_umbrales. La tolerancia de presión se queda en 0,5 bar, que es
-- lo que ya se aplicaba sin fila.
--
-- ── Cuándo pegarla ───────────────────────────────────────────────────────────
--
-- Después de desplegar el PR #648 (panel) y de instalar la versión de la
-- tablet que lo lleva. Antes de eso los informes pasarían a 3 mm y la ficha
-- del vehículo seguiría juzgando contra 4 mm.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
--
-- Si Plana ya tiene un umbral distinto, no se toca nada. Después de escribir
-- comprueba que las gomas de 22,5" de Plana salen con mínimo 3 y aviso 4, y
-- que no hay MÁS gomas para cambiar que antes; si no, se deshace.
-- Para volver atrás: delete from tc_config_umbrales where empresa_id = '<Plana>'.

do $migracion$
declare
  c_plana constant uuid := 'a51c9662-4b6f-4681-8e2b-599e109659eb';
  c_minimo constant numeric := 3.0;
  c_aviso constant numeric := 4.0;
  v_hay record;
  v_antes bigint;
  v_despues bigint;
  v_mal bigint;
  v_resultado text;
begin
  if not exists (select 1 from tc_empresas e where e.id = c_plana) then
    raise exception 'No se toca nada: no existe la empresa %.', c_plana;
  end if;
  if to_regprocedure('public.tc_profundidad_vigente(uuid)') is null then
    raise exception 'No se toca nada: falta tc_profundidad_vigente (migración tyrecontrol_informes_profundidad_vigente).';
  end if;

  select u.profundidad_minima_mm as minimo, u.profundidad_aviso_mm as aviso into v_hay
    from tc_config_umbrales u where u.empresa_id = c_plana;
  if found and (v_hay.minimo <> c_minimo or v_hay.aviso <> c_aviso) then
    raise exception 'No se toca nada: Plana ya tiene un umbral puesto (mínimo %, aviso %).', v_hay.minimo, v_hay.aviso;
  end if;
  if exists (select 1 from tc_config_umbrales_medida m where m.empresa_id = c_plana)
     or exists (select 1 from tc_config_umbrales_categoria c where c.empresa_id = c_plana) then
    raise exception 'No se toca nada: Plana tiene umbrales por medida o por categoría, que mandarían sobre éste.';
  end if;

  select count(*) filter (where g.severidad = 3) into v_antes from tc_profundidad_vigente(c_plana) g;

  begin
    insert into tc_config_umbrales (empresa_id, profundidad_minima_mm, profundidad_aviso_mm)
    values (c_plana, c_minimo, c_aviso)
    on conflict (empresa_id) do nothing;

    select count(*) filter (where g.severidad = 3),
           count(*) filter (where g.minimo_mm <> c_minimo or g.aviso_mm <> c_aviso)
      into v_despues, v_mal
      from tc_profundidad_vigente(c_plana) g;

    if v_mal > 0 or v_despues > v_antes then
      raise exception using errcode = 'MB001', message = format(
        'NO PUESTO, todo queda como estaba: % gomas no salen con mínimo 3 y aviso 4; para cambiar, antes % y después %.',
        v_mal, v_antes, v_despues);
    end if;
    v_resultado := format('OK: Plana a 3 mm de mínimo y 4 mm de aviso. Para cambiar: antes %s, ahora %s.', v_antes, v_despues);
  exception when sqlstate 'MB001' then
    v_resultado := sqlerrm;
  end;

  perform set_config('mobilink.resultado', v_resultado, false);
  raise notice '%', v_resultado;
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado,
       k.j ->> 'neumaticos_bajo_minimo' as inicio_bajo_minimo,
       k.j ->> 'neumaticos_proximos' as inicio_proximos,
       e.j ->> 'urgente' as flota_urgente,
       e.j ->> 'revisar' as flota_revisar,
       e.j ->> 'correcto' as flota_correcto,
       e.j ->> 'pendiente' as flota_pendiente
  from (select tc_informes_kpis('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)::jsonb as j) k,
       (select tc_informes_estado_flota('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)::jsonb as j) e;
