/**
 * El dominio de Satisfaction, sin base de datos.
 *
 * Lo que más importa de este fichero son las reglas de calidad: son las que
 * deciden si alguien tiene que mirar un servicio, y equivocarse por lo bajo
 * significa que una queja por daños en el vehículo no le llega a nadie.
 */

import { describe, expect, it } from "vitest";

import {
  ESTADOS_CASO, ESTADOS_ENCUESTA, MAX_COMENTARIO, PLANTILLAS_V1,
  PLANTILLA_CLIENTE, PLANTILLA_CONDUCTOR, evaluarCalidad, plantillaDeRol,
  puedeResponderse, transicionCasoValida, transicionValida, validarRespuesta,
  type RespuestaEntrante,
} from "./dominio.ts";

/* ── Plantillas ──────────────────────────────────────────────────────────── */

describe("plantillas V1", () => {
  it("los códigos son únicos y llevan versión", () => {
    const claves = PLANTILLAS_V1.map((p) => `${p.code}@${p.version}`);
    expect(new Set(claves).size).toBe(claves.length);
    for (const p of PLANTILLAS_V1) expect(p.version).toBeGreaterThanOrEqual(1);
  });

  it("cada rol tiene la suya", () => {
    expect(plantillaDeRol("DRIVER")).toBe(PLANTILLA_CONDUCTOR);
    expect(plantillaDeRol("CUSTOMER")).toBe(PLANTILLA_CLIENTE);
  });

  it("las obligatorias del conductor son las tres valoraciones de servicio", () => {
    const obligatorias = PLANTILLA_CONDUCTOR.preguntas.filter((p) => p.obligatoria).map((p) => p.code);
    expect(obligatorias).toEqual(["overall_rating", "professional_rating", "resolution"]);
  });

  it("el comentario y los motivos nunca son obligatorios", () => {
    for (const p of PLANTILLAS_V1) {
      for (const code of ["comment", "negative_reasons"]) {
        expect(p.preguntas.find((q) => q.code === code)?.obligatoria).toBe(false);
      }
    }
  });

  it("los dos formularios comparten la lista de motivos, para poder contarlos juntos", () => {
    const dc = PLANTILLA_CONDUCTOR.preguntas.find((p) => p.code === "negative_reasons");
    const cl = PLANTILLA_CLIENTE.preguntas.find((p) => p.code === "negative_reasons");
    expect(dc?.valores).toEqual(cl?.valores);
  });
});

/* ── Validación ──────────────────────────────────────────────────────────── */

const completaConductor = (extra: RespuestaEntrante[] = []): RespuestaEntrante[] => [
  { code: "overall_rating", value: 4 },
  { code: "professional_rating", value: 5 },
  { code: "resolution", value: "YES" },
  ...extra,
];

describe("validación de respuestas", () => {
  it("acepta una respuesta completa", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR, completaConductor());
    expect(v.ok).toBe(true);
    expect(v.valores.get("overall_rating")).toBe(4);
  });

  it("rechaza valoraciones fuera de la escala", () => {
    for (const malo of [0, 6, -1, 2.5]) {
      const v = validarRespuesta(PLANTILLA_CONDUCTOR, [
        { code: "overall_rating", value: malo },
        { code: "professional_rating", value: 3 },
        { code: "resolution", value: "YES" },
      ]);
      expect(v.ok).toBe(false);
      expect(v.errores.some((e) => e.code === "overall_rating" && e.motivo === "fuera_de_escala")).toBe(true);
    }
  });

  it("rechaza una resolución que no existe", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR, [
      { code: "overall_rating", value: 3 },
      { code: "professional_rating", value: 3 },
      { code: "resolution", value: "QUIZAS" },
    ]);
    expect(v.errores).toContainEqual({ code: "resolution", motivo: "valor_invalido" });
  });

  it("rechaza un motivo negativo desconocido", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR,
      completaConductor([{ code: "negative_reasons", value: ["LONG_WAIT", "LLOVIA"] }]));
    expect(v.errores).toContainEqual({ code: "negative_reasons", motivo: "valor_invalido" });
  });

  it("rechaza una pregunta que no es de la plantilla", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR,
      completaConductor([{ code: "cuanto_cobras", value: "mucho" }]));
    expect(v.errores).toContainEqual({ code: "cuanto_cobras", motivo: "pregunta_desconocida" });
  });

  it("rechaza la misma pregunta dos veces", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR,
      completaConductor([{ code: "overall_rating", value: 1 }]));
    expect(v.errores).toContainEqual({ code: "overall_rating", motivo: "pregunta_duplicada" });
  });

  it("rechaza un comentario desmesurado", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR,
      completaConductor([{ code: "comment", value: "a".repeat(MAX_COMENTARIO + 1) }]));
    expect(v.errores).toContainEqual({ code: "comment", motivo: "demasiado_largo" });
    // Y acepta justo el límite.
    expect(validarRespuesta(PLANTILLA_CONDUCTOR,
      completaConductor([{ code: "comment", value: "a".repeat(MAX_COMENTARIO) }])).ok).toBe(true);
  });

  it("exige las obligatorias", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR, [{ code: "overall_rating", value: 4 }]);
    expect(v.errores).toContainEqual({ code: "professional_rating", motivo: "falta_obligatoria" });
    expect(v.errores).toContainEqual({ code: "resolution", motivo: "falta_obligatoria" });
  });

  it("devuelve TODOS los errores, no el primero", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR, [
      { code: "overall_rating", value: 9 },
      { code: "resolution", value: "NI_IDEA" },
      { code: "inventada", value: 1 },
    ]);
    expect(v.errores.length).toBeGreaterThanOrEqual(4);
  });

  it("una selección múltiple repetida se limpia, no se rechaza", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR,
      completaConductor([{ code: "negative_reasons", value: ["LONG_WAIT", "LONG_WAIT"] }]));
    expect(v.ok).toBe(true);
    expect(v.valores.get("negative_reasons")).toEqual(["LONG_WAIT"]);
  });

  it("una múltiple que no es lista es un error de tipo", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR,
      completaConductor([{ code: "negative_reasons", value: "LONG_WAIT" }]));
    expect(v.errores).toContainEqual({ code: "negative_reasons", motivo: "tipo_invalido" });
  });

  /*
   * La visibilidad condicional es una pista para la pantalla, no una regla de
   * validación: alguien puede empezar con un 1, escribir los motivos y subir la
   * nota antes de enviar. Rechazarlo perdería lo que ya había escrito.
   */
  it("acepta motivos negativos aunque la valoración sea buena", () => {
    const v = validarRespuesta(PLANTILLA_CONDUCTOR,
      completaConductor([{ code: "negative_reasons", value: ["LONG_WAIT"] }]));
    expect(v.ok).toBe(true);
  });

  it("el formulario de cliente pide sus tres valoraciones", () => {
    const v = validarRespuesta(PLANTILLA_CLIENTE, [
      { code: "overall_rating", value: 4 },
      { code: "resolution", value: "YES" },
    ]);
    expect(v.errores).toContainEqual({ code: "speed_rating", motivo: "falta_obligatoria" });
    expect(v.errores).toContainEqual({ code: "tracking_rating", motivo: "falta_obligatoria" });
  });
});

/* ── Reglas de calidad ───────────────────────────────────────────────────── */

const valores = (o: Record<string, string | number | string[]>) =>
  new Map<string, string | number | string[]>(Object.entries(o));

describe("reglas de calidad", () => {
  it("un servicio bien valorado y resuelto no abre nada", () => {
    expect(evaluarCalidad(valores({ overall_rating: 5, resolution: "YES" })))
      .toEqual({ abreCaso: false });
    expect(evaluarCalidad(valores({ overall_rating: 3, resolution: "YES" })))
      .toEqual({ abreCaso: false });
  });

  it("una valoración de 2 o menos abre caso HIGH", () => {
    for (const nota of [1, 2]) {
      expect(evaluarCalidad(valores({ overall_rating: nota, resolution: "YES" })))
        .toEqual({ abreCaso: true, motivo: "LOW_RATING", prioridad: "HIGH" });
    }
  });

  it("«no resuelto» abre caso HIGH aunque la nota sea buena", () => {
    expect(evaluarCalidad(valores({ overall_rating: 5, resolution: "NO" })))
      .toEqual({ abreCaso: true, motivo: "NOT_RESOLVED", prioridad: "HIGH" });
  });

  it("mala nota y sin resolver sigue siendo HIGH, y el motivo es el más grave", () => {
    expect(evaluarCalidad(valores({ overall_rating: 1, resolution: "NO" })))
      .toEqual({ abreCaso: true, motivo: "NOT_RESOLVED", prioridad: "HIGH" });
  });

  /*
   * Los daños son un hecho, no una percepción: mandan sobre la nota. Un 5 con
   * el vehículo rayado sigue siendo crítico.
   */
  it("los daños en el vehículo son CRITICAL, gane lo que gane la nota", () => {
    expect(evaluarCalidad(valores({
      overall_rating: 5, resolution: "YES", negative_reasons: ["VEHICLE_DAMAGE"],
    }))).toEqual({ abreCaso: true, motivo: "VEHICLE_DAMAGE", prioridad: "CRITICAL" });

    expect(evaluarCalidad(valores({
      overall_rating: 1, resolution: "NO", negative_reasons: ["LONG_WAIT", "VEHICLE_DAMAGE"],
    }))).toEqual({ abreCaso: true, motivo: "VEHICLE_DAMAGE", prioridad: "CRITICAL" });
  });

  it("«parcialmente resuelto» por sí solo no abre caso", () => {
    expect(evaluarCalidad(valores({ overall_rating: 4, resolution: "PARTIAL" })))
      .toEqual({ abreCaso: false });
  });

  it("varios motivos marcados siguen dando UN caso, con el más grave", () => {
    const r = evaluarCalidad(valores({
      overall_rating: 1, resolution: "NO",
      negative_reasons: ["LONG_WAIT", "POOR_TREATMENT", "VEHICLE_DAMAGE", "OTHER"],
    }));
    expect(r).toEqual({ abreCaso: true, motivo: "VEHICLE_DAMAGE", prioridad: "CRITICAL" });
  });

  it("sin valoración ni resolución no se inventa un caso", () => {
    expect(evaluarCalidad(valores({ comment: "gracias" }))).toEqual({ abreCaso: false });
  });
});

/* ── Máquinas de estado ──────────────────────────────────────────────────── */

describe("estados de la encuesta", () => {
  it("el camino normal es válido de principio a fin", () => {
    const camino = ["CREATED", "QUEUED", "SENT", "DELIVERED", "STARTED", "COMPLETED"] as const;
    for (let i = 0; i < camino.length - 1; i++) {
      expect(transicionValida(camino[i], camino[i + 1])).toBe(true);
    }
  });

  it("se puede saltar hacia adelante: el enlace se abre antes de la confirmación", () => {
    expect(transicionValida("CREATED", "STARTED")).toBe(true);
    expect(transicionValida("SENT", "COMPLETED")).toBe(true);
  });

  it("nunca se vuelve atrás", () => {
    expect(transicionValida("SENT", "QUEUED")).toBe(false);
    expect(transicionValida("STARTED", "SENT")).toBe(false);
    expect(transicionValida("DELIVERED", "CREATED")).toBe(false);
  });

  it("COMPLETED es final: ni caduca ni se cancela", () => {
    for (const e of ESTADOS_ENCUESTA) expect(transicionValida("COMPLETED", e)).toBe(false);
  });

  it("CANCELLED es final", () => {
    for (const e of ESTADOS_ENCUESTA) expect(transicionValida("CANCELLED", e)).toBe(false);
  });

  it("una caducada se archiva, pero no se revive", () => {
    expect(transicionValida("EXPIRED", "CANCELLED")).toBe(true);
    expect(transicionValida("EXPIRED", "STARTED")).toBe(false);
    expect(transicionValida("EXPIRED", "COMPLETED")).toBe(false);
  });

  it("una fallida se reencola", () => {
    expect(transicionValida("FAILED", "QUEUED")).toBe(true);
  });

  it("solo se puede contestar desde los estados vivos", () => {
    for (const e of ["CREATED", "QUEUED", "SENT", "DELIVERED", "STARTED"] as const) {
      expect(puedeResponderse(e)).toBe(true);
    }
    for (const e of ["COMPLETED", "EXPIRED", "FAILED", "CANCELLED"] as const) {
      expect(puedeResponderse(e)).toBe(false);
    }
  });
});

describe("estados del caso de calidad", () => {
  it("el camino normal es válido", () => {
    expect(transicionCasoValida("NEW", "IN_REVIEW")).toBe(true);
    expect(transicionCasoValida("IN_REVIEW", "PENDING_PROVIDER")).toBe(true);
    expect(transicionCasoValida("PENDING_PROVIDER", "RESOLVED")).toBe(true);
    expect(transicionCasoValida("RESOLVED", "CLOSED")).toBe(true);
  });

  it("un caso resuelto se puede reabrir; uno cerrado, no", () => {
    expect(transicionCasoValida("RESOLVED", "IN_REVIEW")).toBe(true);
    for (const e of ESTADOS_CASO) expect(transicionCasoValida("CLOSED", e)).toBe(false);
  });

  it("no se vuelve a NEW nunca", () => {
    for (const e of ESTADOS_CASO) expect(transicionCasoValida(e, "NEW")).toBe(false);
  });

  it("se puede cerrar en corto desde el principio", () => {
    // Un caso que resulta ser una percepción y nada más no obliga a pasar por
    // todas las bandejas.
    expect(transicionCasoValida("NEW", "CLOSED")).toBe(true);
  });
});
