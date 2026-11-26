/**
 * Las nóminas en la ficha, de punta a punta: un PDF generado aquí (gente
 * inventada), partido por páginas, guardado en un almacén de mentira y
 * apuntado en Postgres con la migración tal cual se pega en Supabase.
 */

import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import PDFDocument from "pdfkit";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_nominas_empleado_${process.pid}`;
const MIGRACION = readFileSync(
  new URL("../../supabase/migrations/core_nominas_empleado.sql", import.meta.url),
  "utf8"
);

const EMPRESA = "0a0a0a0a-0000-4000-a000-000000000001";
const ANA = "1a1a1a1a-0000-4000-a000-000000000001";
const PEP = "1b1b1b1b-0000-4000-a000-000000000002";
const SIN_DNI = "1c1c1c1c-0000-4000-a000-000000000003";
const QUIEN = { userId: "2a2a2a2a-0000-4000-a000-000000000001", nombre: "Jordi" };

type Nomina = { trabajador: string; nif: string; codigo: string; periodo?: string; importe?: string };

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
    linea(85, "Empresa TALLERES EJEMPLO, SA", `Trabajador ${n.trabajador}`);
    linea(97, "Centro 553 TARRAGONA", "Grupo Prof. G4 PROFESIONAL OFICIO 1ª");
    linea(121, "Población 43000 TARRAGONA", "Antigüedad 16/11/2020");
    linea(133, "C.C.C. 43/0000000/00", "N.A.S.S. 43/00000009/09");
    linea(145, "C.I.F. A00000000", `Código ${n.codigo} / 100   N.I.F. ${n.nif}`);
    linea(182, `Periodo de liquidación ${n.periodo ?? "Del 01 al 30 de Noviembre de 2.026"}`, "                              Total días 30");
    linea(218, "Concepto Unidades Valor Base Devengado A Deducir");
    linea(246, `SALARIO BASE 13,00 42,5537 ${n.importe ?? "1.111,11"}`);
  }
  doc.end();
  return listo;
}

let conexion: PoolClient;
let importar: typeof import("./importarNominas.ts");
let mod: typeof import("./nominasEmpleado.ts");
let leerDocumento: typeof import("../therefore/documentos/texto.ts").leerDocumento;

const guardado = new Map<string, Buffer>();
const almacen = {
  async subir(ruta: string, pdf: Buffer) { guardado.set(ruta, pdf); },
  async bajar(ruta: string) { return guardado.get(ruta) ?? null; },
  async borrar(ruta: string) { guardado.delete(ruta); },
};
const deps = () => ({ consultor: conexion, almacen });
const filas = async (id: string) =>
  (await conexion.query(`SELECT * FROM sea_employee_payslips WHERE employee_id = $1 ORDER BY periodo`, [id])).rows;
/** El texto de un PDF guardado, para ver de quién es. */
const textoDe = (pdf: Buffer) => leerDocumento(pdf).paginas.map((p) => p.lineas.map((l) => l.texto).join("\n")).join("\n");

let PDF: Buffer;

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  importar = await import("./importarNominas.ts");
  mod = await import("./nominasEmpleado.ts");
  leerDocumento = (await import("../therefore/documentos/texto.ts")).leerDocumento;
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_companies (id uuid PRIMARY KEY, nombre text NOT NULL, cif text, activa boolean NOT NULL DEFAULT true);
    CREATE TABLE sea_work_centers (id uuid PRIMARY KEY, company_id uuid NOT NULL, nombre text NOT NULL, activo boolean NOT NULL DEFAULT true);
    CREATE TABLE sea_employees (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, work_center_id uuid,
      nombre text NOT NULL, apellidos text, dni_nie text, num_seguridad_social text, fecha_alta date, cargo text,
      rol text NOT NULL DEFAULT 'operario', activo boolean NOT NULL DEFAULT true,
      estado_alta text NOT NULL DEFAULT 'completa', numero_trabajador text, updated_at timestamptz
    );
    INSERT INTO sea_companies VALUES ('${EMPRESA}', 'TALLERES EJEMPLO S.A.', 'A00000000', true);
    INSERT INTO sea_employees (id, company_id, nombre, apellidos, dni_nie, num_seguridad_social, fecha_alta, cargo, numero_trabajador) VALUES
      ('${ANA}', '${EMPRESA}', 'Ana', 'García Peña', '12345678Z', '43/00000009/09', '2020-11-16', 'x', '2'),
      ('${PEP}', '${EMPRESA}', 'Pep', 'Ruiz', '00000001R', '43/00000009/09', '2020-11-16', 'x', '1'),
      -- En Core no tiene DNI: el importador la reconoce solo por el nombre.
      ('${SIN_DNI}', '${EMPRESA}', 'Zoe Mas', NULL, NULL, '43/00000009/09', '2020-11-16', 'x', '9');
  `);
  PDF = await pdfDeNominas([
    { trabajador: "GARCIA PEÑA, ANA", nif: "12345678Z", codigo: "000002", importe: "1.111,11" },
    { trabajador: "RUIZ, PEP", nif: "00000001R", codigo: "000001", periodo: "Del 01 al 20 de Noviembre de 2.026", importe: "2.222,22" },
    { trabajador: "RUIZ, PEP", nif: "00000001R", codigo: "000001", periodo: "Del 21 al 25 de Noviembre de 2.026", importe: "3.333,33" },
    { trabajador: "MAS, ZOE", nif: "00000002W", codigo: "000009", importe: "4.444,44" },
    { trabajador: "SOLER, NIL", nif: "00000003A", codigo: "000003", importe: "5.555,55" },
  ]);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

const soloGuardar = () =>
  importar.aplicarNominas(PDF, EMPRESA, { crear: [], actualizar: [] }, conexion, { guardarNominas: true, quien: QUIEN, almacen });

describe.runIf(RUN)("nóminas en la ficha", () => {
  it("sin la migración no se ofrece guardarlas, y pedirlo lo dice en vez de fallar", async () => {
    expect((await importar.analizarNominas(PDF, null, conexion)).nominasDisponible).toBe(false);
    const r = await soloGuardar();
    expect(r.nominas).toMatchObject({ guardadas: 0, error: expect.stringMatching(/core_nominas_empleado\.sql/) });
    expect(guardado.size).toBe(0);
  });

  it("la migración entra, se puede repetir y deja la tabla cerrada al navegador", async () => {
    await conexion.query(MIGRACION);
    await conexion.query(MIGRACION);
    expect((await importar.analizarNominas(PDF, null, conexion)).nominasDisponible).toBe(true);
    const { rows } = await conexion.query(
      `SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = $1 AND p.tablename = 'sea_employee_payslips') AS politicas
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = 'sea_employee_payslips'`,
      [ESQUEMA]
    );
    // Activada y sin ninguna política: con una clave de navegador no se lee nada.
    expect(rows[0]).toEqual({ rls: true, politicas: 0 });
  });

  it("guarda a cada uno SOLO su página, sin marcar a nadie para crear ni actualizar", async () => {
    const r = await soloGuardar();
    expect(r).toMatchObject({ creados: [], actualizados: [] });
    expect(r.nominas).toMatchObject({ guardadas: 3, fichas: 2 });

    const deAna = await filas(ANA);
    expect(deAna).toHaveLength(1);
    expect(deAna[0]).toMatchObject({ anio: 2026, mes: 11, periodo: "Del 01 al 30 de Noviembre de 2.026", dias: 30, subida_nombre: "Jordi" });
    expect(deAna[0].storage_path).toMatch(new RegExp(`^empleados/${ANA}/nominas/2026-11-[0-9a-f-]+\\.pdf$`));

    const texto = textoDe(guardado.get(deAna[0].storage_path)!);
    expect(texto).toContain("GARCIA PEÑA, ANA");
    expect(texto).toContain("1.111,11");
    // Ni el nombre ni el sueldo de nadie más.
    expect(texto).not.toMatch(/RUIZ|MAS, ZOE|SOLER|2\.222,22|4\.444,44|5\.555,55/);
  });

  it("quien tiene dos nóminas en el mes las tiene las dos, cada una la suya", async () => {
    const dePep = await filas(PEP);
    expect(dePep.map((f) => f.periodo)).toEqual(["Del 01 al 20 de Noviembre de 2.026", "Del 21 al 25 de Noviembre de 2.026"]);
    expect(textoDe(guardado.get(dePep[0].storage_path)!)).toContain("2.222,22");
    expect(textoDe(guardado.get(dePep[1].storage_path)!)).toContain("3.333,33");
    expect(textoDe(guardado.get(dePep[1].storage_path)!)).not.toContain("2.222,22");
  });

  it("no guarda la de quien no tiene ficha ni la de quien solo se reconoce por el nombre, y lo dice", async () => {
    const r = await soloGuardar();
    expect(r.nominas!.noGuardadas).toEqual([
      { nombre: "Zoe Mas", motivo: expect.stringMatching(/no tiene DNI/) },
      { nombre: "Nil Soler", motivo: "no tiene ficha en Core" },
    ]);
    expect(await filas(SIN_DNI)).toEqual([]);
  });

  it("en la base no queda ningún importe", async () => {
    const { rows } = await conexion.query(`SELECT * FROM sea_employee_payslips`);
    expect(JSON.stringify(rows)).not.toMatch(/1\.111,11|2\.222,22|3\.333,33/);
  });

  it("volver a subir el mismo mes sustituye: ni filas ni ficheros de más", async () => {
    const antes = (await filas(ANA))[0].storage_path;
    await conexion.query(`UPDATE sea_employee_payslips SET vista_at = now(), vista_nombre = 'Jordi'`);
    await soloGuardar();
    const despues = await filas(ANA);
    expect(despues).toHaveLength(1);
    expect(despues[0].storage_path).not.toBe(antes);
    // Es otro documento: lo de «vista» se borra.
    expect(despues[0]).toMatchObject({ vista_at: null, vista_nombre: null });
    expect(guardado.has(antes)).toBe(false);
    expect(guardado.size).toBe(3);
  });

  it("si en la misma importación se le pone el DNI, su nómina ya se guarda", async () => {
    const r = await importar.aplicarNominas(PDF, EMPRESA, { crear: ["00000003A"], actualizar: ["00000002W"] }, conexion, {
      guardarNominas: true,
      quien: QUIEN,
      almacen,
    });
    expect(r.creados.map((c) => c.nombre)).toEqual(["Nil Soler"]);
    expect(r.nominas).toMatchObject({ guardadas: 5, fichas: 4, noGuardadas: [] });
    expect(await filas(SIN_DNI)).toHaveLength(1);
  });

  it("partirPdf saca las páginas pedidas y solo esas", async () => {
    const trozo = await mod.partirPdf(PDF, [5]);
    const texto = textoDe(trozo);
    expect(leerDocumento(trozo).paginas).toHaveLength(1);
    expect(texto).toContain("SOLER, NIL");
    expect(texto).not.toContain("GARCIA");
  });
});

describe.runIf(RUN)("rutas de las nóminas de la ficha", () => {
  function servidor(quien: { esAdmin: boolean; esSuperadmin: boolean }) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = { userId: QUIEN.userId, nombre: "Lourdes", empresaId: "0e0e0e0e-0000-4000-a000-000000000001", ...quien };
      next();
    };
    const app = express();
    app.use("/api/core/empleados", mod.createNominasEmpleadoRouter({ autenticar, ...deps() }));
    return new Promise<{ url: string; cerrar: () => void }>((ok) => {
      const s = app.listen(0, () =>
        ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/core/empleados`, cerrar: () => s.close() })
      );
    });
  }

  it("un administrador que no es superadministrador no las lista, no las abre y no las borra", async () => {
    const id = (await filas(ANA))[0].id;
    const { url, cerrar } = await servidor({ esAdmin: true, esSuperadmin: false });
    try {
      expect((await fetch(`${url}/${ANA}/nominas`)).status).toBe(403);
      expect((await fetch(`${url}/${ANA}/nominas/${id}/pdf`)).status).toBe(403);
      expect((await fetch(`${url}/${ANA}/nominas/${id}`, { method: "DELETE" })).status).toBe(403);
      expect(await filas(ANA)).toHaveLength(1);
    } finally {
      cerrar();
    }
  });

  it("el superadministrador las lista, sin importes ni rutas", async () => {
    const { url, cerrar } = await servidor({ esAdmin: true, esSuperadmin: true });
    try {
      const d = await (await fetch(`${url}/${PEP}/nominas`)).json();
      expect(d.disponible).toBe(true);
      expect(d.nominas.map((n: any) => n.periodo)).toEqual([
        "Del 21 al 25 de Noviembre de 2.026",
        "Del 01 al 20 de Noviembre de 2.026",
      ]);
      expect(Object.keys(d.nominas[0]).sort()).toEqual(
        ["anio", "dias", "id", "mes", "periodo", "subidaAt", "subidaNombre", "vistaAt", "vistaNombre"].sort()
      );
      expect(JSON.stringify(d)).not.toMatch(/storage|empleados\/|2\.222/);
    } finally {
      cerrar();
    }
  });

  it("abrirla entrega el PDF de esa persona, sin caché, y apunta quién la ha visto", async () => {
    const fila = (await filas(ANA))[0];
    const { url, cerrar } = await servidor({ esAdmin: true, esSuperadmin: true });
    try {
      const r = await fetch(`${url}/${ANA}/nominas/${fila.id}/pdf`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("application/pdf");
      expect(r.headers.get("cache-control")).toBe("no-store");
      // El nombre del fichero va en una cabecera: sin la «ñ» de Peña.
      expect(r.headers.get("content-disposition")).toBe('inline; filename="Nomina_2026-11_Garcia_Pena_Ana.pdf"');
      expect(textoDe(Buffer.from(await r.arrayBuffer()))).toContain("GARCIA PEÑA, ANA");

      const vista = (await filas(ANA))[0];
      expect(vista.vista_nombre).toBe("Lourdes");
      expect(vista.vista_at).not.toBeNull();
    } finally {
      cerrar();
    }
  });

  it("el id de una nómina no abre ni borra la de otra persona", async () => {
    const deAna = (await filas(ANA))[0].id;
    const { url, cerrar } = await servidor({ esAdmin: true, esSuperadmin: true });
    try {
      expect((await fetch(`${url}/${PEP}/nominas/${deAna}/pdf`)).status).toBe(404);
      expect((await fetch(`${url}/${PEP}/nominas/${deAna}`, { method: "DELETE" })).status).toBe(404);
      expect((await fetch(`${url}/${ANA}/nominas/no-es-un-id/pdf`)).status).toBe(404);
      expect(await filas(ANA)).toHaveLength(1);
    } finally {
      cerrar();
    }
  });

  it("borrarla quita la fila y el fichero", async () => {
    const fila = (await filas(ANA))[0];
    const { url, cerrar } = await servidor({ esAdmin: true, esSuperadmin: true });
    try {
      expect((await fetch(`${url}/${ANA}/nominas/${fila.id}`, { method: "DELETE" })).status).toBe(200);
      expect(await filas(ANA)).toEqual([]);
      expect(guardado.has(fila.storage_path)).toBe(false);
      // Y abrir una que ya no está es un 404, no un error.
      expect((await fetch(`${url}/${ANA}/nominas/${fila.id}/pdf`)).status).toBe(404);
    } finally {
      cerrar();
    }
  });
});
