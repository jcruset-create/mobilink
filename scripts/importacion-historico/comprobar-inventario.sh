#!/usr/bin/env bash
# ¿Siguen separadas las fichas de la reconstrucción histórica del inventario real?
#
# Se comprueba por RESULTADO, no leyendo el texto de las funciones: se cuentan
# las fichas reales y las históricas y se pregunta a cada informe. Si alguien
# vuelve a aplicar una migración que redefina esas funciones sin el filtro
# (por ejemplo tyrecontrol_informes_TODO.sql), esto falla.
#
#   bash scripts/importacion-historico/comprobar-inventario.sh [base]
set -u
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
DB="${1:-esquema_completo}"; comprobar_base "$DB"
case "$DB" in esquema_completo*) export PGOPTIONS='-c request.jwt.claims={"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';; esac
PSQL -d "$DB" -qAt <<'SQL'
do $$
declare
  v_emp uuid; v_reales bigint; v_hist bigint; v_inv bigint; v_cruce bigint; v_marcas bigint; v_fallos text[] := '{}';
begin
  -- La empresa con fichas históricas, que es donde la comprobación demuestra algo.
  select empresa_id into v_emp from tc_neumaticos where importacion_lote_id is not null
    group by empresa_id order by count(*) desc limit 1;
  if v_emp is null then select id into v_emp from tc_empresas order by nombre limit 1; end if;
  select count(*) filter (where importacion_lote_id is null), count(*) filter (where importacion_lote_id is not null)
    into v_reales, v_hist from tc_neumaticos where empresa_id = v_emp;
  raise notice 'empresa %: % fichas reales, % históricas', v_emp, v_reales, v_hist;
  if v_hist = 0 then
    raise notice 'AVISO: no hay fichas históricas en esta base; la comprobación no demuestra nada';
  end if;

  select coalesce(sum(total),0) into v_inv from tc_informes_inventario_por(v_emp, 'marca');
  if v_inv <> v_reales then v_fallos := v_fallos || format('tc_informes_inventario_por cuenta %s y debería contar %s', v_inv, v_reales); end if;

  select coalesce(sum(total),0) into v_cruce from tc_informes_inventario_marca_medida(v_emp);
  if v_cruce <> v_reales then v_fallos := v_fallos || format('tc_informes_inventario_marca_medida cuenta %s y debería contar %s', v_cruce, v_reales); end if;

  if to_regclass('tc_marcas_contadores') is not null then
    select coalesce(sum(num_neumaticos),0) into v_marcas from tc_marcas_contadores;
    if v_marcas > v_reales then v_fallos := v_fallos || format('la vista tc_marcas_contadores cuenta %s, más que las %s fichas reales', v_marcas, v_reales); end if;
  end if;

  -- Ninguna ficha histórica puede estar disponible para montar.
  if exists (select 1 from tc_neumaticos where importacion_lote_id is not null and estado in ('almacen','reservado')) then
    v_fallos := v_fallos || 'hay fichas históricas en estado almacen/reservado: saldrían en el selector de montaje';
  end if;
  -- Ni figurar montadas o descartadas sin que nadie lo haya decidido.
  if exists (select 1 from tc_neumaticos where importacion_lote_id is not null and (vehiculo_id is not null or posicion_id is not null)) then
    v_fallos := v_fallos || 'hay fichas históricas con vehículo o posición actual';
  end if;

  if coalesce(array_length(v_fallos,1),0) > 0 then
    raise exception E'INVENTARIO MEZCLADO:\n  · %', array_to_string(v_fallos, E'\n  · ');
  end if;
  raise notice 'OK: el inventario real y las fichas históricas siguen separados';
end $$;
SQL
