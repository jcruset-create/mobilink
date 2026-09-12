/**
 * Los enlaces de vehículo, contra una base de verdad.
 *
 * Aquí se comprueba lo que solo puede comprobar PostgreSQL: los dos índices
 * únicos parciales que sostienen la invariante «un vehículo, un enlace activo
 * por cuenta». La validación del servicio da un mensaje entendible, pero entre
 * leer y escribir cabe otra pestaña, y quien de verdad tiene que parar una
 * carrera es la base.
 *
 * Se comprueba también lo contrario, que es igual de importante: que esos
 * índices NO estorban a los mapeos de otros tipos de entidad. Un producto o un
 * cliente sí pueden vivir en varias empresas del mismo ERP, y ese caso lo
 * declara explícitamente el comentario de la UNIQUE general.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let repo: typeof import("./repositories.ts");

const TENANT = `tenant-enlaces-${String(process.hrtime.bigint()).slice(-9)}`;
const OTRO_TENANT = `${TENANT}-bis`;
const CONECTOR = "movertis";

/** Inserta saltándose el upsert, para provocar el choque a nivel de índice. */
async function insertarCrudo(over: Record<string, unknown>) {
  const f = {
    tenant_id: TENANT,
    entity_type: "vehicle",
    system: CONECTOR,
    account_key: "buses",
    external_code: "E1",
    mobilink_id: "v1",
    active: true,
    ...over,
  };
  return db.query(
    `INSERT INTO integration_mappings
       (tenant_id, entity_type, system, account_key, external_code, mobilink_id, active,
        created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    [f.tenant_id, f.entity_type, f.system, f.account_key, f.external_code, f.mobilink_id, f.active, Date.now()],
  );
}

describe.skipIf(!RUN)("Enlaces de vehículo", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    const { initDb } = await import("../../db.ts");
    await initDb();
    const { initIntegrationHub } = await import("../index.ts");
    await initIntegrationHub();
    repo = await import("./repositories.ts");
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    for (const t of [TENANT, OTRO_TENANT]) {
      await db.query(`DELETE FROM integration_mappings WHERE tenant_id = $1`, [t]).catch(() => {});
      await db.query(`DELETE FROM integration_ignored_externals WHERE tenant_id = $1`, [t]).catch(() => {});
    }
  });

  describe("invariante: un vehículo, un enlace activo por cuenta", () => {
    it("un mismo vehículo no puede tener dos equipos activos en la misma cuenta", async () => {
      await insertarCrudo({ mobilink_id: "veh-A", external_code: "EQ-1" });
      await expect(
        insertarCrudo({ mobilink_id: "veh-A", external_code: "EQ-2" }),
      ).rejects.toThrow(/ihmap_vehiculo_un_enlace_activo|duplicate key/i);
    });

    it("un mismo equipo no puede quedar repartido entre dos vehículos", async () => {
      await insertarCrudo({ mobilink_id: "veh-B", external_code: "EQ-3" });
      await expect(
        insertarCrudo({ mobilink_id: "veh-C", external_code: "EQ-3" }),
      ).rejects.toThrow(/duplicate key/i);
    });

    it("pero sí puede tener otro enlace si el anterior está DESACTIVADO", async () => {
      await insertarCrudo({ mobilink_id: "veh-D", external_code: "EQ-4", active: false });
      await expect(
        insertarCrudo({ mobilink_id: "veh-D", external_code: "EQ-5" }),
      ).resolves.toBeTruthy();
    });

    it("el mismo equipo puede existir en OTRA cuenta del mismo cliente", async () => {
      await insertarCrudo({ mobilink_id: "veh-E", external_code: "EQ-6", account_key: "buses" });
      await expect(
        insertarCrudo({ mobilink_id: "veh-F", external_code: "EQ-6", account_key: "auxiliar" }),
      ).resolves.toBeTruthy();
    });

    it("el mismo equipo puede existir en OTRO cliente", async () => {
      await insertarCrudo({ mobilink_id: "veh-G", external_code: "EQ-7" });
      await expect(
        insertarCrudo({ tenant_id: OTRO_TENANT, mobilink_id: "veh-H", external_code: "EQ-7" }),
      ).resolves.toBeTruthy();
    });

    it("no estorba a los mapeos que NO son de vehículo", async () => {
      // Una entidad de Mobilink puede vivir en varias empresas del mismo ERP:
      // es el caso que la UNIQUE general protege a propósito.
      await insertarCrudo({ entity_type: "product", mobilink_id: "prod-1", external_code: "P-1" });
      await expect(
        insertarCrudo({ entity_type: "product", mobilink_id: "prod-1", external_code: "P-2" }),
      ).resolves.toBeTruthy();
    });
  });

  describe("desvincular conserva el histórico", () => {
    it("desactiva la fila, no la borra, y deja de resolverse", async () => {
      await repo.upsertMapping({
        tenantId: TENANT,
        entityType: "vehicle",
        system: CONECTOR,
        accountKey: "hist",
        externalCode: "EQ-H",
        mobilinkId: "veh-H1",
        metadata: { match_method: "manual" },
      });
      expect(
        await repo.findExternalCode({
          tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
          mobilinkId: "veh-H1", accountKey: "hist",
        }),
      ).toBe("EQ-H");

      const fila = await repo.setVehicleMappingActive({
        tenantId: TENANT, system: CONECTOR, accountKey: "hist",
        mobilinkId: "veh-H1", externalCode: "EQ-H", active: false,
      });
      expect(fila?.active).toBe(false);

      // Ya no se resuelve: es lo que hace que el odómetro deje de preguntar.
      expect(
        await repo.findExternalCode({
          tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
          mobilinkId: "veh-H1", accountKey: "hist",
        }),
      ).toBeNull();

      // Pero la fila sigue ahí, con su metadata.
      const todos = await repo.listVehicleMappings({ tenantId: TENANT, system: CONECTOR, accountKey: "hist" });
      const guardado = todos.find((m) => m.external_code === "EQ-H");
      expect(guardado).toBeTruthy();
      expect((guardado!.metadata as any)?.match_method).toBe("manual");
    });

    it("volver a vincular lo reactiva", async () => {
      await repo.upsertMapping({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "hist",
        externalCode: "EQ-H", mobilinkId: "veh-H1", active: true,
      });
      expect(
        await repo.findExternalCode({
          tenantId: TENANT, entityType: "vehicle", system: CONECTOR,
          mobilinkId: "veh-H1", accountKey: "hist",
        }),
      ).toBe("EQ-H");
    });
  });

  describe("last_seen_at", () => {
    it("solo se toca en los códigos que se le pasan", async () => {
      await repo.upsertMapping({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "seen",
        externalCode: "VISTO", mobilinkId: "veh-S1",
      });
      await repo.upsertMapping({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "seen",
        externalCode: "NO-VISTO", mobilinkId: "veh-S2",
      });

      const tocados = await repo.touchVehiclesLastSeen({
        tenantId: TENANT, system: CONECTOR, accountKey: "seen",
        externalCodes: ["VISTO"], at: 1_700_000_000_000,
      });
      expect(tocados).toBe(1);

      const filas = await repo.listVehicleMappings({ tenantId: TENANT, system: CONECTOR, accountKey: "seen" });
      const visto = filas.find((f) => f.external_code === "VISTO") as any;
      const noVisto = filas.find((f) => f.external_code === "NO-VISTO") as any;
      expect(Number(visto.last_seen_at_ms)).toBe(1_700_000_000_000);
      // El que no venía en la respuesta se queda como estaba: es lo que separa
      // «retirado» de «no se ha podido preguntar».
      expect(noVisto.last_seen_at_ms).toBeNull();
    });

    it("una lista vacía no toca nada", async () => {
      expect(
        await repo.touchVehiclesLastSeen({
          tenantId: TENANT, system: CONECTOR, accountKey: "seen", externalCodes: [],
        }),
      ).toBe(0);
    });
  });

  describe("externos ignorados", () => {
    it("se ignoran, se listan y se pueden dejar de ignorar", async () => {
      await repo.ignoreExternal({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "ign",
        externalCode: "AUX-1", reason: "remolque auxiliar",
      });
      let lista = await repo.listIgnoredExternals({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "ign",
      });
      expect(lista.map((i) => i.external_code)).toEqual(["AUX-1"]);
      expect(lista[0].reason).toBe("remolque auxiliar");

      // Ignorar dos veces no revienta ni duplica.
      await repo.ignoreExternal({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "ign",
        externalCode: "AUX-1", reason: "otro motivo",
      });
      lista = await repo.listIgnoredExternals({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "ign",
      });
      expect(lista).toHaveLength(1);
      expect(lista[0].reason).toBe("otro motivo");

      expect(
        await repo.unignoreExternal({
          tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "ign", externalCode: "AUX-1",
        }),
      ).toBe(true);
      expect(
        await repo.unignoreExternal({
          tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "ign", externalCode: "AUX-1",
        }),
      ).toBe(false);
    });

    it("no se mezclan entre cuentas", async () => {
      await repo.ignoreExternal({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "cuenta-1", externalCode: "X",
      });
      const otra = await repo.listIgnoredExternals({
        tenantId: TENANT, entityType: "vehicle", system: CONECTOR, accountKey: "cuenta-2",
      });
      expect(otra).toHaveLength(0);
    });
  });
});
