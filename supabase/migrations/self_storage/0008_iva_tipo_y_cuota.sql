-- =============================================================================
-- Mobilink Self Storage · 0008 · IVA: tipo (porcentaje) frente a cuota (euros)
-- =============================================================================
--
-- Vocabulario, en todo el módulo:
--   · tipo de IVA  = PORCENTAJE (21.00, 10.00, 4.00, 0.00). Columnas
--     `tax_rate` (trasteros, contratos, conceptos, líneas) y el ajuste
--     `default_vat_rate`. Es lo que en el resto de la documentación se llama
--     `vat_rate`.
--   · cuota de IVA = IMPORTE en euros (4.34). Columnas `vat_amount` (trastero)
--     y `tax_amount` / `tax` (líneas y facturas). Es la `cuota_iva` del CSV.
--
-- Qué cambia:
--   1. El IVA general es un ajuste POR EMPRESA (`default_vat_rate`). Se copia
--      el valor del ajuste antiguo `units.default_rental_tax_rate` si existía.
--   2. El trastero guarda su precio comercial como base + CUOTA + PVP. La
--      regla pasa a ser base + cuota = PVP (±0,01 €); el tipo de IVA del
--      trastero queda como dato informativo (el IVA general al fijar el precio)
--      y deja de atarse por CHECK al PVP.
--   3. Datos mal importados: un trastero cuyo `tax_rate` contenía una CUOTA en
--      euros leída como porcentaje se corrige (ver el bloque 3), dejando rastro
--      en la auditoría con los valores anteriores. No se borra nada (bloque 4).
--   4. Conceptos del catálogo con política de IVA: `inherit_default` (usa el
--      IVA general) o `custom` (su propio tipo).
--
-- Contratos y facturas NO se tocan: son fotografías fiscales (D3).
-- =============================================================================

-- ── 1. IVA general por empresa ──────────────────────────────────────────────
INSERT INTO self_storage_settings (empresa_id, center_id, key, value, updated_by, updated_at)
SELECT s.empresa_id, s.center_id, 'default_vat_rate', s.value, s.updated_by, s.updated_at
  FROM self_storage_settings s
 WHERE s.key = 'units.default_rental_tax_rate'
ON CONFLICT DO NOTHING;

-- ── 2. Cuota de IVA del trastero ────────────────────────────────────────────
ALTER TABLE self_storage_units ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2) NULL;

-- ── 3. Regla nueva del precio del trastero ──────────────────────────────────
-- Fuera el CHECK antiguo (PVP = base × (1 + tipo)): ahora manda la cuota.
ALTER TABLE self_storage_units DROP CONSTRAINT IF EXISTS self_storage_units_gross_chk;

-- Quien inserte sin cuota (una carga a mano por SQL, código antiguo) no
-- rompe: la cuota es lo que separa base y PVP.
CREATE OR REPLACE FUNCTION self_storage_units_vat_amount_default() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vat_amount IS NULL THEN
    NEW.vat_amount := NEW.monthly_price_gross - NEW.monthly_price;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS self_storage_units_vat_amount_default ON self_storage_units;
CREATE TRIGGER self_storage_units_vat_amount_default BEFORE INSERT ON self_storage_units
  FOR EACH ROW EXECUTE FUNCTION self_storage_units_vat_amount_default();

-- Lo existente: la cuota es lo que separa base y PVP (exacto, sin redondeos nuevos).
UPDATE self_storage_units SET vat_amount = monthly_price_gross - monthly_price WHERE vat_amount IS NULL;
ALTER TABLE self_storage_units ALTER COLUMN vat_amount SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE self_storage_units ADD CONSTRAINT self_storage_units_vat_amount_chk
    CHECK (vat_amount >= 0 AND abs(monthly_price + vat_amount - monthly_price_gross) <= 0.01);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Corrección de cuotas leídas como porcentaje ──────────────────────────
-- Señal inequívoca: el «tipo» guardado es justo la cuota en euros del IVA
-- general sobre la base (base × IVA general / 100, al céntimo). Ej.: base
-- 20,66 con tax_rate 4,34 cuando el IVA general es 21 → 20,66 × 0,21 = 4,34.
-- Un tipo de verdad no coincide con eso salvo casualidad, y para descartar la
-- casualidad se exige además que NO sea el propio IVA general.
-- El PVP bueno era base + cuota; el que se guardó (base × (1 + cuota/100))
-- estaba mal calculado y queda en la auditoría. Se comprueba en cada arranque
-- (idempotente: una fila ya corregida tiene el tipo general y no vuelve a
-- entrar), así que también cubre una importación antigua aplicada tarde.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT u.id, u.empresa_id, u.code, u.monthly_price AS base, u.tax_rate AS falso, u.monthly_price_gross AS pvp_antes,
           coalesce((SELECT (s.value #>> '{}')::numeric FROM self_storage_settings s
                      WHERE s.empresa_id = u.empresa_id AND s.center_id IS NULL AND s.key = 'default_vat_rate'
                      LIMIT 1), 21.00) AS general
      FROM self_storage_units u
  LOOP
    -- Y el PVP guardado es el que salía de tratar la cuota como porcentaje.
    IF r.base > 0 AND r.falso <> r.general
       AND abs(r.falso - round(r.base * r.general / 100, 2)) <= 0.01
       AND abs(r.pvp_antes - r.base * (1 + r.falso / 100)) <= 0.01 THEN
      UPDATE self_storage_units
         SET vat_amount = r.falso, tax_rate = r.general, monthly_price_gross = r.base + r.falso
       WHERE id = r.id;
      INSERT INTO self_storage_audit_logs (empresa_id, actor_type, actor_name, action, entity_type, entity_id, before, after)
      VALUES (r.empresa_id, 'system', 'Migración 0008', 'unit.vat_fixed', 'unit', r.id,
              jsonb_build_object('code', r.code, 'taxRate', r.falso, 'monthlyPriceGross', r.pvp_antes),
              jsonb_build_object('taxRate', r.general, 'vatAmount', r.falso, 'monthlyPriceGross', r.base + r.falso,
                                 'motivo', 'La cuota de IVA en euros se había leído como porcentaje'));
    END IF;
  END LOOP;
END $$;

-- El resto: la cuota es lo que separa base y PVP (exacto, sin redondeos nuevos).

-- ── 5. Política de IVA de los conceptos ─────────────────────────────────────
ALTER TABLE self_storage_billing_items ADD COLUMN IF NOT EXISTS vat_policy text NOT NULL DEFAULT 'custom';
ALTER TABLE self_storage_billing_items ALTER COLUMN tax_rate DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE self_storage_billing_items ADD CONSTRAINT self_storage_billing_items_vat_policy_chk
    CHECK (vat_policy IN ('inherit_default','custom') AND (vat_policy = 'inherit_default' OR tax_rate IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Los conceptos de partida que llevaban el IVA general pasan a HEREDARLO (sin
-- cambiar su tipo efectivo: sólo los que coinciden con el general). El
-- `tax_rate` antiguo se conserva en la fila.
UPDATE self_storage_billing_items b
   SET vat_policy = 'inherit_default'
 WHERE b.vat_policy = 'custom'
   AND b.code IN ('RENT','LOCK','SETUP','DISCOUNT','OTHER')
   AND b.tax_rate = coalesce((SELECT (s.value #>> '{}')::numeric FROM self_storage_settings s
                               WHERE s.empresa_id = b.empresa_id AND s.center_id IS NULL AND s.key = 'default_vat_rate'
                               LIMIT 1), 21.00);
