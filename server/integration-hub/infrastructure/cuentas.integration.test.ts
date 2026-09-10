/**
 * Varias cuentas del mismo proveedor para el mismo cliente.
 *
 * Antes, `integration_connector_configs` tenía UNIQUE (tenant_id,
 * connector_key): exactamente una cuenta por cliente y conector. Con un ERP
 * basta; con telemática no, porque un cliente puede tener dos cuentas del mismo
 * proveedor —la flota de autobuses y la auxiliar— cada una con su token.
 *
 * Aquí se comprueba lo que ese cambio tiene que garantizar:
 *
 *  - que caben dos cuentas y no se pisan,
 *  - que lo que ya existía sigue funcionando sin tocar nada ('default'),
 *  - que un identificador externo puede repetirse entre cuentas pero no dentro,
 *  - y que el cambio de clave única se puede aplicar dos veces seguidas, porque
 *    se ejecuta en CADA arranque del servidor.
 *
 * Esto último es lo que más justifica una prueba con base real: un
 * `ALTER TABLE ... ADD CONSTRAINT` no admite `IF NOT EXISTS`, así que la
 * segunda pasada tiene que decidir por su cuenta que no hay nada que hacer. Si
 * se equivoca, el servidor no arranca.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let repo: typeof import("./repositories.ts");
let initIntegrationHub: typeof import("../index.ts").initIntegrationHub;

// Un tenant propio por ejecución: así las pruebas no se pisan entre sí ni
// dejan nada que estorbe a las de al lado.
const TENANT = `tenant-cuentas-${String(process.hrtime.bigint()).slice(-9)}`;
const CONECTOR = "movertis";

describe.skipIf(!RUN)("Cuentas múltiples por cliente y conector", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    const { initDb } = await import("../../db.ts");
    await initDb();
    ({ initIntegrationHub } = await import("../index.ts"));
    await initIntegrationHub();
    repo = await import("./repositories.ts");
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`DELETE FROM integration_connector_configs WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await db.query(`DELETE FROM integration_mappings WHERE tenant_id = $1`, [TENANT]).catch(() => {});
  });

  it("el esquema se puede inicializar dos veces seguidas", async () => {
    // Es lo que pasa en cada despliegue: el servidor arranca y vuelve a pasar
    // por aquí con el cambio de clave única ya aplicado.
    await expect(initIntegrationHub()).resolves.not.toThrow();
  }, 60_000);

  it("caben dos cuentas del mismo proveedor y no se pisan", async () => {
    await repo.upsertConnectorConfig({
      tenantId: TENANT, connectorKey: CONECTOR, accountKey: "autobuses",
      name: "Plana autobuses", enabled: true, config: { base_url: "https://uno" },
    });
    await repo.upsertConnectorConfig({
      tenantId: TENANT, connectorKey: CONECTOR, accountKey: "auxiliar",
      name: "Plana auxiliar", enabled: false, config: { base_url: "https://dos" },
    });

    const autobuses = await repo.getConnectorConfig(TENANT, CONECTOR, "autobuses");
    const auxiliar = await repo.getConnectorConfig(TENANT, CONECTOR, "auxiliar");

    expect(autobuses.name).toBe("Plana autobuses");
    expect(autobuses.enabled).toBe(true);
    expect(autobuses.config.base_url).toBe("https://uno");

    expect(auxiliar.name).toBe("Plana auxiliar");
    expect(auxiliar.enabled).toBe(false);
    expect(auxiliar.config.base_url).toBe("https://dos");

    const todas = await repo.listConnectorConfigs(TENANT);
    expect(todas.filter((c: any) => c.connector_key === CONECTOR)).toHaveLength(2);
  });

  it("quien no indica cuenta sigue trabajando con 'default'", async () => {
    // Es el caso de todo lo que ya existía: Business Central y compañía nunca
    // han mandado accountKey y no deben tener que empezar a hacerlo.
    await repo.upsertConnectorConfig({
      tenantId: TENANT, connectorKey: "business-central",
      enabled: true, config: { company: "889" },
    });

    const cfg = await repo.getConnectorConfig(TENANT, "business-central");
    expect(cfg.account_key).toBe("default");
    expect(cfg.config.company).toBe("889");
  });

  it("guardar sin nombre no borra el que ya tenía la cuenta", async () => {
    // Desactivar una integración desde el panel no puede dejarla sin nombre.
    await repo.upsertConnectorConfig({
      tenantId: TENANT, connectorKey: CONECTOR, accountKey: "autobuses",
      enabled: false, config: { base_url: "https://uno" },
    });
    const cfg = await repo.getConnectorConfig(TENANT, CONECTOR, "autobuses");
    expect(cfg.name).toBe("Plana autobuses");
    expect(cfg.enabled).toBe(false);
  });

  it("el mismo id externo puede existir en dos cuentas, y son mapeos distintos", async () => {
    await repo.upsertMapping({
      tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
      accountKey: "autobuses", externalCode: "25269015", mobilinkId: "veh-A",
    });
    await repo.upsertMapping({
      tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
      accountKey: "auxiliar", externalCode: "25269015", mobilinkId: "veh-B",
    });

    expect(await repo.findMobilinkId({
      tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
      accountKey: "autobuses", externalCode: "25269015",
    })).toBe("veh-A");

    expect(await repo.findMobilinkId({
      tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
      accountKey: "auxiliar", externalCode: "25269015",
    })).toBe("veh-B");
  });

  it("dentro de una cuenta, el id externo sigue siendo único", async () => {
    // Reenviar el mismo par actualiza la fila, no crea otra: si no, dos
    // vehículos de TyreControl acabarían apuntando a la misma unidad.
    await repo.upsertMapping({
      tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
      accountKey: "autobuses", externalCode: "25269015", mobilinkId: "veh-C",
    });

    const { rows } = await db.query(
      `SELECT mobilink_id FROM integration_mappings
        WHERE tenant_id = $1 AND system = $2 AND account_key = 'autobuses'
          AND external_code = '25269015'`,
      [TENANT, CONECTOR]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].mobilink_id).toBe("veh-C");
  });

  it("los mapeos nacen activos", async () => {
    const { rows } = await db.query(
      `SELECT active FROM integration_mappings WHERE tenant_id = $1 LIMIT 1`,
      [TENANT]
    );
    expect(rows[0].active).toBe(true);
  });

  it("la búsqueda va acotada a su cuenta y no se cuela en la de al lado", async () => {
    expect(await repo.findExternalCode({
      tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
      accountKey: "auxiliar", mobilinkId: "veh-B",
    })).toBe("25269015");

    // veh-B es de la cuenta auxiliar: preguntando por autobuses no aparece.
    expect(await repo.findExternalCode({
      tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
      accountKey: "autobuses", mobilinkId: "veh-B",
    })).toBeNull();
  });
});
