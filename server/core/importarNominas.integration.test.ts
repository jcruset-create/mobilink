/**
 * Importar de las nóminas, de punta a punta: un PDF de verdad (generado aquí,
 * con gente inventada), leído por el lector de PDF del servidor, comparado con
 * un Core de pruebas en Postgres y aplicado. Esquema propio.
 */

import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import PDFDocument from "pdfkit";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_importar_nominas_${process.pid}`;

const EMPRESA = "0a0a0a0a-0000-4000-a000-000000000001";
const OTRA = "0b0b0b0b-0000-4000-a000-000000000002";
const CENTRO = "0c0c0c0c-0000-4000-a000-000000000001";
const ANA = "1a1a1a1a-0000-4000-a000-000000000001";
const PEP = "1b1b1b1b-0000-4000-a000-000000000002";
const ZOE = "1c1c1c1c-0000-4000-a000-000000000003";

type Nomina = { trabajador: string; nif: string; codigo: string; centro?: string; empresa?: string; cif?: string; periodo?: string };

/** Un PDF con una nómina por página, con la cabecera del formato de la gestoría. */
function pdfDeNominas(nominas: Nomina[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", autoFirstPage: false });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(trozos))));
  for (const n of nominas) {
    doc.addPage();
    doc.fontSize(9);
    const linea = (y: number, izquierda: string, derecha = "") => {
      doc.text(izquierda, 36, y, { lineBreak: false });
      if (derecha) doc.text(derecha, 288, y, { lineBreak: false });
    };
    linea(85, `Empresa ${n.empresa ?? "TALLERES EJEMPLO, SA"}`, `Trabajador ${n.trabajador}`);
    linea(97, `Centro ${n.centro ?? "553 TARRAGONA"}`, "Grupo Prof. G4 PROFESIONAL OFICIO 1ª");
    linea(110, "Domicilio CL MAYOR 1", "Puesto Trab.");
    linea(121, "Población 43000 TARRAGONA", "Antigüedad 16/11/2026");
    linea(133, "C.C.C. 43/0000000/00", "N.A.S.S. 43/00000009/09");
    linea(145, `C.I.F. ${n.cif ?? "A00000000"}`, `Código ${n.codigo} / 100   N.I.F. ${n.nif}`);
    linea(182, `Periodo de liquidación ${n.periodo ?? "Del 01 al 30 de Noviembre de 2.026"}`, "                              Total días 30");
    linea(218, "Concepto Unidades Valor Base Devengado A Deducir");
    linea(246, "SALARIO BASE 13,00 42,5537 9.999,99");
  }
  doc.end();
  return listo;
}

let conexion: PoolClient;
let mod: typeof import("./importarNominas.ts");
let PDF: Buffer;

const empleado = async (nif: string) =>
  (await conexion.query(`SELECT * FROM sea_employees WHERE dni_nie = $1`, [nif])).rows[0];

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./importarNominas.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_companies (id uuid PRIMARY KEY, nombre text NOT NULL, cif text, activa boolean NOT NULL DEFAULT true);
    CREATE TABLE sea_work_centers (id uuid PRIMARY KEY, company_id uuid NOT NULL, nombre text NOT NULL, activo boolean NOT NULL DEFAULT true);
    CREATE TABLE sea_employees (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, work_center_id uuid,
      nombre text NOT NULL, apellidos text, dni_nie text, num_seguridad_social text, fecha_alta date, cargo text,
      rol text NOT NULL DEFAULT 'operario', codigo_operario text UNIQUE, activo boolean NOT NULL DEFAULT true,
      estado_alta text NOT NULL DEFAULT 'completa', numero_trabajador text, updated_at timestamptz
    );
    CREATE UNIQUE INDEX sea_employees_empresa_numero_trabajador_uq
      ON sea_employees (company_id, numero_trabajador) WHERE numero_trabajador IS NOT NULL;

    INSERT INTO sea_companies VALUES ('${EMPRESA}', 'TALLERES EJEMPLO S.A.', 'A-00000000', true), ('${OTRA}', 'Otra SL', NULL, true);
    INSERT INTO sea_work_centers VALUES ('${CENTRO}', '${EMPRESA}', 'Tarragona', true);
    -- Ana y Pep tienen los números CRUZADOS respecto a la nómina (1↔2): el caso
    -- que un UPDATE fila a fila no puede resolver sin chocar con el índice.
    INSERT INTO sea_employees (id, company_id, nombre, apellidos, dni_nie, codigo_operario, numero_trabajador, cargo) VALUES
      ('${ANA}', '${EMPRESA}', 'Ana', 'Garcia Lopez', '12345678Z', '1', '1', 'Jefa de taller'),
      ('${PEP}', '${EMPRESA}', 'Pep', 'Ruiz', '00000001R', '2', '2', NULL),
      ('${ZOE}', '${EMPRESA}', 'Zoe', 'Sin Nómina', '00000002W', '9', '9', NULL);
  `);
  PDF = await pdfDeNominas([
    { trabajador: "GARCIA LOPEZ, ANA", nif: "12345678Z", codigo: "000002" },
    { trabajador: "RUIZ, PEP", nif: "00000001R", codigo: "000001" },
    { trabajador: "SOLER, NIL", nif: "00000003A", codigo: "000003", periodo: "Del 16 al 30 de Noviembre de 2.026" },
  ]);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("importar de las nóminas", () => {
  it("analizar reconoce la empresa por el CIF y dice qué pasaría, sin escribir", async () => {
    const a = await mod.analizarNominas(PDF, null, conexion);
    expect(a.empresa).toEqual({ id: EMPRESA, nombre: "TALLERES EJEMPLO S.A." });
    expect(a.paginasNoReconocidas).toEqual([]);
    expect(a.filas.map((f) => [f.nombre, f.tipo])).toEqual([["Ana", "actualizar"], ["Pep", "actualizar"], ["Nil", "nuevo"]]);
    // A Ana se le iguala el número y se le rellena lo que le falta; el cargo
    // que ya tiene puesto no entra en los cambios.
    expect(a.filas[0].cambios[0]).toEqual({ campo: "numero_trabajador", etiqueta: "Nº de trabajador", actual: "1", nuevo: "2" });
    expect(a.filas[0].cambios.map((c) => c.campo)).toEqual(["numero_trabajador", "num_seguridad_social", "fecha_alta"]);
    expect(a.noEnNomina).toEqual([{ id: ZOE, nombre: "Zoe Sin Nómina", numeroTrabajador: "9" }]);

    expect((await conexion.query(`SELECT count(*)::int AS n FROM sea_employees`)).rows[0].n).toBe(3);
    expect((await empleado("12345678Z")).numero_trabajador).toBe("1");
  });

  it("del PDF solo sale la cabecera: ni un importe en la respuesta", async () => {
    expect(JSON.stringify(await mod.analizarNominas(PDF, null, conexion))).not.toMatch(/9\.999,99|42,5537|SALARIO/);
  });

  it("no hacer nada si no se marca a nadie", async () => {
    await expect(mod.aplicarNominas(PDF, EMPRESA, { crear: [], actualizar: [] }, conexion)).rejects.toMatchObject({ status: 400 });
  });

  it("aplica: cruza los números de Ana y Pep y crea a Nil pendiente del enlace", async () => {
    const r = await mod.aplicarNominas(PDF, EMPRESA, { crear: ["00000003A"], actualizar: ["12345678Z", "00000001R"] }, conexion);
    expect(r.actualizados.map((a) => a.id).sort()).toEqual([ANA, PEP].sort());
    expect(r.creados).toHaveLength(1);
    expect(r.creados[0]).toMatchObject({ nombre: "Nil Soler", numeroTrabajador: "3" });

    expect((await empleado("12345678Z")).numero_trabajador).toBe("2");
    expect((await empleado("00000001R")).numero_trabajador).toBe("1");
    // Lo que ya estaba puesto en Core no se pisa, y el login de ToolControl tampoco.
    expect(await empleado("12345678Z")).toMatchObject({ cargo: "Jefa de taller", codigo_operario: "1" });
    // A Pep le faltaba el cargo: se rellena con el de la nómina.
    expect((await empleado("00000001R")).cargo).toBe("G4 Profesional Oficio 1ª");

    expect(await empleado("00000003A")).toMatchObject({
      nombre: "Nil",
      apellidos: "Soler",
      company_id: EMPRESA,
      work_center_id: CENTRO,
      num_seguridad_social: "43/00000009/09",
      cargo: "G4 Profesional Oficio 1ª",
      estado_alta: "pendiente",
      numero_trabajador: "3",
      activo: true,
      rol: "operario",
      codigo_operario: null,
    });
    expect((await conexion.query(`SELECT to_char(fecha_alta,'YYYY-MM-DD') AS f FROM sea_employees WHERE dni_nie = '00000003A'`)).rows[0].f).toBe("2026-11-16");
  });

  it("volver a importar el mismo PDF no duplica a nadie", async () => {
    const a = await mod.analizarNominas(PDF, null, conexion);
    expect(a.filas.map((f) => f.tipo)).toEqual(["igual", "igual", "igual"]);
    const r = await mod.aplicarNominas(PDF, EMPRESA, { crear: ["00000003A"], actualizar: ["12345678Z"] }, conexion);
    expect(r).toEqual({ creados: [], actualizados: [] });
    expect((await conexion.query(`SELECT count(*)::int AS n FROM sea_employees`)).rows[0].n).toBe(4);
  });

  it("solo se crea a quien se ha marcado", async () => {
    const pdf = await pdfDeNominas([
      { trabajador: "PUIG, MAR", nif: "00000004G", codigo: "000004" },
      { trabajador: "VIDAL, POL", nif: "00000005M", codigo: "000005" },
    ]);
    const r = await mod.aplicarNominas(pdf, EMPRESA, { crear: ["00000004G"], actualizar: [] }, conexion);
    expect(r.creados.map((c) => c.nombre)).toEqual(["Mar Puig"]);
    expect(await empleado("00000005M")).toBeUndefined();
  });

  it("si el número de un nuevo lo tiene otra persona, 409 y no se guarda nada", async () => {
    // Zoe tiene el 9 y no sale en esta nómina; el nuevo también es el 9.
    const pdf = await pdfDeNominas([
      { trabajador: "VIDAL, POL", nif: "00000005M", codigo: "000005" },
      { trabajador: "MAS, LIA", nif: "00000006Y", codigo: "000009" },
    ]);
    await expect(
      mod.aplicarNominas(pdf, EMPRESA, { crear: ["00000005M", "00000006Y"], actualizar: [] }, conexion)
    ).rejects.toMatchObject({ status: 409, code: "NUMERO_REPETIDO" });
    // Ni el que chocaba ni el que iba bien: todo o nada.
    expect(await empleado("00000005M")).toBeUndefined();
    expect(await empleado("00000006Y")).toBeUndefined();
  });

  it("un PDF que no es de nóminas, o con dos empresas, se rechaza con su motivo", async () => {
    const otraCosa = await pdfDeNominas([]).then(async () => {
      const doc = new PDFDocument();
      const t: Buffer[] = [];
      doc.on("data", (c: Buffer) => t.push(c));
      const fin = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(t))));
      doc.text("Albarán de entrega 123. Nada que ver con una nómina, pero con texto de sobra para leerlo.");
      doc.end();
      return fin;
    });
    await expect(mod.analizarNominas(otraCosa, null, conexion)).rejects.toMatchObject({ status: 400, code: "SIN_NOMINAS" });
    await expect(mod.analizarNominas(Buffer.from("esto no es un pdf"), null, conexion)).rejects.toMatchObject({ status: 400 });

    const mezcla = await pdfDeNominas([
      { trabajador: "PUIG, MAR", nif: "00000004G", codigo: "000004" },
      { trabajador: "FONT, JAN", nif: "00000007F", codigo: "000007", empresa: "OTRA, SL", cif: "B11111111" },
    ]);
    await expect(mod.analizarNominas(mezcla, null, conexion)).rejects.toMatchObject({ status: 400, code: "VARIAS_EMPRESAS" });
  });

  it("si la empresa del PDF no está en Core, no adivina: devuelve la lista para elegir", async () => {
    const pdf = await pdfDeNominas([{ trabajador: "FONT, JAN", nif: "00000007F", codigo: "000007", empresa: "DESCONOCIDA, SL", cif: "B99999999" }]);
    const a = await mod.analizarNominas(pdf, null, conexion);
    expect(a.empresa).toBeNull();
    expect(a.filas).toEqual([]);
    expect(a.empresas.map((e) => e.id).sort()).toEqual([EMPRESA, OTRA].sort());
    // Elegida a mano, ya compara.
    const b = await mod.analizarNominas(pdf, OTRA, conexion);
    expect(b.empresa?.id).toBe(OTRA);
    expect(b.filas[0].tipo).toBe("nuevo");
  });
});

describe.runIf(RUN)("rutas /api/core/empleados/importar-nominas", () => {
  function servidor(esAdmin: boolean) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = { userId: "u1", empresaId: "0e0e0e0e-0000-4000-a000-000000000001", esAdmin, esSuperadmin: false };
      next();
    };
    const app = express();
    app.use("/api/core/empleados", mod.createImportarNominasRouter({ autenticar, ejecutor: conexion as any }));
    return new Promise<{ url: string; cerrar: () => void }>((ok) => {
      const s = app.listen(0, () =>
        ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => s.close() })
      );
    });
  }
  const mandar = (url: string, ruta: string, campos: Record<string, string>, conPdf = true) => {
    const cuerpo = new FormData();
    if (conPdf) cuerpo.append("pdf", new Blob([new Uint8Array(PDF)], { type: "application/pdf" }), "nominas.pdf");
    for (const [k, v] of Object.entries(campos)) cuerpo.append(k, v);
    return fetch(`${url}/api/core/empleados/importar-nominas/${ruta}`, { method: "POST", body: cuerpo });
  };

  it("quien no es administrador no puede ni analizar ni aplicar", async () => {
    const { url, cerrar } = await servidor(false);
    try {
      expect((await mandar(url, "analizar", {})).status).toBe(403);
      expect((await mandar(url, "aplicar", { companyId: EMPRESA, crear: "[]", actualizar: "[]" })).status).toBe(403);
    } finally {
      cerrar();
    }
  });

  it("el administrador analiza; sin PDF o sin empresa, 400", async () => {
    const { url, cerrar } = await servidor(true);
    try {
      const r = await mandar(url, "analizar", {});
      expect(r.status).toBe(200);
      const d = await r.json();
      expect(d.empresa.id).toBe(EMPRESA);
      expect(d.filas).toHaveLength(3);

      expect((await mandar(url, "analizar", {}, false)).status).toBe(400);
      expect((await mandar(url, "aplicar", { crear: "[]", actualizar: "[]" })).status).toBe(400);
      expect((await mandar(url, "aplicar", { companyId: EMPRESA, crear: "[]", actualizar: "no es json" })).status).toBe(400);
    } finally {
      cerrar();
    }
  });
});
