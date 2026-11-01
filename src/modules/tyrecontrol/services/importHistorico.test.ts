/**
 * Los casos acordados para la importación del histórico de albaranes, con
 * las líneas tal como vienen en el Excel de Genes (plana_2026_10_10.xlsx).
 */
import { describe, expect, it } from "vitest";
import {
  agruparAlbaranes, conciliarAlbaran, leerAnotacion, leerHoja1, leerHoja2, medidaDeTexto,
  papelDe, porPeriodo, referenciaDeDescripcion, resumir, type LineaH1, type LineaH2,
} from "./importHistorico";

const h1 = (o: Partial<LineaH1> & { codigo: string; descripcion: string }): LineaH1 => ({
  fecha: "2026-10-10", matricula: "7724KBM", km: 268659, documento: "B2_26 / 4905", familia: "46", categoria: "", marca: "",
  pct_iva: 21, uds: 1, pct_dto: 0, precio_unidad: 0, importe_linea: 0, estado_documento: "Pendiente", ...o,
});
const mo = (codigo: string, descripcion: string, uds: number, o: Partial<LineaH1> = {}) =>
  h1({ codigo, descripcion, uds, familia: "90", pct_dto: 99.99, precio_unidad: 18.54, importe_linea: 0.0037, ...o });
const h2 = (o: Partial<LineaH2> = {}): LineaH2 => ({
  articulo: "0107092270002", descripcion: "315/80X22.5 HANKOOK AH51 156L", marca: "HANKO", categoria: "D2T",
  fecha: "2026-10-10T07:09:12.000Z", vehiculo: "7724KBM", carcasa: "DC_0016005", cliente: "EMPRESA PLANA,S.L.", tipo: "NUEVA",
  almacen: "TARRAGONA", unidades: -2, usuario: "JORGE.02", doc_entrada: "", doc_salida: "B2_26/4905", obs: "", ...o,
});

/** B2_26/4905 · 7724 KBM, tal cual: 9 líneas de Hoja1 y 1 de Hoja2. */
const ALB_4905: LineaH1[] = [
  h1({ codigo: "M31580225N2", descripcion: "MONTA 2 CUBIERTAS NUEVAS 315/80R22.5 AH51" }),
  h1({ codigo: "M31580225U2", descripcion: "MONTA 2 CUBIERTAS USADAS 315/80X22.5" }),
  mo("9001099990017", 'MONTAJE CAMION MAYOR 19.5"', 2),
  mo("9001999990010", "MONTAJE FIJACIÓN(QUIT.PONER)CM", 4, { precio_unidad: 17.14, importe_linea: 0.0069 }),
  mo("9001099990004", "EQUILIBRADO CAMION", 2, { precio_unidad: 19.14, importe_linea: 0.0038 }),
  h1({ codigo: "P2815", descripcion: "CONTRAPESA ADHESIVA CAMION 150GR", uds: 2, precio_unidad: 3.45, importe_linea: 6.9 }),
  h1({ codigo: "P2820", descripcion: "CONTRAPESA ADHESIVA CAMION 200GR", uds: 2, precio_unidad: 4.25, importe_linea: 8.5 }),
  h1({ codigo: "RF", descripcion: "REVISION DE FLOTA", precio_unidad: 0.0001, importe_linea: 0.0001 }),
  h1({ codigo: "PLANA", descripcion: "NºVEHICULO:1495", precio_unidad: 0.01, importe_linea: 0.01 }),
];

async function conciliar(lineas: LineaH1[], salidas: LineaH2[] = []) {
  const { albaranes } = agruparAlbaranes(lineas, salidas);
  expect(albaranes).toHaveLength(1);
  return conciliarAlbaran(albaranes[0]);
}

describe("lectura", () => {
  it("entiende el código de la anotación: medida, condición y cantidad", () => {
    expect(leerAnotacion(h1({ codigo: "M29580225R4", descripcion: "MONTA0 4 CUBIERTAS RECAUCHUTADA 295/80X22.5 K25" })))
      .toMatchObject({ cond: "recauchutada", n: 4, medida: "295/80R22.5", modelo: "K25", variable: false });
    expect(leerAnotacion(h1({ codigo: "MVARIAN2", descripcion: "MONTA 2 CUBIERTAS NUEVAS:" }))).toMatchObject({ cond: "nueva", n: 2, variable: true, medida: null });
    expect(leerAnotacion(h1({ codigo: "9001099990017", descripcion: "MONTAJE" }))).toBeNull();
  });
  it("saca marca y modelo de la descripción del artículo", () => {
    expect(referenciaDeDescripcion("275/70X22.5 KUMHO CA31 152J148")).toEqual({ medida: "275/70R22.5", marca: "Kumho", modelo: "CA31 152J148" });
    expect(referenciaDeDescripcion("315/80X22.5 HANKOOK AH51 156L")).toEqual({ medida: "315/80R22.5", marca: "Hankook", modelo: "AH51 156L" });
    expect(medidaDeTexto("295/80R22,5")).toBe("295/80R22.5");
  });
  it("clasifica cada línea por su papel", () => {
    expect(papelDe(h1({ codigo: "RF", descripcion: "REVISION DE FLOTA" }))).toBe("revision_flota");
    expect(papelDe(h1({ codigo: "Z1500", descripcion: "KIT UNIFICADO TACOGRAFO***4300" }))).toBe("ignorada");
    expect(papelDe(h1({ codigo: "C2123", descripcion: "VALVULA CAMION TUBELESS", familia: "46" }))).toBe("servicio");
    expect(papelDe(h1({ codigo: "0302091080012", descripcion: "295/80X22.5 INSA K25 BASE 1ª", familia: "03" }))).toBe("carcasa_base");
    expect(papelDe(h1({ codigo: "P26150", descripcion: "CONTRAPESA PLOMO CAMION 150GR" }))).toBe("material");
  });
  it("lee las hojas por nombre de columna, con o sin acentos", () => {
    const l = leerHoja1([{ Fecha: new Date(2026, 9, 10), "Matrícula": "7724KBM", KMs: 268659, Documento: "B2_26 / 4905", "Código": "RF", Descripcion: "REVISION DE FLOTA", Familia: "46", "Uds.": 1, "% Dto": 0, "P. Unidad": 0.0001, "P. Total": 0.0001, "Estado Documento": "Pendiente" }]);
    expect(l[0]).toMatchObject({ fecha: "2026-10-10", documento: "B2_26 / 4905", codigo: "RF", uds: 1 });
    const s = leerHoja2([{ "Cod. Articulo": "0107092270002", "Descripción": "315/80X22.5 HANKOOK AH51 156L", Fecha: new Date(2026, 9, 10, 9, 9), "Vehículo": "7724kbm", "Matricula Carcasa": "DC_0016005", Unidades: -2, "Doc. Salida": "B2_26/4905" }]);
    expect(s[0]).toMatchObject({ articulo: "0107092270002", vehiculo: "7724kbm", unidades: -2 });
  });
});

describe("B2_26/4905 · 7724 KBM", () => {
  it("1 intervención, 4 operaciones (2 nuevas, 2 usadas), 3 servicios, 10 líneas", async () => {
    const c = await conciliar(ALB_4905, [h2()]);
    expect(c.estado).toBe("importable");
    expect(c.bloqueante).toBeNull();
    expect(c.operaciones).toHaveLength(4);
    expect(c.operaciones.filter((o) => o.condicion === "nueva")).toHaveLength(2);
    expect(c.operaciones.filter((o) => o.condicion === "usada")).toHaveLength(2);
    expect(c.servicios.map((s) => `${s.servicio}=${s.cantidad}`).sort()).toEqual(["desmontar_montar_cubierta=2", "equilibrado=2", "quitar_poner_rueda=4"]);
    expect(c.lineas).toHaveLength(10);
    expect(c.km).toBe(268659);
    expect(c.fecha).toBe("2026-10-10");
  });
  it("la anotación N2 y la salida de 2 son el MISMO montaje, con el modelo de la salida", async () => {
    const c = await conciliar(ALB_4905, [h2()]);
    const g = c.grupos.find((x) => x.cond === "nueva")!;
    expect(g.n).toBe(2);
    expect(g.fuentes).toEqual({ anotacion: 2, articulo: null, salida: 2 });
    expect(g.marca).toBe("Hankook");
    expect(g.modelo).toBe("AH51 156L");
    expect(g.medida).toBe("315/80R22.5");
    // Las dos líneas (anotación y salida) comparten el grupo; los importes siguen en sus líneas.
    expect(c.lineas.filter((l) => l.grupo === g.id).map((l) => l.papel).sort()).toEqual(["anotacion", "salida"]);
    expect(c.lineas.filter((l) => l.papel === "material").reduce((n, l) => n + (l.importe_linea ?? 0), 0)).toBeCloseTo(15.4);
  });
  it("las usadas van sin marca ni modelo, con su medida", async () => {
    const c = await conciliar(ALB_4905, [h2()]);
    const u = c.operaciones.filter((o) => o.condicion === "usada");
    expect(u.every((o) => o.marca === null && o.modelo === null && o.medida === "315/80R22.5")).toBe(true);
    expect(u[0].observaciones).toContain("[USADO]");
  });
  it("la mano de obra menor que los neumáticos anotados es informativa, no bloquea", async () => {
    const c = await conciliar(ALB_4905, [h2()]);
    expect(c.incidencias.some((i) => i.includes("Mano de obra de montaje (2) menor"))).toBe(true);
  });
  it("las claves no dependen del orden de las filas", async () => {
    const a = await conciliar(ALB_4905, [h2()]);
    const b = await conciliar([...ALB_4905].reverse(), [h2()]);
    expect(b.huella_origen).toBe(a.huella_origen);
    expect(b.operaciones.map((o) => o.origen_linea).sort()).toEqual(a.operaciones.map((o) => o.origen_linea).sort());
    expect(b.lineas.map((l) => l.origen_linea).sort()).toEqual(a.lineas.map((l) => l.origen_linea).sort());
    expect(b.grupos.map((g) => g.id).sort()).toEqual(a.grupos.map((g) => g.id).sort());
  });
  it("un albarán cambiado tiene otra huella", async () => {
    const a = await conciliar(ALB_4905, [h2()]);
    const b = await conciliar(ALB_4905.map((l) => (l.codigo === "P2815" ? { ...l, importe_linea: 7 } : l)), [h2()]);
    expect(b.huella_origen).not.toBe(a.huella_origen);
  });
});

describe("sumar por fuente, luego comparar", () => {
  const doc = (documento: string, matricula: string) => ({ documento, matricula, fecha: "2026-09-20", km: 500000 });
  it("4310: N4 + N2 = 6 nuevas de la misma referencia, salida de 6 → 6 operaciones, nada bloquea", async () => {
    const c = await conciliar([
      h1({ ...doc("B2_26/4310", "9005KMR"), codigo: "M29580225N4", descripcion: "MONTA 4 CUBIERTAS NUEVAS 295/80R22.5 AH51" }),
      h1({ ...doc("B2_26/4310", "9005KMR"), codigo: "M29580225N2", descripcion: "MONTA 2 CUBIERTAS NUEVAS 295/80R22.5 AH51" }),
      mo("9001099990017", "MONTAJE CAMION MAYOR 19.5", 6, doc("B2_26/4310", "9005KMR")),
    ], [h2({ articulo: "0107092270004", descripcion: "295/80X22.5 HANKOOK AH51 154M", vehiculo: "9005KMR", doc_salida: "B2_26/4310", unidades: -6, fecha: "2026-09-20T10:00:00.000Z" })]);
    expect(c.estado).toBe("importable");
    expect(c.operaciones).toHaveLength(6);
    expect(c.grupos).toHaveLength(1);
    expect(c.grupos[0].fuentes).toEqual({ anotacion: 6, articulo: null, salida: 6 });
    expect(c.nuevas_total).toBe(6);
  });
  it("4005: N4 + N4 repetida idéntica, corroborada por la salida de 8 → 8 operaciones", async () => {
    const l = h1({ ...doc("B2_26/4005", "6034LRF"), codigo: "M31580225N4", descripcion: "MONTA 4 CUBIERTAS NUEVAS 315/80R22.5 AH51" });
    const c = await conciliar([l, { ...l }, mo("9001099990017", "MONTAJE CAMION MAYOR 19.5", 8, doc("B2_26/4005", "6034LRF"))],
      [h2({ vehiculo: "6034LRF", doc_salida: "B2_26/4005", unidades: -8, fecha: "2026-09-20T10:00:00.000Z" })]);
    expect(c.estado).toBe("importable");
    expect(c.operaciones).toHaveLength(8);
    // Las dos líneas idénticas tienen claves distintas (k=1, k=2) y se conservan.
    expect(new Set(c.lineas.filter((x) => x.papel === "anotacion").map((x) => x.origen_linea)).size).toBe(2);
  });
  it("la misma repetición SIN corroborar queda bloqueada", async () => {
    const l = h1({ ...doc("B2_26/4005", "6034LRF"), codigo: "M31580225N4", descripcion: "MONTA 4 CUBIERTAS NUEVAS 315/80R22.5 AH51" });
    const c = await conciliar([l, { ...l }, mo("9001099990017", "MONTAJE CAMION MAYOR 19.5", 8, doc("B2_26/4005", "6034LRF"))]);
    expect(c.estado).toBe("bloqueado");
    expect(c.bloqueante).toContain("repetida");
  });
  it("descuadre anotación/salida: bloqueado, sin elegir la mayor", async () => {
    const c = await conciliar([h1({ ...doc("B2_26/1", "9005KMR"), codigo: "M29580225N2", descripcion: "MONTA 2 CUBIERTAS NUEVAS 295/80R22.5 AH51" })],
      [h2({ articulo: "0107092270004", descripcion: "295/80X22.5 HANKOOK AH51 154M", vehiculo: "9005KMR", doc_salida: "B2_26/1", unidades: -4, fecha: "2026-09-20T10:00:00.000Z" })]);
    expect(c.estado).toBe("bloqueado");
    expect(c.bloqueante).toContain("Descuadre");
    expect(c.operaciones).toHaveLength(0);
  });
  it("4508: dos referencias nuevas (DH35 ×4, AH35 ×2) con mano de obra 6 → 6 operaciones, dos grupos, no una sola referencia", async () => {
    const d = doc("B2_26/4508", "2966JMJ");
    const c = await conciliar([
      h1({ ...d, codigo: "0107091860008", descripcion: "265/70X19.5 HANKOOK DH35 M M+S", familia: "01", uds: 4, precio_unidad: 400, importe_linea: 1600 }),
      h1({ ...d, codigo: "0107091840003", descripcion: "265/70X19.5 HANKOOK AH35 140M", familia: "01", uds: 2, precio_unidad: 350, importe_linea: 700 }),
      mo("9001099990017", 'MONTAJE CAMION MAYOR 19.5"', 6, d), mo("9001999990010", "MONTAJE FIJACIÓN(QUIT.PONER)CM", 6, d),
    ]);
    expect(c.estado).toBe("importable");
    expect(c.grupos).toHaveLength(2);
    expect(c.operaciones).toHaveLength(6);
    expect(c.nuevas_total).toBe(6);
    expect(c.nuevas_una_referencia).toBe(false);
    expect(c.grupos.every((g) => g.evidencia === "articulo+mano_de_obra")).toBe(true);
  });
  it("4499: artículo ×4 con mano de obra 2 → respaldo parcial, bloqueado para revisión", async () => {
    const d = doc("B2_26/4499", "5239KVW");
    const c = await conciliar([
      h1({ ...d, codigo: "0107091840003", descripcion: "265/70X19.5 HANKOOK AH35 140M", familia: "01", uds: 4, precio_unidad: 350, importe_linea: 1400 }),
      mo("9001099990017", 'MONTAJE CAMION MAYOR 19.5"', 2, d), mo("9001999990010", "MONTAJE FIJACIÓN(QUIT.PONER)CM", 2, d),
    ]);
    expect(c.estado).toBe("bloqueado");
    expect(c.bloqueante).toContain("insuficiente");
  });
  it("salida sin ninguna mano de obra: entrega sin montaje confirmado → líneas sí, operaciones no", async () => {
    const d = doc("B2_26/4799", "9909GLS");
    const c = await conciliar([h1({ ...d, codigo: "PLANA", descripcion: "NºVEHICULO:12" })],
      [h2({ vehiculo: "9909GLS", doc_salida: "B2_26/4799", unidades: -1, fecha: "2026-09-20T10:00:00.000Z" })]);
    expect(c.estado).toBe("importable");
    expect(c.operaciones).toHaveLength(0);
    expect(c.grupos[0].montaje).toBe(false);
    expect(c.lineas.some((l) => l.papel === "salida")).toBe(true);
    expect(c.incidencias.some((i) => i.includes("sin operación"))).toBe(true);
  });
  it("MVARIAN2 + línea de artículo KUMHO: una referencia, 2 nuevas, el artículo no es otro grupo", async () => {
    const d = doc("B2_26/4668", "7694HCH");
    const c = await conciliar([
      h1({ ...d, codigo: "MVARIAN2", descripcion: "MONTA 2 CUBIERTAS NUEVAS:" }),
      h1({ ...d, codigo: "0118091560001", descripcion: "275/70X22.5 KUMHO CA31 152J148", familia: "01", uds: 2, precio_unidad: 361, importe_linea: 722 }),
      mo("9001099990017", 'MONTAJE CAMION MAYOR 19.5"', 2, d),
    ]);
    expect(c.estado).toBe("importable");
    expect(c.grupos).toHaveLength(1);
    expect(c.grupos[0]).toMatchObject({ n: 2, marca: "Kumho", modelo: "CA31 152J148", medida: "275/70R22.5", evidencia: "anotacion" });
    expect(c.grupos[0].fuentes).toEqual({ anotacion: 2, articulo: 2, salida: null });
    expect(c.operaciones).toHaveLength(2);
  });
  it("recauchutadas R4 + carcasa INSA ×4: 4 operaciones recauchutadas y la INSA es material del grupo", async () => {
    const d = doc("B2_26/1590", "1445HWZ");
    const c = await conciliar([
      h1({ ...d, codigo: "M29580225R4", descripcion: "MONTA0 4 CUBIERTAS RECAUCHUTADA 295/80X22.5 K25" }),
      h1({ ...d, codigo: "0302091080012", descripcion: "295/80X22.5 INSA K25 BASE 1ª", familia: "03", uds: 4, precio_unidad: 120, importe_linea: 480 }),
      mo("9001099990017", 'MONTAJE CAMION MAYOR 19.5"', 4, d),
    ]);
    expect(c.estado).toBe("importable");
    expect(c.operaciones).toHaveLength(4);
    expect(c.operaciones.every((o) => o.condicion === "recauchutada" && o.modelo === "K25")).toBe(true);
    const g = c.grupos[0];
    expect(c.lineas.find((l) => l.papel === "carcasa_base")!.grupo).toBe(g.id);
  });
  it("carcasa INSA sin montaje recauchutado que cuadre: bloqueado", async () => {
    const d = doc("B2_26/2", "1445HWZ");
    const c = await conciliar([h1({ ...d, codigo: "0302091080012", descripcion: "295/80X22.5 INSA K25 BASE 1ª", familia: "03", uds: 4 })]);
    expect(c.estado).toBe("bloqueado");
  });
});

describe("validaciones del origen", () => {
  it("anotación con Uds. distinta de 1: bloqueado, sin multiplicar", async () => {
    const c = await conciliar([h1({ codigo: "M29580225R4", descripcion: "MONTA0 4 CUBIERTAS RECAUCHUTADA 295/80X22.5 K25", uds: 4 })]);
    expect(c.estado).toBe("bloqueado");
    expect(c.bloqueante).toContain("Uds. = 4");
  });
  it("km: el 0 se ignora si hay un único positivo; varios positivos bloquean", async () => {
    const a = await conciliar([h1({ codigo: "RF", descripcion: "REVISION DE FLOTA", km: 0 }), h1({ codigo: "P2815", descripcion: "CONTRAPESA", uds: 2, importe_linea: 6.9 })]);
    expect(a.km).toBe(268659);
    const b = await conciliar([h1({ codigo: "RF", descripcion: "REVISION DE FLOTA", km: 100 }), h1({ codigo: "P2815", descripcion: "CONTRAPESA", uds: 2, importe_linea: 6.9, km: 200 })]);
    expect(b.estado).toBe("bloqueado");
    expect(b.bloqueante).toContain("Varios kilometrajes");
  });
  it("km ausente con montaje: se importa con incidencia", async () => {
    const c = await conciliar([h1({ codigo: "M31580225N2", descripcion: "MONTA 2 CUBIERTAS NUEVAS 315/80R22.5 AH51", km: 0 })]);
    expect(c.estado).toBe("importable");
    expect(c.km).toBeNull();
    expect(c.incidencias).toContain("Albarán sin kilometraje");
  });
  it("fecha distinta entre hojas: bloqueado", async () => {
    const c = await conciliar([h1({ codigo: "M31580225N2", descripcion: "MONTA 2 CUBIERTAS NUEVAS 315/80R22.5 AH51" })], [h2({ fecha: "2026-10-13T10:00:00.000Z" })]);
    expect(c.estado).toBe("bloqueado");
    expect(c.bloqueante).toContain("2026-10-13");
  });
  it("matrícula vacía o rara: bloqueado", async () => {
    const a = await conciliar([h1({ codigo: "RF", descripcion: "REVISION DE FLOTA", matricula: "", documento: "B2_26/0" })]);
    expect(a.bloqueante).toContain("sin matrícula");
    const b = await conciliar([h1({ codigo: "RF", descripcion: "REVISION DE FLOTA", matricula: "2289HZN1316" })]);
    expect(b.bloqueante).toContain("no válida");
  });
  it("un albarán solo de tacógrafo no tiene nada que importar", async () => {
    const c = await conciliar([h1({ codigo: "Z1500", descripcion: "KIT UNIFICADO TACOGRAFO***4300", familia: "14" }), h1({ codigo: "PLANA", descripcion: "NºVEHICULO:5" })]);
    expect(c.estado).toBe("sin_contenido");
  });
  it("las entradas del depósito no van a ningún albarán", () => {
    const { albaranes, entradas } = agruparAlbaranes([], [h2({ doc_salida: "", doc_entrada: "B2_26/196", vehiculo: "", unidades: 1400 })]);
    expect(albaranes).toHaveLength(0);
    expect(entradas).toHaveLength(1);
  });
  it("los lotes son meses naturales y el resumen cuenta por unidad", async () => {
    const a = await conciliar(ALB_4905, [h2()]);
    const b = await conciliar([h1({ codigo: "M29580225N4", descripcion: "MONTA 4 CUBIERTAS NUEVAS 295/80R22.5 AH51", documento: "B2_26/3", fecha: "2026-09-02" })]);
    const lotes = porPeriodo([a, b]);
    expect([...lotes.keys()]).toEqual(["2026-09", "2026-10"]);
    const r = resumir([a, b], 2, 0);
    expect(r).toMatchObject({ albaranes: 2, importables: 2, operaciones: 8, porCondicion: { nueva: 6, usada: 2, recauchutada: 0 }, entradasDeposito: 2 });
  });
  it("el resumen reconcilia: operaciones = nuevas + usadas + recauchutadas, y solo cuenta los importables", async () => {
    const a = await conciliar(ALB_4905, [h2()]);
    const bloqueado = await conciliar([h1({ codigo: "M29580225R4", descripcion: "MONTA0 4 CUBIERTAS RECAUCHUTADA 295/80X22.5 K25", uds: 4, documento: "B2_26/9" })]);
    const r = resumir([a, bloqueado], 0, 0);
    expect(r.operaciones).toBe(r.porCondicion.nueva + r.porCondicion.usada + r.porCondicion.recauchutada);
    expect(r.operaciones).toBe(4);
    expect(r.bloqueados).toBe(1);
    // Una operación sin condición válida no puede existir: el tipo lo impide y el resumen lo comprueba.
    expect(() => resumir([{ ...a, operaciones: [...a.operaciones, { ...a.operaciones[0], condicion: "rara" as any }] }], 0, 0)).toThrow(/descuadrado/);
  });
});
