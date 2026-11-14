-- La profundidad a la que hay que cambiar una goma depende de la llanta.
--
-- ── Lo que se pide ──────────────────────────────────────────────────────────
--
--   llanta 22.5            →  ≤ 4 mm  →  cambiar ya
--   llanta 19.5 y 17.5     →  ≤ 3 mm  →  cambiar ya
--   llanta 16 o inferiores →  ≤ 2 mm  →  cambiar ya
--
-- Hasta ahora el informe usaba UN solo número para toda la flota: 1,6 mm de
-- mínimo y 3,0 de aviso, que son los valores por defecto que lleva escritos la
-- propia función. Empresa Plana no tiene ni una fila en `tc_config_umbrales`,
-- `tc_config_umbrales_medida` ni `tc_config_umbrales_categoria`, así que corría
-- con esos dos números para un 225/75R16 y para un 315/80R22.5 por igual.
--
-- ── Por qué una regla y no 40 filas de configuración ───────────────────────
--
-- El sistema de umbrales ya existe y admite overrides por medida exacta, por
-- categoría y por empresa. Se podría haber resuelto metiendo una fila por
-- medida en `tc_config_umbrales_medida`: son 40 en el catálogo y 24 en uso.
--
-- No se hace así porque lo que se pide NO es una tabla de valores, es una
-- REGLA sobre el diámetro de llanta. Con filas, cada medida nueva que entre
-- mañana se quedaría sin umbral y caería al 1,6 de siempre sin que nadie se
-- entere. Con la regla, una medida nueva ya nace con el umbral que le toca.
--
-- Los overrides siguen mandando: la regla se mete en el `coalesce` DESPUÉS de
-- los tres niveles de configuración y antes del valor por defecto. Quien
-- quiera otra cosa para una medida concreta la sigue poniendo en su tabla.
--
-- ── De dónde sale el diámetro ───────────────────────────────────────────────
--
-- Del propio texto de la medida, que es donde está: «295/80R22.5» → 22.5.
-- La expresión se probó contra LAS 24 MEDIDAS REALES que hay montadas en la
-- flota, y hubo que afinarla: el primer intento quitaba los espacios y luego
-- buscaba dígitos tras la «R», así que «295/80R22.5 154/149M» —que lleva el
-- índice de carga pegado— devolvía una llanta de 22.5154. Acotando a dos
-- cifras y un decimal sale bien en las 24, con índice de carga o sin él.
--
-- Las gomas sin medida (38) y las que la tienen a «0» (4) devuelven null y
-- caen al valor por defecto, como hasta ahora.
--
-- ── Las bandas, y por qué son bandas y no tres valores ─────────────────────
--
-- Se piden tres casos (22.5 / 19.5-17.5 / 16 e inferiores) pero en la flota
-- hay además R15, R17, R18 y R19, y mañana puede haber un R24. Tres valores
-- sueltos dejarían a esos sin umbral; tres bandas los cubren sin inventar
-- nada nuevo:
--
--   >= 20   →  4 mm   (22.5 y cualquiera mayor)
--   >= 17   →  3 mm   (17, 17.5, 18, 19, 19.5)
--   <  17   →  2 mm   (15, 16 y menores)

create or replace function tc_profundidad_minima_por_llanta(p_medida text)
returns numeric
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when d is null then null
    when d >= 20   then 4.0
    when d >= 17   then 3.0
    else 2.0
  end
  from (
    select nullif(
             replace(substring(upper(coalesce(p_medida, '')) from 'R\s?([0-9]{2}(?:[.,][0-9])?)'), ',', '.'),
             ''
           )::numeric as d
  ) x;
$function$;

comment on function tc_profundidad_minima_por_llanta(text) is
  'Profundidad mínima de cambio según el diámetro de llanta que diga la medida: >=20 pulgadas 4 mm, >=17 3 mm, el resto 2 mm. null si la medida no dice el diámetro.';

revoke all on function tc_profundidad_minima_por_llanta(text) from public;
grant execute on function tc_profundidad_minima_por_llanta(text) to authenticated;

-- ── Y el informe la usa ─────────────────────────────────────────────────────
--
-- Mismo método que las veces anteriores: se lee la definición VIVA, se
-- comprueba que cada anclaje aparece EXACTAMENTE una vez y se sustituye. Si no
-- aparece una sola vez, la migración falla y no toca nada. El cuerpo son
-- setenta líneas de SQL y una errata de transcripción cambiaría qué alertas
-- salen.
--
-- Se hacen dos cambios:
--
--  1. El mínimo pasa a salir de la llanta cuando no hay override.
--
--  2. Se quita el nivel de aviso «Próximo a sustitución» de profundidad. Es
--     decisión de quien lo usa, y es necesaria: con el mínimo en 4 mm y el
--     aviso en 3, la banda del aviso («por encima del mínimo y por debajo del
--     aviso») queda vacía al revés y no saltaría nunca. Dejarla puesta sería
--     dejar código que no se ejecuta y un número que confunde.
--
--     Los avisos de PRESIÓN no se tocan: ésos no tienen nivel de aviso.

-- ── Dos trampas que costaron un intento fallido ────────────────────────────
--
--  1. `pg_get_functiondef` devuelve la definición con saltos CRLF, no LF. El
--     anclaje del mínimo es de UNA línea y casaba; el del bloque de aviso son
--     cuatro, y con `chr(10)` no casaba ninguna. Peor: la comprobación se hizo
--     contra un volcado leído desde fichero en modo texto, y eso convierte los
--     CRLF en LF, así que daba 1 y en la base daba 0. Aquí se quitan los CR
--     antes de nada y se ejecuta la versión sin ellos, que en SQL es
--     indiferente.
--
--  2. Contar con `regexp_matches` NO vale para un anclaje que lleva `||`: en
--     una expresión regular eso es ALTERNACIÓN, no dos barras, así que el
--     patrón casaba 4.069 veces con la cadena vacía. Se cuenta literal, por
--     diferencia de longitudes, que no interpreta nada.

do $migracion$
declare
  v_def   text;
  v_nuevo text;
  v_veces int;

  v_ancla_min constant text :=
    'coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) as minmm';
  v_min_nuevo constant text :=
    'coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, '
    || 'tc_profundidad_minima_por_llanta(n.medida), 1.6) as minmm';

  v_ancla_aviso constant text :=
    '  union all' || chr(10) ||
    '  select ''proximo_sustitucion'', ''media'', mo.vehiculo_id, mo.matricula, mo.neumatico_id, mo.codigo, mo.codigo_posicion,' || chr(10) ||
    '         ''Profundidad '' || mo.profundidad_mm || '' mm (≤ '' || mo.avisomm || '')'', mo.profundidad_mm' || chr(10) ||
    '  from montados mo where mo.profundidad_mm > mo.minmm and mo.profundidad_mm <= mo.avisomm';
begin
  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tc_informes_alertas';
  if v_def is null then
    raise exception 'No existe tc_informes_alertas';
  end if;

  if position('tc_profundidad_minima_por_llanta' in v_def) > 0 then
    raise notice 'tc_informes_alertas ya usa el umbral por llanta, se deja';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla_min, ''))) / length(v_ancla_min);
  if v_veces <> 1 then
    raise exception 'Esperaba 1 vez el coalesce del mínimo en tc_informes_alertas y hay %', v_veces;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla_aviso, ''))) / length(v_ancla_aviso);
  if v_veces <> 1 then
    raise exception 'Esperaba 1 vez el bloque de proximo_sustitucion en tc_informes_alertas y hay %', v_veces;
  end if;

  v_nuevo := replace(v_def, v_ancla_min, v_min_nuevo);
  v_nuevo := replace(v_nuevo, v_ancla_aviso, '');
  execute v_nuevo;
  raise notice 'tc_informes_alertas usa el umbral por llanta y ya no avisa de proximo_sustitucion';
end
$migracion$;

-- ── Comprobación ───────────────────────────────────────────────────────────
--
-- Lo primero tiene que devolver exactamente esto:
--
--   295/80R22.5            → 4.0
--   295/80R22.5 154/149M   → 4.0   (el índice de carga no estorba)
--   315/80R22.5            → 4.0
--   305/70R19.5            → 3.0
--   245/70R17.5            → 3.0
--   225/55R17              → 3.0
--   225/75R16              → 2.0
--   215/70R15              → 2.0
--   0                      → null  (cae al valor por defecto)
--   (null)                 → null

select m as medida, tc_profundidad_minima_por_llanta(m) as minimo_mm
  from unnest(array[
    '295/80R22.5', '295/80R22.5 154/149M', '315/80R22.5', '305/70R19.5',
    '245/70R17.5', '225/55R17', '225/75R16', '215/70R15', '0', null
  ]) as m;

-- Y esto, que el informe ya no trae ni una fila de `proximo_sustitucion` y que
-- las de `bajo_minimo` salen con el umbral de su llanta.

select tipo, count(*) as filas
  from tc_informes_alertas('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)
 group by tipo order by filas desc;
