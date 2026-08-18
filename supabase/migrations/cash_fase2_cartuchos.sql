-- ============================================================
-- Mobilink Cash — Fase 2: cartuchos de monedas
--
-- Un cartucho no es otro tipo de dinero: es un envoltorio de 25 o 50
-- monedas iguales. Y tiene dos propiedades que mandan sobre el resto:
--
--   · Se abre y NO se vuelve a cerrar. Nadie reencartucha en el mostrador.
--   · Solo se abre si hace falta: si hay sueltas suficientes de esa misma
--     denominación, el precinto no se toca.
--
-- Hasta ahora los cartuchos solo existían como ayuda para contar en el
-- arqueo, y el stock eran piezas a secas. Eso dejaba al operador sin saber
-- que de las cuatro monedas de 1 € que le pide la pantalla solo una está
-- suelta y las otras tres están dentro de un tubo precintado.
--
-- `cantidad` sigue siendo SIEMPRE piezas. La columna nueva dice cuántos
-- tubos representa el asiento; en una fila de cartuchos `cantidad` vale
-- tubos × piezas_por_cartucho. Así el total de piezas sigue siendo la suma
-- de `cantidad` sin casos especiales, y las sueltas salen de filtrar por
-- cartuchos = 0.
--
-- Abrir un tubo son dos asientos con motivo CARTRIDGE_OPENED: sale el tubo
-- y entran sus monedas sueltas. El valor neto es cero y la trazabilidad se
-- conserva entera.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table cash_denomination_movements
  add column if not exists cartuchos integer not null default 0;

alter table cash_denomination_movements
  drop constraint if exists cash_denomination_movements_motivo_check;

alter table cash_denomination_movements
  add constraint cash_denomination_movements_motivo_check
  check (motivo in (
    'OPENING_FLOAT','CUSTOMER_PAYMENT','CHANGE_GIVEN','SUPPLIER_PAYMENT',
    'MANUAL_IN','MANUAL_OUT','CASH_DELIVERY','BANK_DEPOSIT','ADJUSTMENT',
    'CLOSING_FLOAT','CARTRIDGE_OPENED'));

create index if not exists cash_denmov_cartuchos_idx
  on cash_denomination_movements (session_id, denomination_id)
  where cartuchos > 0;
