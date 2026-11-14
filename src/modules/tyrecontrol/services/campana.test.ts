/**
 * Lo que enseña la campana cuando hay dos clases de aviso.
 *
 * Lo que se fija aquí, sobre todo, es la regla que distingue a las dos: un
 * aviso de base se puede marcar como leído y uno de presión no, porque
 * quitarlo de la vista no infla la rueda. Si eso se rompiera, el gesto cómodo
 * pasaría a ser el que deja el neumático bajo y la pantalla limpia.
 */

import { describe, expect, it } from "vitest";

import {
  avisoDeBase, avisoDePresion, cuantosAvisos, cuantosSeMarcan, ordenarAvisos,
} from "./campana";
import type { AlertaPresion, WebfleetAlerta } from "../types";

const base = (over: Partial<WebfleetAlerta> = {}): WebfleetAlerta => ({
  id: "w1", empresa_id: "e1", vehiculo_id: "v1",
  mensaje: "El vehículo 1234ABC acaba de entrar en la base de Reus con revisión pendiente.",
  leida: false, created_at: "2026-11-11T09:00:00Z", ...over,
});

const presion = (over: Partial<AlertaPresion> = {}): AlertaPresion => ({
  id: "p1", empresa_id: "e1", vehiculo_id: "v9", posicion_id: "pos1",
  tipo: "presion_baja", severidad: "alta",
  presion_bar: 4, presion_recomendada_bar: 8, desviacion_pct: -49.65,
  medido_at: "2026-11-10T21:30:54Z", estado: "abierta", avisos: 1,
  primer_aviso_at: "2026-11-10T21:30:54Z", ultimo_aviso_at: "2026-11-10T21:30:54Z",
  posicion: { codigo_posicion: "E2_DER_INT" }, ...over,
});

describe("el ✓ distingue los dos orígenes", () => {
  it("un aviso de base se puede marcar como leído", () => {
    // Era un recordatorio: quitarlo de la vista es exactamente lo que
    // significa haberlo atendido.
    expect(avisoDeBase(base()).sePuedeMarcarLeido).toBe(true);
  });

  it("un aviso de presión NO", () => {
    // Quitarlo de la vista no infla la rueda. Si se pudiera despachar con un
    // toque, el gesto cómodo sería el que deja el neumático bajo.
    expect(avisoDePresion(presion()).sePuedeMarcarLeido).toBe(false);
  });

  it("«marcar todas leídas» no se lleva por delante los de presión", () => {
    const avisos = [avisoDeBase(base()), avisoDePresion(presion()), avisoDeBase(base({ id: "w2" }))];
    expect(cuantosAvisos(avisos)).toBe(3);
    expect(cuantosSeMarcan(avisos)).toBe(2);
  });
});

describe("qué dice cada aviso", () => {
  it("el de base dice su mensaje tal cual", () => {
    const a = avisoDeBase(base());
    expect(a.texto).toContain("1234ABC");
    expect(a.detalle).toBeNull();
  });

  it("el de presión dice matrícula, tipo y posición", () => {
    const a = avisoDePresion(presion(), "8378NBC");
    expect(a.texto).toBe("8378NBC · Presión baja en E2_DER_INT");
    expect(a.detalle).toBe("4 bar de 8 recomendados (-49.65 %)");
  });

  it("sin matrícula no se inventa un hueco raro", () => {
    expect(avisoDePresion(presion()).texto).toBe("Presión baja en E2_DER_INT");
  });

  it("si la rueda lleva días avisando, se dice en el detalle", () => {
    // Es lo que distingue una presión baja de una fuga, y en la campana es
    // justo lo que hace mirar.
    const a = avisoDePresion(presion({ avisos: 3, primer_aviso_at: "2026-11-08T07:58:00Z" }));
    expect(a.detalle).toContain("3 avisos desde el 08/11");
  });

  it("el desinflado se llama por su nombre", () => {
    const a = avisoDePresion(presion({ tipo: "desinflado", presion_bar: null, desviacion_pct: null }));
    expect(a.texto).toContain("Neumático desinflado");
    expect(a.detalle).toContain("Sin lectura del sensor");
  });

  it("sin posición enlazada se dice, no se deja en blanco", () => {
    const a = avisoDePresion(presion({ posicion: null }));
    expect(a.texto).toContain("posición desconocida");
  });
});

describe("el orden", () => {
  it("la presión va antes que las entradas en base", () => {
    // Aunque la entrada en base sea de esta mañana y el aviso de presión de
    // anoche: una rueda baja es un riesgo ahora, y una entrada en base es una
    // oportunidad de revisar. Por fecha, lo que importa quedaría debajo.
    const avisos = ordenarAvisos([
      avisoDeBase(base({ created_at: "2026-11-11T09:00:00Z" })),
      avisoDePresion(presion({ ultimo_aviso_at: "2026-11-10T21:30:54Z" })),
    ]);
    expect(avisos.map((a) => a.origen)).toEqual(["presion", "base"]);
  });

  it("dentro de cada grupo, lo más reciente arriba", () => {
    const avisos = ordenarAvisos([
      avisoDeBase(base({ id: "viejo", created_at: "2026-11-09T08:00:00Z" })),
      avisoDeBase(base({ id: "nuevo", created_at: "2026-11-11T08:00:00Z" })),
    ]);
    expect(avisos.map((a) => a.id)).toEqual(["nuevo", "viejo"]);
  });

  it("dos avisos a la misma hora no bailan entre refrescos", () => {
    // `Array.sort` es estable en JS, pero el orden de llegada de dos consultas
    // distintas no lo es: el desempate por clave lo fija.
    const mismos = () => [
      avisoDeBase(base({ id: "b", created_at: "2026-11-11T08:00:00Z" })),
      avisoDeBase(base({ id: "a", created_at: "2026-11-11T08:00:00Z" })),
    ];
    const uno = ordenarAvisos(mismos()).map((a) => a.id);
    const otro = ordenarAvisos(mismos().reverse()).map((a) => a.id);
    expect(uno).toEqual(otro);
  });

  it("un aviso sin fecha no se cuela arriba", () => {
    const avisos = ordenarAvisos([
      avisoDeBase(base({ id: "sinfecha", created_at: null })),
      avisoDeBase(base({ id: "confecha", created_at: "2026-11-11T08:00:00Z" })),
    ]);
    expect(avisos[0].id).toBe("confecha");
  });

  it("no toca la lista que recibe", () => {
    const avisos = [avisoDeBase(base({ id: "w1" })), avisoDeBase(base({ id: "w2" }))];
    ordenarAvisos(avisos);
    expect(avisos.map((a) => a.id)).toEqual(["w1", "w2"]);
  });
});

describe("la cuenta del número rojo", () => {
  it("suma los dos orígenes", () => {
    // Un aviso de presión abierto es algo pendiente aunque no se pueda marcar
    // como leído. Dejarlo fuera sería esconderlo justo donde se mira para
    // saber si hay algo.
    expect(cuantosAvisos([avisoDeBase(base()), avisoDePresion(presion())])).toBe(2);
  });

  it("sin nada, cero", () => {
    expect(cuantosAvisos([])).toBe(0);
    expect(cuantosSeMarcan([])).toBe(0);
  });
});
