import { describe, expect, it } from "vitest";

import { NAV, agruparNav, buscarEnMenu, grupoDeRuta, navVisible } from "./navigation";

const ver = (rol: "administrador" | "operador" | "cliente", superadmin = false) =>
  NAV.filter((i) => navVisible(i, rol, superadmin, null));

describe("menú agrupado del panel", () => {
  it("cada pantalla tiene su grupo", () => {
    for (const i of NAV) expect(i.grupo, i.key).toBeTruthy();
  });

  it("el administrador ve los 7 grupos en orden, con Ayuda y Perfil abajo", () => {
    const { grupos, pie } = agruparNav(ver("administrador"));
    expect(grupos.map((g) => g.label)).toEqual([
      "Inicio", "Flota", "Revisiones", "Neumáticos y taller", "Entrada de datos", "Catálogo", "Administración",
    ]);
    expect(pie.map((i) => i.path)).toEqual(["ayuda", "perfil"]);
    // El enlace con almacén es solo del superadmin.
    expect(grupos.flatMap((g) => g.items).some((i) => i.key === "enlace-almacen")).toBe(false);
  });

  it("el superadmin ve también el enlace con almacén, en Administración", () => {
    const { grupos } = agruparNav(ver("administrador", true));
    const admin = grupos.find((g) => g.key === "administracion")!;
    expect(admin.items.map((i) => i.key)).toContain("enlace-almacen");
  });

  it("el técnico ve solo las pantallas de su trabajo, y no salen grupos vacíos", () => {
    const { grupos } = agruparNav(ver("operador"));
    expect(grupos.map((g) => g.key)).toEqual(["inicio", "flota", "revisiones", "neumaticos", "entrada"]);
    const claves = grupos.flatMap((g) => g.items.map((i) => i.key)).sort();
    expect(claves).toEqual([
      "dashboard", "disponibles-revisar", "etiquetas", "historico-revisiones", "incidencias",
      "partes-papel", "planificacion", "revision-vehiculo", "sonda", "vehiculos-en-bases",
    ].sort());
  });

  it("el cliente tiene sus tres grupos con sus palabras", () => {
    const { grupos } = agruparNav(ver("cliente"));
    expect(grupos.map((g) => g.label)).toEqual(["Inicio", "Mi flota", "Mis neumáticos"]);
  });

  it("la pantalla abierta dice qué grupo abrir", () => {
    const items = ver("administrador");
    expect(grupoDeRuta(items, "/tyrecontrol/vehiculos-en-bases")).toBe("flota");
    expect(grupoDeRuta(items, "/tyrecontrol/etiquetas/abc/imprimir")).toBe("neumaticos");
    expect(grupoDeRuta(items, "/tyrecontrol/no-existe")).toBeNull();
  });

  it("el buscador encuentra sin acentos y por varias palabras, solo entre lo visible", () => {
    const admin = ver("administrador");
    expect(buscarEnMenu(admin, "bases").map((i) => i.key)).toEqual(["vehiculos-en-bases"]);
    expect(buscarEnMenu(admin, "planificacion").map((i) => i.key)).toEqual(["planificacion"]);
    expect(buscarEnMenu(admin, "revisiones hist").map((i) => i.key)).toEqual(["historico-revisiones"]);
    expect(buscarEnMenu(admin, "  ")).toEqual([]);
    // El técnico no encuentra lo que no ve.
    expect(buscarEnMenu(ver("operador"), "usuarios")).toEqual([]);
  });
});
