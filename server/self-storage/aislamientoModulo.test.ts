/**
 * Aislamiento de dominio, comprobado en el CÓDIGO (sin base de datos).
 *
 * Self Storage tiene sus propios clientes y su propia lógica. Puede apoyarse en
 * lo transversal de Mobilink —la sesión y los permisos de los empleados, la
 * empresa— y en nada más. Esta prueba recorre el módulo y falla si aparece:
 *
 *   · una tabla que no sea `self_storage_*` ni de la lista blanca;
 *   · un import de otro módulo de negocio del servidor;
 *   · una referencia a tablas de clientes de otros módulos.
 *
 * Igual que la de Recepciones con `movimientos_stock`: no es decorativa, es lo
 * que impide que «ya que estamos» se reutilice la ficha de cliente de otro
 * módulo.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname);
const MIGRACIONES = path.resolve(__dirname, "../../supabase/migrations/self_storage");
const PANEL = path.resolve(__dirname, "../../src/modules/self-storage");

/** Infraestructura transversal permitida: identidad interna y permisos. */
const TABLAS_PERMITIDAS = new Set([
  "app_usuario_modulos",
  "app_usuarios",
  "app_empresas",
  // Catálogo del sistema de PostgreSQL (migraciones idempotentes).
  "pg_roles",
  "pg_enum",
  "pg_type",
]);

/** Imports permitidos fuera del propio módulo. */
const IMPORTS_PERMITIDOS = [/^\.\.\/db\.ts$/, /^\.\.\/core\/auth\.ts$/, /\/src\/modules\/self-storage\/types\/enums\.ts$/];

function ficheros(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...ficheros(p, ext));
    else if (ext.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Tablas que aparecen después de FROM / JOIN / INTO / UPDATE / REFERENCES / TABLE / ON. */
function tablasReferenciadas(codigo: string): string[] {
  const sinComentarios = codigo.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /\b(?:FROM|JOIN|INTO|UPDATE|REFERENCES|TABLE|ON)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/g;
  const out = new Set<string>();
  for (const m of sinComentarios.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** Palabras que siguen a ON/FROM pero no son tablas (cláusulas SQL). */
const NO_TABLAS = new Set([
  "conflict", "delete", "update", "function", "schema", "public", "authenticated", "anon",
  // variable de PL/pgSQL (SELECT … INTO tipo_centro), no una tabla
  "tipo_centro",
]);

describe("aislamiento del módulo Self Storage (código)", () => {
  const codigoServidor = ficheros(RAIZ, /\.ts$/);
  const sql = ficheros(MIGRACIONES, /\.sql$/);

  it("sólo usa tablas self_storage_* y la identidad interna de la plataforma", () => {
    const ajenas: string[] = [];
    for (const f of [...codigoServidor, ...sql]) {
      const texto = fs.readFileSync(f, "utf8");
      for (const t of tablasReferenciadas(texto)) {
        if (t.startsWith("self_storage_") || TABLAS_PERMITIDAS.has(t) || NO_TABLAS.has(t)) continue;
        // Alias de una sola letra o palabra corta en minúsculas tras ON (p. ej. "ON c.id"): no son tablas.
        if (/^[a-z]{1,2}$/.test(t)) continue;
        ajenas.push(`${path.relative(RAIZ, f)} → ${t}`);
      }
    }
    expect(ajenas).toEqual([]);
  });

  it("no menciona tablas de clientes de otros módulos", () => {
    const prohibidas = /\b(customers|clientes|connect_provider_companies|connect_tenant_companies|tc_clientes|cobros_clientes|app_clientes)\b/;
    const culpables = [...codigoServidor, ...sql, ...ficheros(PANEL, /\.(ts|tsx)$/)]
      .map((f) => ({ f, texto: fs.readFileSync(f, "utf8").replace(/self_storage_customers/g, "") }))
      .filter(({ texto }) =>
        texto
          .split("\n")
          .filter((l) => !/^\s*(\*|\/\/|--|import\b)/.test(l)) // comentarios e imports
          .some((l) => /\b(FROM|JOIN|INTO|UPDATE|REFERENCES)\b/.test(l) && prohibidas.test(l))
      )
      .map(({ f }) => path.relative(RAIZ, f));
    expect(culpables).toEqual([]);
  });

  it("no importa código de otros módulos de negocio del servidor", () => {
    const malos: string[] = [];
    for (const f of codigoServidor) {
      const texto = fs.readFileSync(f, "utf8");
      for (const m of texto.matchAll(/from\s+["']([^"']+)["']/g)) {
        const ruta = m[1];
        if (!ruta.startsWith(".")) continue; // paquetes npm
        const absoluta = path.resolve(path.dirname(f), ruta);
        if (absoluta.startsWith(RAIZ + path.sep)) continue; // dentro del módulo
        const relativaAlModulo = path.relative(RAIZ, absoluta).split(path.sep).join("/");
        if (IMPORTS_PERMITIDOS.some((re) => re.test(relativaAlModulo) || re.test(absoluta.split(path.sep).join("/")))) continue;
        malos.push(`${path.relative(RAIZ, f)} → ${ruta}`);
      }
    }
    expect(malos).toEqual([]);
  });

  it("el panel del módulo no habla con APIs de otros módulos", () => {
    const malos = ficheros(PANEL, /\.(ts|tsx)$/).filter((f) => {
      const t = fs.readFileSync(f, "utf8");
      return /["'`]\/api\/(?!self-storage\/)/.test(t);
    });
    expect(malos.map((f) => path.relative(PANEL, f))).toEqual([]);
  });

  it("la prueba detecta una tabla ajena (se comprueba que no pasa siempre)", () => {
    expect(tablasReferenciadas("SELECT * FROM connect_assistances a JOIN self_storage_units u ON u.id = a.x")).toEqual(
      expect.arrayContaining(["connect_assistances", "self_storage_units"])
    );
  });
});
