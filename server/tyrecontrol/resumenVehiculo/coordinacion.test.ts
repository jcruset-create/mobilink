/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Coordinación entre instancias: que dos procesos no paguen dos veces lo
 * mismo, y que la muerte de uno no deje la ficha bloqueada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Consulta { sql: string; args: any[] }
let consultas: Consulta[] = [];
let filasAfectadas = 1;
let fallar = false;

const ejecutar = async (sql: string, args: any[] = []) => {
  consultas.push({ sql, args });
  if (fallar) throw new Error("base caída");
  return { rows: [], rowCount: filasAfectadas };
};
vi.mock("../../db.ts", () => ({ default: { query: ejecutar } }));

const { esperarResultado, INSTANCIA, soltar, tomar } = await import("./coordinacion.ts");

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const VEHICULO = "33333333-3333-4333-8333-333333333333";

beforeEach(() => { consultas = []; filasAfectadas = 1; fallar = false; });

describe("tomar", () => {
  it("si la fila entra, el arrendamiento es mío", async () => {
    expect(await tomar("clave-1", EMPRESA, VEHICULO, 60_000)).toBe("mio");
    expect(consultas[0].args).toEqual(["clave-1", EMPRESA, VEHICULO, INSTANCIA, "60000"]);
  });

  it("si ya lo tiene otro y sigue vivo, es ajeno", async () => {
    filasAfectadas = 0;
    expect(await tomar("clave-1", EMPRESA, VEHICULO, 60_000)).toBe("ajeno");
  });

  it("solo se le quita a quien lo tenía si su arrendamiento ha CADUCADO", async () => {
    await tomar("clave-1", EMPRESA, VEHICULO, 60_000);
    const sql = consultas[0].sql.replace(/\s+/g, " ");
    expect(sql).toContain("on conflict (clave) do update");
    expect(sql).toContain("where ia_resumen_en_curso.caduca_at < now()");
  });

  it("no abre transacción: una sola sentencia y ningún begin", async () => {
    await tomar("clave-1", EMPRESA, VEHICULO, 60_000);
    expect(consultas).toHaveLength(1);
    expect(consultas.map((c) => c.sql.trim().toLowerCase())).not.toContain("begin");
  });

  it("si la base no contesta se dice, no se finge que hay coordinación", async () => {
    fallar = true;
    expect(await tomar("clave-1", EMPRESA, VEHICULO, 60_000)).toBe("sin_coordinacion");
  });
});

describe("soltar", () => {
  it("solo borra el arrendamiento propio", async () => {
    await soltar("clave-1");
    expect(consultas[0].sql).toContain("delete from ia_resumen_en_curso");
    expect(consultas[0].args).toEqual(["clave-1", INSTANCIA]);
  });

  it("y de paso barre los que dejó colgando una instancia muerta", async () => {
    await soltar("clave-1");
    expect(consultas[0].sql.replace(/\s+/g, " ")).toContain("or caduca_at < now()");
  });

  it("si falla al soltar, no lanza: la respuesta ya se ha dado", async () => {
    fallar = true;
    await expect(soltar("clave-1")).resolves.toBeUndefined();
  });
});

describe("esperarResultado", () => {
  it("devuelve lo que aparezca en la caché mientras espera", async () => {
    let vueltas = 0;
    const r = await esperarResultado(async () => (++vueltas >= 2 ? "listo" : null), 1000, 10);
    expect(r).toBe("listo");
    expect(vueltas).toBe(2);
  });

  it("si no aparece a tiempo, devuelve null en vez de esperar para siempre", async () => {
    const r = await esperarResultado(async () => null, 60, 20);
    expect(r).toBeNull();
  });

  it("un error al mirar la caché no rompe la espera", async () => {
    let vueltas = 0;
    const r = await esperarResultado(async () => {
      if (++vueltas === 1) throw new Error("hipo");
      return "listo";
    }, 1000, 10);
    expect(r).toBe("listo");
  });
});
