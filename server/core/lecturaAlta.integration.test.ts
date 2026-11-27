/**
 * La lectura de la documentación de un alta, contra Postgres y con una
 * «IA» de mentira que lee lo que se le diga.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

import type { Lectura } from "./altaOperario.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_lectura_alta_${process.pid}`;
const ANA = "1a1a1a1a-0000-4000-a000-000000000001";
const PEP = "1b1b1b1b-0000-4000-a000-000000000002";

let conexion: PoolClient;
let mod: typeof import("./lecturaAlta.ts");

const lectura = (dni: string, clases: Array<[string, string]>): Lectura =>
  ({
    identidad: { numero: dni, caducidad: "2031-05-10", nota: "" },
    carnet: {
      numero: dni,
      caducidad: "2030-01-01",
      clases: clases.map(([clase, caducidad]) => ({ clase, caducidad })),
      capNumero: null,
      capCaducidad: null,
      nota: "",
    },
  }) as unknown as Lectura;

let n = 0;
/** Un envío, de hace `dias` días. Devuelve su id. */
async function envio(de: string, dias: number, leida: Lectura | null = null, estado = "recibida"): Promise<string> {
  n += 1;
  const { rows } = await conexion.query(
    `INSERT INTO sea_employee_invites (employee_id, token_hash, estado, enviado_at, lectura, leido_at)
     VALUES ($1, $2, $3, now() - make_interval(days => $4), $5, CASE WHEN $5::jsonb IS NULL THEN NULL ELSE now() - make_interval(days => $4) END)
     RETURNING id`,
    [de, `hash-${n}`, estado, dias, leida ? JSON.stringify(leida) : null]
  );
  return rows[0].id;
}
const guardada = async (id: string) =>
  (await conexion.query(`SELECT lectura, leido_at FROM sea_employee_invites WHERE id = $1`, [id])).rows[0];

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./lecturaAlta.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_employees (id uuid PRIMARY KEY, nombre text NOT NULL);
    CREATE TABLE sea_employee_invites (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id uuid NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
      token_hash  text NOT NULL UNIQUE,
      estado      text NOT NULL DEFAULT 'enviado',
      enviado_at  timestamptz NOT NULL DEFAULT now(),
      lectura     jsonb,
      leido_at    timestamptz
    );
    INSERT INTO sea_employees (id, nombre) VALUES ('${ANA}', 'Ana'), ('${PEP}', 'Pep');
  `);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("qué lectura se enseña", () => {
  beforeEach(async () => {
    await conexion.query(`DELETE FROM sea_employee_invites`);
  });

  it("si nunca se ha leído nada, ninguna", async () => {
    await envio(ANA, 1);
    expect(await mod.lecturaVigente(conexion, ANA)).toBeNull();
    expect(await mod.lecturaVigente(conexion, PEP)).toBeNull();
  });

  it("la del último envío, si está leído", async () => {
    await envio(ANA, 5, lectura("11111111A", [["B", "2029-01-01"]]));
    await envio(ANA, 1, lectura("22222222B", [["B", "2032-01-01"]]));
    const v = await mod.lecturaVigente(conexion, ANA);
    expect(v?.lectura.identidad.numero).toBe("22222222B");
    expect(v?.deEnvioAnterior).toBe(false);
    expect(v?.leidoAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("pedir una actualización NO borra la lectura que había: se sigue enseñando, avisando de que es anterior", async () => {
    // Se leyó con el envío de hace cuatro días…
    const primero = await envio(ANA, 4, lectura("39882775Q", [["B", "2033-06-25"], ["C", "2028-06-25"]]));
    // …y hoy se le ha mandado otro enlace, que ha llegado sin leer.
    await envio(ANA, 0);

    const v = await mod.lecturaVigente(conexion, ANA);
    expect(v?.lectura.carnet.clases).toEqual([
      { clase: "B", caducidad: "2033-06-25" },
      { clase: "C", caducidad: "2028-06-25" },
    ]);
    expect(v?.deEnvioAnterior).toBe(true);
    // Y sigue en la base, en su envío, sin tocar.
    expect((await guardada(primero)).lectura.identidad.numero).toBe("39882775Q");
  });

  it("aunque el último envío se haya anulado sin llegar a leerse", async () => {
    await envio(ANA, 4, lectura("11111111A", [["B", "2029-01-01"]]));
    await envio(ANA, 0, null, "anulada");
    expect((await mod.lecturaVigente(conexion, ANA))?.deEnvioAnterior).toBe(true);
  });

  it("de varias leídas, la más reciente", async () => {
    await envio(ANA, 9, lectura("11111111A", []));
    await envio(ANA, 6, lectura("22222222B", []));
    await envio(ANA, 3);
    expect((await mod.lecturaVigente(conexion, ANA))?.lectura.identidad.numero).toBe("22222222B");
  });

  it("la de cada uno es la suya", async () => {
    await envio(ANA, 2, lectura("11111111A", []));
    await envio(PEP, 1, lectura("22222222B", []));
    expect((await mod.lecturaVigente(conexion, ANA))?.lectura.identidad.numero).toBe("11111111A");
    expect((await mod.lecturaVigente(conexion, PEP))?.lectura.identidad.numero).toBe("22222222B");
  });
});

describe.runIf(RUN)("leer sola al recibir la ficha", () => {
  beforeEach(async () => {
    await conexion.query(`DELETE FROM sea_employee_invites`);
  });
  const LEIDA = lectura("39882775Q", [["B", "2033-06-25"]]);

  it("lee y lo apunta en el envío que ha llegado", async () => {
    const id = await envio(ANA, 0);
    let pedido = "";
    const r = await mod.leerAlRecibir(conexion, { employeeId: ANA, invitacionId: id }, {
      hayIA: () => true,
      leer: async (e) => { pedido = e; return LEIDA; },
    });
    expect(r).toBe("leida");
    expect(pedido).toBe(ANA);
    const fila = await guardada(id);
    expect(fila.lectura.carnet.clases).toEqual([{ clase: "B", caducidad: "2033-06-25" }]);
    expect(fila.leido_at).not.toBeNull();
    expect((await mod.lecturaVigente(conexion, ANA))?.deEnvioAnterior).toBe(false);
  });

  it("en ESE envío, aunque mientras leía se haya mandado otro enlace", async () => {
    const recibido = await envio(ANA, 1);
    const r = await mod.leerAlRecibir(conexion, { employeeId: ANA, invitacionId: recibido }, {
      hayIA: () => true,
      leer: async () => {
        await envio(ANA, 0, null, "enviado"); // llega otro enlace a media lectura
        return LEIDA;
      },
    });
    expect(r).toBe("leida");
    expect((await guardada(recibido)).lectura).not.toBeNull();
    const { rows } = await conexion.query(`SELECT count(*)::int AS n FROM sea_employee_invites WHERE lectura IS NOT NULL`);
    expect(rows[0].n).toBe(1);
  });

  it("sin IA configurada no hace nada, y no pasa nada", async () => {
    const id = await envio(ANA, 0);
    let llamada = false;
    const r = await mod.leerAlRecibir(conexion, { employeeId: ANA, invitacionId: id }, {
      hayIA: () => false,
      leer: async () => { llamada = true; return LEIDA; },
    });
    expect(r).toBe("sin_ia");
    expect(llamada).toBe(false);
    expect((await guardada(id)).lectura).toBeNull();
  });

  it("si la IA falla no revienta: queda sin leer, para el botón de siempre", async () => {
    const id = await envio(ANA, 0);
    const r = await mod.leerAlRecibir(conexion, { employeeId: ANA, invitacionId: id }, {
      hayIA: () => true,
      leer: async () => { throw new Error("el modelo no contesta"); },
    });
    expect(r).toBe("fallo");
    expect((await guardada(id)).lectura).toBeNull();
  });

  it("ni aunque falle la base al apuntarlo", async () => {
    const roto = { query: async () => { throw new Error("sin conexión"); } };
    const r = await mod.leerAlRecibir(roto, { employeeId: ANA, invitacionId: "x" }, { hayIA: () => true, leer: async () => LEIDA });
    expect(r).toBe("fallo");
  });
});
