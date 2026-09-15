import { describe, expect, it } from "vitest";
import {
  avisosDeFila,
  mismosContadores,
  pestanas,
  resumenActuaciones,
  textoActuacion,
  textoAntiguedad,
} from "./bandeja";
import type { Actuacion, Contadores, FilaBandeja } from "../types";

const contadores: Contadores = {
  pendientes: 23,
  urgentes: 4,
  reclamados: 7,
  en_proceso: 5,
  revisar: 3,
  resueltos: 120,
  todos: 155,
};

const actuacion = (sobre: Partial<Actuacion> = {}): Actuacion => ({
  id: "a1",
  expedienteId: "e1",
  tipoAccion: "GRABAR",
  accionTexto: null,
  albaranSolicitado: "9011223344",
  albaranNormalizado: "9011223344",
  importeCentimos: -4563,
  indicadorAdicional: null,
  estado: "PENDIENTE",
  obligatoria: true,
  resultado: null,
  erpReferencia: null,
  erpEstado: null,
  erpConsultadoAt: null,
  confianza: 1,
  iniciadaAt: null,
  resueltaAt: null,
  observaciones: "",
  createdAt: "2026-09-02T10:14:00.000Z",
  ...sobre,
});

const fila = (sobre: Partial<FilaBandeja> = {}): FilaBandeja =>
  ({
    id: "e1",
    numero: "INC-000452",
    urgente: false,
    numeroReclamaciones: 0,
    tareaVencida: false,
    requiereRevision: false,
    actuaciones: [],
    diasAbierto: 0,
    ...sobre,
  }) as FilaBandeja;

describe("pestañas", () => {
  it("van en orden de urgencia, no alfabético", () => {
    expect(pestanas(contadores).map((p) => p.clave)).toEqual([
      "pendientes",
      "urgentes",
      "reclamados",
      "en_proceso",
      "revisar",
      "resueltos",
    ]);
  });

  it("llevan su cuenta", () => {
    const p = pestanas(contadores);
    expect(p.find((x) => x.clave === "reclamados")?.cuenta).toBe(7);
  });

  it("sin contadores todavía, no inventan un cero", () => {
    // Un «0» mientras carga diría que no hay nada, que es distinto de no saberlo.
    expect(pestanas(null).every((p) => p.cuenta === undefined)).toBe(true);
  });

  it("sólo destacan urgentes y revisar, y sólo si tienen algo", () => {
    const con = pestanas(contadores);
    expect(con.find((p) => p.clave === "urgentes")?.alerta).toBe(true);
    expect(con.find((p) => p.clave === "revisar")?.alerta).toBe(true);
    expect(con.find((p) => p.clave === "pendientes")?.alerta).toBe(false);

    const vacio = pestanas({ ...contadores, urgentes: 0, revisar: 0 });
    expect(vacio.find((p) => p.clave === "urgentes")?.alerta).toBe(false);
  });
});

describe("resumen de actuaciones de una fila", () => {
  it("enseña dos y cuenta las demás", () => {
    const r = resumenActuaciones([actuacion(), actuacion(), actuacion()]);
    expect(r.visibles).toHaveLength(2);
    expect(r.restantes).toBe(1);
  });

  it("las descartadas no ocupan sitio ni se cuentan", () => {
    const r = resumenActuaciones([
      actuacion({ estado: "DESCARTADA" }),
      actuacion({ estado: "PENDIENTE" }),
    ]);
    expect(r.visibles).toHaveLength(1);
    expect(r.visibles[0].estado).toBe("PENDIENTE");
    expect(r.restantes).toBe(0);
  });

  it("sin actuaciones no hay nada que contar", () => {
    expect(resumenActuaciones([])).toEqual({ visibles: [], restantes: 0 });
  });
});

describe("texto de una actuación", () => {
  it("es la acción y el albarán", () => {
    expect(textoActuacion(actuacion())).toBe("GRABAR 9011223344");
  });

  /* «T2» no se sabe qué significa: se enseña sin interpretarlo y sin esconderlo. */
  it("enseña el indicador que no se sabe interpretar", () => {
    expect(textoActuacion(actuacion({ indicadorAdicional: "T2" }))).toBe("GRABAR 9011223344 (T2)");
  });

  /*
   * `MODIFICAR` y `MODIFICAR FECHA` son la misma acción normalizada. Enseñar el
   * verbo a secas deja a quien lo grabe sin saber qué hay que cambiar.
   */
  it("el matiz de la instrucción manda sobre la acción normalizada", () => {
    expect(
      textoActuacion(actuacion({ tipoAccion: "MODIFICAR", accionTexto: "MODIFICAR FECHA" }))
    ).toBe("MODIFICAR FECHA 9011223344");
  });

  it("una actuación sin albarán es sólo la acción", () => {
    expect(textoActuacion(actuacion({ tipoAccion: "APROBAR", albaranSolicitado: null }))).toBe(
      "APROBAR"
    );
  });
});

describe("antigüedad", () => {
  it("se lee en español y en singular cuando toca", () => {
    expect(textoAntiguedad(12)).toBe("12 días");
    expect(textoAntiguedad(1)).toBe("1 día");
    expect(textoAntiguedad(0)).toBe("hoy");
  });
});

describe("avisos de la fila", () => {
  it("no hay ninguno en un expediente tranquilo", () => {
    expect(avisosDeFila(fila())).toEqual([]);
  });

  it("junta urgencia, reclamaciones y revisión", () => {
    expect(
      avisosDeFila(fila({ urgente: true, numeroReclamaciones: 3, requiereRevision: true }))
    ).toEqual(["Urgente", "3 reclamaciones", "Requiere revisión"]);
  });

  it("una sola reclamación se dice en singular", () => {
    expect(avisosDeFila(fila({ numeroReclamaciones: 1 }))).toEqual(["1 reclamación"]);
  });
});

describe("comparar contadores", () => {
  /*
   * Esto corta un bucle de renderizado: la bandeja fija los contadores al
   * terminar de listar, y si eso cambiara el estado siempre, el contexto se
   * recrearía, `cargar` con él, y el efecto volvería a listar. Una petición
   * cada 250 ms con la pantalla pintándose perfectamente.
   */
  it("dos juegos con los mismos números son el mismo", () => {
    expect(mismosContadores(contadores, { ...contadores })).toBe(true);
  });

  it("una diferencia en cualquiera cuenta", () => {
    expect(mismosContadores(contadores, { ...contadores, urgentes: 5 })).toBe(false);
  });

  it("todavía sin cargar no es igual a ya cargado", () => {
    expect(mismosContadores(null, contadores)).toBe(false);
    expect(mismosContadores(contadores, null)).toBe(false);
    expect(mismosContadores(null, null)).toBe(true);
  });
});
