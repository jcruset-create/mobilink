/**
 * El número de cliente del ERP, contra PostgreSQL de verdad.
 *
 * Contra base y no con dobles porque lo que puede salir mal aquí es de la base:
 * en `integration_mappings` conviven los enlaces de TODOS los sistemas, la
 * clave única va por código externo y no por cliente, y cambiar un número son
 * dos operaciones. Nada de eso se comprueba fingiendo las consultas.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

describeSiHayBase("número de cliente ERP", () => {
  let db: any;
  let guardarCodigoErp: typeof import("./codigoErp.ts").guardarCodigoErp;
  let SISTEMA_ERP: string;
  let A = 0;
  let B = 0;

  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const mod = await import("./codigoErp.ts");
    guardarCodigoErp = mod.guardarCodigoErp;
    SISTEMA_ERP = mod.SISTEMA_ERP;

    const ahora = Date.now();
    const crea = async (nombre: string) =>
      Number(
        (
          await db.query(
            `INSERT INTO connect_clients (name, active, "createdAtMs", "updatedAtMs")
             VALUES ($1, true, $2, $2) RETURNING id`,
            [nombre, ahora]
          )
        ).rows[0].id
      );
    A = await crea(`ERP prueba A ${ahora}`);
    B = await crea(`ERP prueba B ${ahora}`);
  });

  beforeEach(async () => {
    await db.query(
      `DELETE FROM integration_mappings WHERE entity_type = 'customer' AND mobilink_id = ANY($1)`,
      [[String(A), String(B)]]
    );
  });

  afterAll(async () => {
    await db.query(
      `DELETE FROM integration_mappings WHERE entity_type = 'customer' AND mobilink_id = ANY($1)`,
      [[String(A), String(B)]]
    );
    await db.query(`DELETE FROM connect_clients WHERE id = ANY($1)`, [[A, B]]);
  });

  /** El número que tiene guardado un cliente, leyendo como lee el listado. */
  async function codigoDe(clienteId: number): Promise<string | null> {
    const r = await db.query(
      `SELECT external_code FROM integration_mappings
        WHERE entity_type = 'customer' AND system = $2 AND mobilink_id = $1`,
      [String(clienteId), SISTEMA_ERP]
    );
    return r.rows[0]?.external_code ?? null;
  }

  it("se guarda y se lee", async () => {
    expect(await guardarCodigoErp(A, "43021")).toEqual({ ok: true, codigo: "43021" });
    expect(await codigoDe(A)).toBe("43021");
  });

  it("los espacios de sobra no entran", async () => {
    // Se pegan del ERP con espacios delante, y «43021 » no casa con «43021».
    await guardarCodigoErp(A, "  43021  ");
    expect(await codigoDe(A)).toBe("43021");
  });

  it("cambiarlo deja UNO, no dos", async () => {
    /*
     * La clave única de la tabla va por código externo, no por cliente, así que
     * cambiar el número es borrar una fila y poner otra. Si se hiciera con un
     * INSERT a secas, el cliente acabaría con dos números y el listado
     * enseñaría el que tocara.
     */
    await guardarCodigoErp(A, "43021");
    await guardarCodigoErp(A, "43022");
    const r = await db.query(
      `SELECT external_code FROM integration_mappings
        WHERE entity_type = 'customer' AND system = $2 AND mobilink_id = $1`,
      [String(A), SISTEMA_ERP]
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].external_code).toBe("43022");
  });

  it("vacío lo quita, que es cómo se deshace un número mal puesto", async () => {
    await guardarCodigoErp(A, "43021");
    expect(await guardarCodigoErp(A, "")).toEqual({ ok: true, codigo: null });
    expect(await codigoDe(A)).toBeNull();
  });

  it("quitarlo cuando no había no es un error", async () => {
    expect(await guardarCodigoErp(A, "")).toEqual({ ok: true, codigo: null });
  });

  it("dos clientes no pueden compartir número, y se dice de quién es", async () => {
    /*
     * En el ERP el número es la clave de la ficha. Dos fichas de Mobilink
     * apuntando a la misma del ERP haría que las facturas de una salieran a
     * nombre de la otra, y eso no se ve hasta que lo ve el cliente.
     */
    await guardarCodigoErp(A, "43021");
    const r = await guardarCodigoErp(B, "43021");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toContain("43021");
      expect(r.error).toContain("ERP prueba A");
    }
    expect(await codigoDe(B)).toBeNull();
  });

  it("volver a ponerle a uno el número que ya tenía no choca consigo mismo", async () => {
    await guardarCodigoErp(A, "43021");
    expect(await guardarCodigoErp(A, "43021")).toEqual({ ok: true, codigo: "43021" });
    expect(await codigoDe(A)).toBe("43021");
  });

  it("un cliente que no existe no se enlaza", async () => {
    const r = await guardarCodigoErp(999_999_999, "43021");
    expect(r.ok).toBe(false);
  });

  it("no toca el enlace de TyreControl del mismo cliente", async () => {
    /*
     * El de TyreControl es también de tipo «customer» y vive en la misma tabla.
     * Antes se leía «el mapeo más reciente, sea de donde sea», y un cliente con
     * correspondencia de TC enseñaba el identificador de TC como su número de
     * ERP. Aquí se comprueba que son dos cosas que conviven.
     */
    const ahora = Date.now();
    await db.query(
      `INSERT INTO integration_mappings
         (tenant_id, entity_type, system, external_code, mobilink_id, created_at_ms, updated_at_ms)
       VALUES ('assist','customer','tyrecontrol','TC-77',$1,$2,$2)`,
      [String(A), ahora]
    );

    await guardarCodigoErp(A, "43021");

    expect(await codigoDe(A)).toBe("43021");
    const tc = await db.query(
      `SELECT external_code FROM integration_mappings
        WHERE entity_type = 'customer' AND system = 'tyrecontrol' AND mobilink_id = $1`,
      [String(A)]
    );
    expect(tc.rows[0]?.external_code).toBe("TC-77");

    // Y quitar el del ERP tampoco se lleva el de TyreControl por delante.
    await guardarCodigoErp(A, "");
    const tc2 = await db.query(
      `SELECT external_code FROM integration_mappings
        WHERE entity_type = 'customer' AND system = 'tyrecontrol' AND mobilink_id = $1`,
      [String(A)]
    );
    expect(tc2.rows[0]?.external_code).toBe("TC-77");
  });
});
