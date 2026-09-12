-- ============================================================
-- TyreControl — de dónde salió el kilometraje de una revisión
--
-- `revisiones_vehiculo` ya tiene `km_vehiculo` y `origen_km`, y con eso se sabe
-- QUÉ número hay y de qué clase de fuente vino. Falta lo que decide si uno se
-- puede fiar de él: CUÁNDO se leyó.
--
-- La diferencia no es teórica. Las revisiones del CheckPoint se importan días
-- después de la medición —el informe de Bridgestone llega por correo—, así que
-- el kilometraje que se les atribuye es el odómetro que el proveedor daba en
-- otro momento. Un 512.480 km leído tres minutos antes del paso por el arco y
-- el mismo 512.480 leído ocho días después son el mismo número y no valen lo
-- mismo, y hoy son indistinguibles al mirar la fila.
--
-- Es lo mismo que la fase 8 ya exige para las operaciones de neumático: «un
-- kilometraje con Δ 47 min merece menos confianza que uno con Δ 12 s, y esa
-- diferencia tiene que quedar registrada, no perderse».
--
-- ── Por qué el desfase lleva signo ──────────────────────────────────────────
--
-- Negativo si la lectura es ANTERIOR a la medición. Y es el caso bueno: una
-- lectura de antes del paso por el arco no puede contener kilómetros
-- posteriores a él. Una lectura POSTERIOR sí podría, y por eso solo se admite
-- cuando se ha demostrado que el vehículo no se movió en medio. Guardar el
-- valor absoluto borraría justo la distinción que sostiene el dato.
--
-- ── Lo que NO se añade ──────────────────────────────────────────────────────
--
-- Ningún CHECK sobre `origen_km`: hoy es texto libre con `default 'manual'` y
-- ponerle uno ahora obligaría a inventariar lo que ya hay escrito en años de
-- filas. El valor nuevo es 'telematica', y el catálogo de valores vive en
-- `OrigenKm` (src/modules/tyrecontrol/types/index.ts), que es donde se lee.
--
-- Cambio ADITIVO: dos columnas que admiten null. Ninguna fila se toca, y una
-- revisión sin estos datos sigue siendo válida: significa «no se sabe cuándo se
-- leyó», que es la verdad de todas las anteriores a este cambio.
-- Idempotente.
-- ============================================================

alter table revisiones_vehiculo
  add column if not exists km_capturado_at timestamptz,
  add column if not exists km_desfase_min  int;

comment on column revisiones_vehiculo.km_capturado_at is
  'Instante en que el proveedor de telemática leyó ese odómetro, NO el de la '
  'medición ni el de la grabación. Null: no se sabe (kilometraje manual, o '
  'revisiones anteriores a que esto se registrara).';

comment on column revisiones_vehiculo.km_desfase_min is
  'Minutos entre la lectura del odómetro y el momento de la revisión, CON '
  'signo: negativo si la lectura es anterior. Es lo que permite decidir si el '
  'kilometraje es de fiar. Null cuando no se sabe.';

-- Comprobación: las dos columnas están y admiten null.
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_name = 'revisiones_vehiculo'
     and column_name in ('km_capturado_at', 'km_desfase_min')
     and is_nullable = 'YES';
  if n <> 2 then
    raise exception 'Faltan km_capturado_at / km_desfase_min en revisiones_vehiculo (encontradas: %)', n;
  end if;
  raise notice 'OK: la revisión ya puede decir cuándo se leyó su kilometraje';
end $$;
