-- Publicar los dos tarifarios SEAS 2026 y crear sus contratos.
--
-- ⚠ ESTO EMPIEZA A FACTURAR. Hasta ahora las versiones estaban en BORRADOR y
-- el motor no las miraba; al publicarlas, toda asistencia que se tarifique a
-- partir de su fecha de vigencia sale con estos precios. Léelo entero antes.
--
-- ── POR QUÉ UN SQL Y NO EL PANEL ───────────────────────────────────────────
--
-- Las tablas connect_* NO las gestiona supabase/migrations: las crea
-- initPricing() al arrancar el servidor. Este fichero vive aquí porque es
-- donde se buscan los SQL que se aplican a mano, pero NO se aplica solo:
-- hay que pegarlo en el editor SQL de Supabase y ejecutarlo.
--
-- Lo mismo se puede hacer desde el panel (Tarifas → Contratos, y el botón
-- Publicar de cada versión). Esto es el mismo trabajo dejado por escrito,
-- reproducible y revisable antes de tocar nada.
--
-- ── ANTES DE EJECUTAR: RELLENA ESTOS DOS NOMBRES ───────────────────────────
--
-- No los adivino. El contrato de venta apunta a un CLIENTE (a quién factura
-- la central) y el de compra a una EMPRESA PROVEEDORA (quién factura a la
-- central). Si el nombre no existe, el script se para con un mensaje claro:
-- prefiero eso a crear un contrato que apunte a quien no toca, porque un
-- contrato mal enlazado no da error, factura mal.
--
-- Para ver qué hay cargado:
--   SELECT id, name FROM connect_clients WHERE active ORDER BY name;
--   SELECT id, name FROM connect_provider_companies ORDER BY name;
--
-- ── ES IDEMPOTENTE ─────────────────────────────────────────────────────────
--
-- Ejecutarlo dos veces no duplica contratos ni republica nada: publicar solo
-- afecta a versiones en borrador, y los contratos se insertan solo si no
-- existe ya uno igual. Al final imprime lo que ha hecho.

DO $$
DECLARE
  -- ⇩⇩⇩ RELLENA AQUÍ ⇩⇩⇩
  v_centro_nombre  TEXT := 'Centro de Control SEA';
  v_cliente        TEXT := '';   -- p. ej. 'SEAS'
  v_proveedora     TEXT := '';   -- p. ej. 'SEA Tarragona'
  -- ⇧⇧⇧ RELLENA AQUÍ ⇧⇧⇧

  -- Desde cuándo rigen los contratos. El tarifario está vigente 2026-01-01 →
  -- 2027-01-01; el contrato puede empezar después, pero no debería empezar
  -- antes de que exista la tarifa.
  v_desde_ms       BIGINT := (EXTRACT(EPOCH FROM TIMESTAMP '2026-01-01 00:00:00+01') * 1000)::BIGINT;

  v_centro_id      INT;
  v_cliente_id     INT;
  v_proveedora_id  INT;
  v_plan_venta     INT;
  v_plan_compra    INT;
  v_ahora          BIGINT := (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT;
  v_publicadas     INT := 0;
  v_contratos      INT := 0;
  v_borradores     INT;
  v_n              INT;
  v_lista_cli      TEXT;
  v_lista_pro      TEXT;
BEGIN
  /*
   * Si faltan los nombres, se enseña el menú y se para.
   *
   * La lista va DENTRO del mensaje de la excepción, no en RAISE NOTICE: el
   * editor SQL de Supabase no muestra la salida de NOTICE, solo el error, así
   * que un NOTICE aquí se genera y se pierde. Lo comprobamos en vivo.
   */
  IF v_cliente = '' OR v_proveedora = '' THEN
    SELECT COALESCE(string_agg(format('  · «%s»  (id %s)', t.name, t.id), E'\n' ORDER BY t.name),
                    '  (ninguno: hay que dar de alta el cliente antes, en Clientes)')
      INTO v_lista_cli
      FROM (SELECT c.id, c.name FROM connect_clients c
             JOIN connect_control_centers cc
               ON cc.name = v_centro_nombre AND cc.id = c."controlCenterId"
            WHERE c.active) t;

    SELECT COALESCE(string_agg(format('  · «%s»  (id %s)', t.name, t.id), E'\n' ORDER BY t.name), '  (ninguna)')
      INTO v_lista_pro
      FROM (SELECT id, name FROM connect_provider_companies) t;

    RAISE EXCEPTION E'Rellena v_cliente y v_proveedora arriba y vuelve a ejecutar.\n\nCLIENTES ACTIVOS (a quién factura la central):\n%\n\nEMPRESAS PROVEEDORAS (quién factura a la central):\n%',
      v_lista_cli, v_lista_pro;
  END IF;

  SELECT id INTO v_centro_id FROM connect_control_centers
   WHERE name = v_centro_nombre AND "deletedAtMs" IS NULL;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'No existe el centro de control "%"', v_centro_nombre;
  END IF;

  -- Se resuelve por nombre EXIGIENDO que sea único. Con SELECT INTO a secas,
  -- dos filas con el mismo nombre darían una cualquiera y en silencio, y el
  -- contrato quedaría enlazado a quien no toca sin que nadie se entere.
  SELECT COUNT(*) INTO v_n FROM connect_clients
   WHERE "controlCenterId" = v_centro_id AND name = v_cliente AND active;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No existe el cliente activo "%" en este centro. Deja v_cliente en blanco y ejecuta para ver la lista.', v_cliente;
  ELSIF v_n > 1 THEN
    RAISE EXCEPTION 'Hay % clientes activos llamados "%". Desambigua por id: cambia la consulta a c.id = <id>.', v_n, v_cliente;
  END IF;
  SELECT id INTO v_cliente_id FROM connect_clients
   WHERE "controlCenterId" = v_centro_id AND name = v_cliente AND active;

  SELECT COUNT(*) INTO v_n FROM connect_provider_companies WHERE name = v_proveedora;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No existe la empresa proveedora "%". Deja v_proveedora en blanco y ejecuta para ver la lista.', v_proveedora;
  ELSIF v_n > 1 THEN
    RAISE EXCEPTION 'Hay % empresas proveedoras llamadas "%". Desambigua por id.', v_n, v_proveedora;
  END IF;
  SELECT id INTO v_proveedora_id FROM connect_provider_companies WHERE name = v_proveedora;

  SELECT id INTO v_plan_venta FROM connect_tariff_plans
   WHERE "controlCenterId" = v_centro_id AND code = 'SEAS_NACIONAL_VENTA';
  SELECT id INTO v_plan_compra FROM connect_tariff_plans
   WHERE "controlCenterId" = v_centro_id AND code = 'SEAS_NACIONAL_COMPRA';
  IF v_plan_venta IS NULL OR v_plan_compra IS NULL THEN
    RAISE EXCEPTION
      'Faltan los tarifarios SEAS_NACIONAL_VENTA / SEAS_NACIONAL_COMPRA en el centro %. Cárgalos antes (Puesta en marcha o el cargador del tarifario).',
      v_centro_id;
  END IF;

  -- ── 1. Publicar las versiones en borrador ────────────────────────────────
  --
  -- Solo se tocan las que están en 'draft': una versión ya publicada no se
  -- modifica nunca, y republicar reescribiría su fecha de publicación, que es
  -- justo el dato que explica desde cuándo factura.
  SELECT COUNT(*) INTO v_borradores
    FROM connect_tariff_versions
   WHERE "tariffPlanId" IN (v_plan_venta, v_plan_compra) AND status = 'draft';

  IF v_borradores = 0 THEN
    RAISE NOTICE 'No hay versiones en borrador: ya estaban publicadas.';
  END IF;

  UPDATE connect_tariff_versions
     SET status = 'published', "publishedAtMs" = v_ahora, "updatedAtMs" = v_ahora
   WHERE "tariffPlanId" IN (v_plan_venta, v_plan_compra)
     AND status = 'draft';
  GET DIAGNOSTICS v_publicadas = ROW_COUNT;

  -- ── 2. Contrato de VENTA: a quién le factura la central ──────────────────
  INSERT INTO connect_contracts
    ("controlCenterId", role, "clientId", "tariffPlanId", name, status,
     "validFromMs", priority, "createdAtMs", "updatedAtMs")
  SELECT v_centro_id, 'sale', v_cliente_id, v_plan_venta,
         'Venta ' || v_cliente || ' — SEAS Nacional 2026', 'active',
         v_desde_ms, 0, v_ahora, v_ahora
  WHERE NOT EXISTS (
    SELECT 1 FROM connect_contracts
     WHERE "controlCenterId" = v_centro_id AND role = 'sale'
       AND "clientId" = v_cliente_id AND "tariffPlanId" = v_plan_venta
       AND status = 'active'
  );
  GET DIAGNOSTICS v_contratos = ROW_COUNT;

  -- ── 3. Contrato de COMPRA: quién le factura a la central ─────────────────
  INSERT INTO connect_contracts
    ("controlCenterId", role, "providerCompanyId", "tariffPlanId", name, status,
     "validFromMs", priority, "createdAtMs", "updatedAtMs")
  SELECT v_centro_id, 'purchase', v_proveedora_id, v_plan_compra,
         'Compra ' || v_proveedora || ' — SEAS Nacional 2026', 'active',
         v_desde_ms, 0, v_ahora, v_ahora
  WHERE NOT EXISTS (
    SELECT 1 FROM connect_contracts
     WHERE "controlCenterId" = v_centro_id AND role = 'purchase'
       AND "providerCompanyId" = v_proveedora_id AND "tariffPlanId" = v_plan_compra
       AND status = 'active'
  );
  GET DIAGNOSTICS v_borradores = ROW_COUNT;
  v_contratos := v_contratos + v_borradores;

  RAISE NOTICE 'Centro %, cliente % (%), proveedora % (%)',
    v_centro_id, v_cliente, v_cliente_id, v_proveedora, v_proveedora_id;
  RAISE NOTICE 'Versiones publicadas ahora: %. Contratos creados ahora: %.',
    v_publicadas, v_contratos;
  RAISE NOTICE 'A partir de aquí el motor factura con estos precios. Tarifica dos o tres servicios reales y mira el margen antes de emitir nada.';
END $$;

-- ── COMPROBACIÓN ───────────────────────────────────────────────────────────
-- Ejecútala después: tiene que salir una fila por lado, publicada y con su
-- contrato activo. Si alguna sale sin contrato o en borrador, el motor
-- responderá NO_TARIFF_PLAN y no facturará nada.

SELECT p.code                              AS tarifario,
       v.version,
       v.status                            AS version_estado,
       to_timestamp(v."validFromMs"/1000)::date  AS vigente_desde,
       c.role                              AS contrato,
       c.status                            AS contrato_estado,
       COALESCE(cl.name, pc.name)          AS contraparte
  FROM connect_tariff_plans p
  JOIN connect_tariff_versions v ON v."tariffPlanId" = p.id
  LEFT JOIN connect_contracts c ON c."tariffPlanId" = p.id AND c.status = 'active'
  LEFT JOIN connect_clients cl ON cl.id = c."clientId"
  LEFT JOIN connect_provider_companies pc ON pc.id = c."providerCompanyId"
 WHERE p.code IN ('SEAS_NACIONAL_VENTA', 'SEAS_NACIONAL_COMPRA')
 ORDER BY p.code, v.version;
