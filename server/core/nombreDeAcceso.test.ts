import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { nombreValeParaEntrar, nombresDeCore } from "./nombreDeAcceso.ts";

describe("nombresDeCore", () => {
  it("completo, campo nombre y primera palabra", () => {
    expect(nombresDeCore({ nombre: "Jorge Andrés", apellidos: "Pérez Gil" })).toEqual([
      "jorge andres perez gil",
      "jorge andres",
      "jorge",
    ]);
  });

  it("con el nombre entero en `nombre` y sin apellidos, no repite", () => {
    expect(nombresDeCore({ nombre: "Albert Belles Bertran", apellidos: null })).toEqual([
      "albert belles bertran",
      "albert",
    ]);
  });

  it("sin nombre no hay con qué entrar", () => {
    expect(nombresDeCore({ nombre: null, apellidos: null })).toEqual([]);
  });
});

describe("nombreValeParaEntrar", () => {
  const core = { nombre: "Ramón", apellidos: "Muñoz Díaz" };

  it("sin enlazar: solo el nombre del módulo, sin mirar mayúsculas ni tildes", () => {
    expect(nombreValeParaEntrar(" ramon ", { nombreModulo: "Ramón" })).toBe(true);
    expect(nombreValeParaEntrar("Ramon Munoz Diaz", { nombreModulo: "Ramón" })).toBe(false);
  });

  it("enlazado: vale el de Core, completo o de pila", () => {
    expect(nombreValeParaEntrar("RAMON MUÑOZ DIAZ", { nombreModulo: "moncho", core })).toBe(true);
    expect(nombreValeParaEntrar("ramon", { nombreModulo: "moncho", core })).toBe(true);
  });

  it("enlazado: el nombre antiguo del módulo sigue valiendo, para no dejar fuera a nadie", () => {
    expect(nombreValeParaEntrar("Moncho", { nombreModulo: "moncho", core })).toBe(true);
  });

  it("un nombre que no es ni el de Core ni el del módulo no entra", () => {
    expect(nombreValeParaEntrar("Pedro", { nombreModulo: "moncho", core })).toBe(false);
    expect(nombreValeParaEntrar("Muñoz", { nombreModulo: "moncho", core })).toBe(false);
  });

  it("en blanco nunca vale, ni contra una ficha sin nombre", () => {
    expect(nombreValeParaEntrar("", { nombreModulo: "", core: { nombre: null, apellidos: null } })).toBe(false);
    expect(nombreValeParaEntrar("  ", { nombreModulo: null })).toBe(false);
  });
});

/** El login de la APK de Almacén usa de verdad lo de arriba, y respeta la baja. */
describe("login de la APK de Almacén", () => {
  const SERVIDOR = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const i = SERVIDOR.indexOf('app.post("/api/almacen/login-operario"');
  const login = SERVIDOR.slice(i, i + 3200);

  it("compara el nombre mirando a Core y no deja entrar a quien está de baja en Core", () => {
    expect(login).toContain("personaDeCoreDeAlmacen(String(perfil.id))");
    expect(login).toContain("core?.activo === false");
    expect(login).toContain("nombreValeParaEntrar(nombre, { nombreModulo: perfil.nombre, core })");
  });

  it("el usuario sintético sale del nombre de la ficha, no del tecleado", () => {
    // Si saliera del tecleado, entrar con el nombre de Core crearía OTRO
    // usuario de Supabase para la misma persona.
    expect(login).toContain("const slug = String(perfil.nombre ?? nombre)");
  });
});
