/**
 * La lógica del formulario de valoración.
 *
 * Lo que se fija aquí es lo que decidió 1B y es fácil de perder al tocar la
 * pantalla: que la pregunta de los motivos aparece y desaparece según la nota,
 * pero **lo que el usuario ya escribió no se borra**.
 */

import { describe, expect, it } from "vitest";

import {
  esVisible, faltantes, pasosVisibles, puedeEnviarse, respuestasAEnviar,
  siguientePaso, type Pregunta,
} from "./pasos";

const DRIVER: Pregunta[] = [
  { code: "overall_rating", tipo: "rating", obligatoria: true, min: 1, max: 5 },
  { code: "professional_rating", tipo: "rating", obligatoria: true, min: 1, max: 5 },
  { code: "resolution", tipo: "enum", obligatoria: true, valores: ["YES", "PARTIAL", "NO"] },
  { code: "negative_reasons", tipo: "multi", obligatoria: false,
    valores: ["LONG_WAIT", "VEHICLE_DAMAGE"], visibleSi: "valoracion_baja_o_no_resuelto" },
  { code: "comment", tipo: "text", obligatoria: false, maxLongitud: 2000 },
];

const CUSTOMER: Pregunta[] = [
  { code: "overall_rating", tipo: "rating", obligatoria: true, min: 1, max: 5 },
  { code: "speed_rating", tipo: "rating", obligatoria: true, min: 1, max: 5 },
  { code: "tracking_rating", tipo: "rating", obligatoria: true, min: 1, max: 5 },
  { code: "resolution", tipo: "enum", obligatoria: true, valores: ["YES", "PARTIAL", "NO"] },
];

describe("qué preguntas se enseñan", () => {
  it("el conductor ve sus cinco, con los motivos escondidos si todo fue bien", () => {
    const v = { overall_rating: 5, resolution: "YES" };
    expect(pasosVisibles(DRIVER, v).map((p) => p.code))
      .toEqual(["overall_rating", "professional_rating", "resolution", "comment"]);
  });

  it("el cliente ve las suyas", () => {
    expect(pasosVisibles(CUSTOMER, {}).map((p) => p.code))
      .toEqual(["overall_rating", "speed_rating", "tracking_rating", "resolution"]);
  });

  it("los motivos aparecen con una nota baja", () => {
    for (const nota of [1, 2]) {
      expect(esVisible(DRIVER[3], { overall_rating: nota })).toBe(true);
    }
    expect(esVisible(DRIVER[3], { overall_rating: 3 })).toBe(false);
  });

  it("y también si no quedó resuelto, aunque la nota sea buena", () => {
    expect(esVisible(DRIVER[3], { overall_rating: 5, resolution: "NO" })).toBe(true);
  });

  it("«parcialmente» por sí solo no los saca", () => {
    expect(esVisible(DRIVER[3], { overall_rating: 4, resolution: "PARTIAL" })).toBe(false);
  });
});

describe("lo que se envía", () => {
  it("va lo contestado y visible", () => {
    const v = { overall_rating: 4, professional_rating: 5, resolution: "YES", comment: "Bien" };
    expect(respuestasAEnviar(DRIVER, v)).toEqual([
      { code: "overall_rating", value: 4 },
      { code: "professional_rating", value: 5 },
      { code: "resolution", value: "YES" },
      { code: "comment", value: "Bien" },
    ]);
  });

  /*
   * LA prueba de este fichero. Poner un 1, marcar motivos y subir a 4: los
   * motivos dejan de mandarse porque ya no aplican, pero NO se borran del
   * estado — si vuelve a bajar la nota, siguen ahí.
   */
  it("subir la nota deja de enviar los motivos pero no los borra", () => {
    const conMotivos = {
      overall_rating: 1, professional_rating: 2, resolution: "YES",
      negative_reasons: ["LONG_WAIT"],
    };
    expect(respuestasAEnviar(DRIVER, conMotivos).map((r) => r.code))
      .toContain("negative_reasons");

    const subida = { ...conMotivos, overall_rating: 4 };
    expect(respuestasAEnviar(DRIVER, subida).map((r) => r.code))
      .not.toContain("negative_reasons");
    // Y el estado del usuario sigue intacto: nadie se lo ha tocado.
    expect(subida.negative_reasons).toEqual(["LONG_WAIT"]);

    // Al volver a bajarla, reaparecen tal cual estaban.
    const rebajada = { ...subida, overall_rating: 1 };
    expect(respuestasAEnviar(DRIVER, rebajada).map((r) => r.code))
      .toContain("negative_reasons");
  });

  it("lo vacío no se manda", () => {
    const v = { overall_rating: 4, professional_rating: 4, resolution: "YES",
                comment: "", negative_reasons: [] };
    expect(respuestasAEnviar(DRIVER, v).map((r) => r.code))
      .toEqual(["overall_rating", "professional_rating", "resolution"]);
  });
});

describe("cuándo se puede enviar", () => {
  it("faltan las obligatorias al principio", () => {
    expect(faltantes(DRIVER, {}))
      .toEqual(["overall_rating", "professional_rating", "resolution"]);
    expect(puedeEnviarse(DRIVER, {})).toBe(false);
  });

  it("con las tres puestas ya se puede, sin comentario ni motivos", () => {
    const v = { overall_rating: 4, professional_rating: 4, resolution: "YES" };
    expect(puedeEnviarse(DRIVER, v)).toBe(true);
  });

  /*
   * Ni siquiera con una valoración pésima se exige explicación: obligar a
   * justificarse es la forma más rápida de que alguien cierre la pestaña.
   */
  it("una valoración pésima tampoco obliga a dar motivos", () => {
    const v = { overall_rating: 1, professional_rating: 1, resolution: "NO" };
    expect(pasosVisibles(DRIVER, v).map((p) => p.code)).toContain("negative_reasons");
    expect(puedeEnviarse(DRIVER, v)).toBe(true);
  });

  it("una múltiple vacía cuenta como sin contestar", () => {
    const p: Pregunta = { code: "x", tipo: "multi", obligatoria: true, valores: ["A"] };
    expect(faltantes([p], { x: [] })).toEqual(["x"]);
    expect(faltantes([p], { x: ["A"] })).toEqual([]);
  });
});

describe("navegación", () => {
  it("avanza y se detiene al final", () => {
    const v = { overall_rating: 5, resolution: "YES" };
    const total = pasosVisibles(DRIVER, v).length;
    expect(siguientePaso(DRIVER, v, 0)).toBe(1);
    expect(siguientePaso(DRIVER, v, total - 1)).toBeNull();
  });

  it("bajar la nota alarga el recorrido", () => {
    const bien = { overall_rating: 5, resolution: "YES" };
    const mal = { overall_rating: 1, resolution: "YES" };
    expect(pasosVisibles(DRIVER, mal).length).toBe(pasosVisibles(DRIVER, bien).length + 1);
  });
});
