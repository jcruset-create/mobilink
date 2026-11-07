/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Validación de la salida del modelo.
 *
 * El caso que importa es el incómodo: el modelo cita una evidencia que EXISTE
 * y escribe sobre ella algo que no se sostiene. Un identificador válido no
 * demuestra que la frase sea correcta, así que aquí se prueba qué parte de eso
 * se puede atajar (lo comprobable lo pone el servidor) y se deja constancia de
 * lo que no (el contenido redactado).
 */
import { describe, expect, it } from "vitest";
import { validar } from "./validar.ts";
import type { DatosResumen, Ref } from "./datos.ts";

const VEHICULO = "33333333-3333-4333-8333-333333333333";
const IV = "44444444-4444-4444-8444-444444444444";

const refs = new Map<string, Ref>([
  ["VH1", { ref: "VH1", tipo: "vehiculo", id: VEHICULO, etiqueta: "Ficha de 1234 ABC" }],
  ["IV2", { ref: "IV2", tipo: "intervencion", id: IV, etiqueta: "Intervención 100" }],
]);
const ctx = { vehiculoId: VEHICULO, intervencionDeOperacion: new Map<string, string | null>() };

const datos = (extra: Partial<DatosResumen> = {}): DatosResumen => ({
  generado_at: "2026-10-29T10:00:00.000Z",
  ventana: { meses: 24, desde: "2024-10-29" },
  vehiculo: {}, montajes_vivos: [], intervenciones: [], operaciones: [],
  revisiones: [], incidencias_abiertas: [], planes: [],
  datos_que_faltan: [{ clave: "sin_km", texto: "El vehículo no tiene kilometraje registrado." }],
  contradicciones: [], recortes: [],
  ...extra,
});

describe("validar · afirmaciones sin respaldo", () => {
  it("un hecho sin referencias se elimina; no se convierte en hipótesis", () => {
    const r = validar(
      { ultimas_actuaciones: [{ texto: "Se cambiaron los seis neumáticos", refs: [] }] },
      datos(), refs, ctx,
    );
    expect(r.ultimas_actuaciones).toEqual([]);
    expect(r.descartados).toBe(1);
    // Y en ningún sitio aparece el texto con una etiqueta de «posible».
    expect(JSON.stringify(r)).not.toContain("neumáticos");
  });

  it("un hecho que cita una referencia inventada también se elimina", () => {
    const r = validar(
      { trabajos_pendientes: [{ texto: "Hay una revisión pendiente", refs: ["RV9", "IV7"] }] },
      datos(), refs, ctx,
    );
    expect(r.trabajos_pendientes).toEqual([]);
    expect(r.descartados).toBe(1);
  });

  it("si de dos referencias solo una resuelve, el hecho se queda con esa", () => {
    const r = validar(
      { ultimas_actuaciones: [{ texto: "Última intervención registrada", refs: ["IV2", "IV9"] }] },
      datos(), refs, ctx,
    );
    expect(r.ultimas_actuaciones).toHaveLength(1);
    expect(r.ultimas_actuaciones[0].evidencias.map((e) => e.ref)).toEqual(["IV2"]);
  });

  it("si el modelo escribe un enlace o un uuid, ese hecho se tira entero", () => {
    const r = validar({
      ultimas_actuaciones: [
        { texto: `Ver la intervención en /tyrecontrol/intervenciones/${IV}`, refs: ["IV2"] },
        { texto: `Intervención ${IV}`, refs: ["IV2"] },
        { texto: "Consulta https://ejemplo.invalido/parte", refs: ["IV2"] },
      ],
    } as any, datos(), refs, ctx);
    expect(r.ultimas_actuaciones).toEqual([]);
    expect(r.descartados).toBe(3);
  });

  it("una evidencia válida no convierte en cierto lo que dice la frase: eso queda en el prompt y en la ventana de datos", () => {
    // Límite conocido y asumido: si el modelo cita IV2 y escribe una
    // barbaridad sobre esa intervención, el servidor no puede detectarlo. Lo
    // que sí garantiza es que el enlace lleva al registro real, para que quien
    // lo lea pueda comprobarlo.
    const r = validar(
      { ultimas_actuaciones: [{ texto: "En esta intervención se montaron ruedas de camión", refs: ["IV2"] }] },
      datos(), refs, ctx,
    );
    expect(r.ultimas_actuaciones).toHaveLength(1);
    expect(r.ultimas_actuaciones[0].evidencias[0].ruta).toBe(`/tyrecontrol/intervenciones/${IV}`);
  });
});

describe("validar · lo comprobable lo pone el servidor", () => {
  it("una carencia inventada por el modelo se descarta", () => {
    const r = validar(
      { datos_que_faltan: [{ clave: "sin_frenos", texto: "No consta el estado de los frenos." }] },
      datos(), refs, ctx,
    );
    expect(r.datos_que_faltan.map((d) => d.clave)).toEqual(["sin_km"]);
  });

  it("el texto de la carencia es el del servidor, no el del modelo", () => {
    const r = validar(
      { datos_que_faltan: [{ clave: "sin_km", texto: "El vehículo tiene 900.000 km" }] },
      datos(), refs, ctx,
    );
    expect(r.datos_que_faltan[0].texto).toBe("El vehículo no tiene kilometraje registrado.");
  });

  it("una carencia que el modelo se calla se añade igual", () => {
    const r = validar({ datos_que_faltan: [] }, datos(), refs, ctx);
    expect(r.datos_que_faltan.map((d) => d.clave)).toEqual(["sin_km"]);
  });

  it("los avisos son los del servidor: contradicciones y recortes tal cual", () => {
    const r = validar(
      { avisos: ["todo en orden"] },
      datos({ contradicciones: ["Un odómetro no retrocede."], recortes: ["De 9 intervenciones se envían 5."] }),
      refs, ctx,
    );
    expect(r.avisos).toEqual(["Un odómetro no retrocede.", "De 9 intervenciones se envían 5."]);
  });
});

describe("validar · salidas defectuosas", () => {
  it("una salida vacía no rompe nada", () => {
    const r = validar({}, datos(), refs, ctx);
    expect(r).toMatchObject({ titular: "", ultimas_actuaciones: [], incidencias_abiertas: [], trabajos_pendientes: [] });
  });

  it("secciones que no son listas se ignoran", () => {
    const r = validar({ ultimas_actuaciones: "una frase", incidencias_abiertas: { texto: "x" } } as any, datos(), refs, ctx);
    expect(r.ultimas_actuaciones).toEqual([]);
    expect(r.incidencias_abiertas).toEqual([]);
  });

  it("el titular se limpia y se acota", () => {
    const r = validar({ titular: `Autocar  de\nlínea${" largo".repeat(100)}` }, datos(), refs, ctx);
    expect(r.titular).not.toContain("\n");
    expect(r.titular.length).toBeLessThanOrEqual(240);
  });

  it("no se aceptan hechos sin fin: la lista se acota", () => {
    const muchos = Array.from({ length: 40 }, () => ({ texto: "Intervención registrada", refs: ["IV2"] }));
    const r = validar({ ultimas_actuaciones: muchos }, datos(), refs, ctx);
    expect(r.ultimas_actuaciones.length).toBeLessThanOrEqual(8);
  });
});
