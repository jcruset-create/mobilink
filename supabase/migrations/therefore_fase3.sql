-- ============================================================
-- Mobilink Therefore — Fase 3a: el parser del correo
--
-- El parser vive entero en código (server/therefore/domain/correo/) y no
-- necesita tablas nuevas. Lo que sí necesita son DOS COLUMNAS en las
-- actuaciones, porque hay dos cosas que hasta ahora se perdían:
--
--   accion_texto  El matiz literal de la instrucción. «MODIFICAR» y
--                 «MODIFICAR FECHA» normalizan a la misma acción, y quien lo
--                 grabe en el ERP necesita saber que lo que hay que cambiar es
--                 la fecha. Lo mismo con «Costes (modificar)». Guardar sólo el
--                 verbo es quedarse con la mitad de la frase.
--
--   orden         El orden en que se pidieron. `created_at` NO sirve: su valor
--                 por defecto es now(), que en PostgreSQL es la hora de inicio
--                 de la TRANSACCIÓN, así que las cuatro actuaciones de un mismo
--                 correo nacen con el mismo instante. El desempate caía en el
--                 UUID, que es aleatorio, y un correo que pide «graba éste y
--                 cambia la fecha de estos tres» salía barajado en pantalla.
--
-- EQUIVALENTE EN CÓDIGO: server/therefore/schema.ts (initTherefore).
--
-- Requiere therefore_fase1.sql. Idempotente.
-- ============================================================

do $$
begin
  if to_regclass('public.thf_actuaciones') is null then
    raise exception 'Falta therefore_fase1.sql: ejecútalo antes que éste';
  end if;
end $$;

alter table thf_actuaciones add column if not exists accion_texto text;

-- Al añadirlo, PostgreSQL rellena las filas que ya había en su orden físico,
-- que para lo que existe hoy es el de creación.
alter table thf_actuaciones add column if not exists orden bigserial;

-- ── Comprobación ────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_name = 'thf_actuaciones' and column_name in ('accion_texto', 'orden');
  if n <> 2 then raise exception 'Faltan columnas de la fase 3a: sólo hay %', n; end if;

  -- Que `orden` sea de verdad un contador y no una columna suelta: sin el
  -- valor por defecto, las actuaciones nuevas entrarían todas con NULL y la
  -- ordenación volvería a ser aleatoria sin que nada se quejara.
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'thf_actuaciones' and column_name = 'orden'
       and column_default like 'nextval%')
  then
    raise exception 'thf_actuaciones.orden no tiene secuencia: el orden no sería estable';
  end if;

  raise notice 'OK: Therefore fase 3a (matiz de la instrucción y orden de las actuaciones)';
end $$;
