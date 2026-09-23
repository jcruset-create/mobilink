-- ============================================================================
-- Tipos de vehículo: que el número de ejes y de ruedas diga la verdad
-- ============================================================================
-- `numero_ejes` y `numero_ruedas` se escribieron a mano en la semilla de 2024
-- y desde entonces nadie los ha vuelto a mirar. La configuración de ejes llegó
-- después, y el plano de ruedas (tc_posiciones_vehiculo) se generó a partir de
-- ella, pero esas dos columnas se quedaron con el valor viejo. Resultado:
-- camión 3 ejes dice 10 ruedas y su plano tiene 8 (2x4x2), semirremolque dice
-- 12 y su plano tiene 6 (2x2x2).
--
-- No es cosmético: la APK enseña «N ruedas» al dar de alta un vehículo
-- (realizar_operacion_screen), así que el operario lee un número que no es el
-- de las ruedas que luego va a revisar.
--
-- Manda el PLANO, no la etiqueta: es lo que se ve en la tablet y donde se
-- montan los neumáticos. Solo cuando un tipo no tiene plano se usa su
-- configuración. Y lo que no cuadre entre etiqueta y plano NO se toca a la
-- brava: sale en una vista para mirarlo.
--
-- Idempotente: al segundo pase no cambia ninguna fila.
-- ============================================================================

-- ── 1. "2x4x2" → {2,4,2} ────────────────────────────────────────────────────
-- Mismo criterio que ruedasPorEje() del servidor: solo 2 (rueda simple) y 4
-- (gemela). Cualquier otra cosa es una etiqueta mal escrita y devuelve null,
-- porque de un plano inventado no se recupera nadie.
create or replace function tc_ruedas_de_configuracion(p_config text)
returns int[]
language plpgsql
immutable
as $$
declare
  partes text[];
  parte  text;
  n      int;
  salida int[] := '{}';
begin
  if p_config is null or btrim(p_config) = '' then return null; end if;
  partes := regexp_split_to_array(lower(btrim(p_config)), 'x');
  foreach parte in array partes loop
    if btrim(parte) !~ '^\d+$' then return null; end if;
    n := btrim(parte)::int;
    if n not in (2, 4) then return null; end if;
    salida := salida || n;
  end loop;
  if coalesce(array_length(salida, 1), 0) = 0 then return null; end if;
  return salida;
end;
$$;

comment on function tc_ruedas_de_configuracion(text) is
  'Ruedas de cada eje a partir de la etiqueta de configuración. null si la '
  'etiqueta no se entiende: es mejor no saberlo que inventárselo.';

-- ── 2. Los tipos que tienen plano: el plano manda ───────────────────────────
with plano as (
  select tipo_vehiculo_id,
         count(*)::int            as ruedas,
         count(distinct eje)::int as ejes
    from tc_posiciones_vehiculo
   where activo
     and eje is not null
   group by tipo_vehiculo_id
)
update tc_tipos_vehiculo t
   set numero_ejes = p.ejes, numero_ruedas = p.ruedas
  from plano p
 where p.tipo_vehiculo_id = t.id
   and (t.numero_ejes, t.numero_ruedas) is distinct from (p.ejes, p.ruedas);

-- ── 3. Los que no tienen plano todavía: su configuración ────────────────────
update tc_tipos_vehiculo t
   set numero_ejes   = coalesce(array_length(r.ruedas, 1), t.numero_ejes),
       numero_ruedas = coalesce((select sum(x) from unnest(r.ruedas) as x)::int, t.numero_ruedas)
  from (select id, tc_ruedas_de_configuracion(configuracion_ejes) as ruedas
          from tc_tipos_vehiculo) r
 where r.id = t.id
   and r.ruedas is not null
   and not exists (select 1 from tc_posiciones_vehiculo p
                    where p.tipo_vehiculo_id = t.id and p.activo and p.eje is not null)
   and (t.numero_ejes, t.numero_ruedas)
       is distinct from (array_length(r.ruedas, 1),
                         (select sum(x) from unnest(r.ruedas) as x)::int);

-- ── 4. Lo que no cuadra, a la vista ─────────────────────────────────────────
-- Un tipo cuya etiqueta dice 2x4x2 (8 ruedas) y cuyo plano tiene 10 es un
-- plano que se generó con otra configuración y luego se cambió la etiqueta sin
-- rehacerlo. Arreglarlo a ciegas desde aquí desactivaría posiciones que quizá
-- tienen neumáticos montados, así que se listan y se corrigen desde la ficha
-- del vehículo, que ya sabe qué posiciones están ocupadas.
create or replace view tc_tipos_plano_descuadrado as
  select t.nombre,
         t.descripcion,
         t.configuracion_ejes,
         (select sum(x) from unnest(tc_ruedas_de_configuracion(t.configuracion_ejes)) as x)::int
           as ruedas_segun_la_etiqueta,
         (select count(*) from tc_posiciones_vehiculo p
           where p.tipo_vehiculo_id = t.id and p.activo and p.eje is not null)::int
           as ruedas_en_el_plano
    from tc_tipos_vehiculo t
   where t.activo
     and tc_ruedas_de_configuracion(t.configuracion_ejes) is not null
     and exists (select 1 from tc_posiciones_vehiculo p
                  where p.tipo_vehiculo_id = t.id and p.activo and p.eje is not null)
     and (select sum(x) from unnest(tc_ruedas_de_configuracion(t.configuracion_ejes)) as x)::int
         <> (select count(*) from tc_posiciones_vehiculo p
              where p.tipo_vehiculo_id = t.id and p.activo and p.eje is not null);

comment on view tc_tipos_plano_descuadrado is
  'Tipos cuya etiqueta de configuración de ejes no cuadra con las posiciones '
  'que tienen de verdad. Se revisan desde la ficha del vehículo ("corregir '
  'plano"), que sabe qué posiciones están ocupadas.';

grant select on tc_tipos_plano_descuadrado to authenticated;
