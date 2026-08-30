/**
 * Correlación y clasificación de errores.
 *
 * La correlación estable es la única barrera contra duplicados que tenemos:
 * TyreControl no tiene idempotency key. Y la clasificación decide qué se
 * reintenta, que en operaciones que tocan neumáticos no es un detalle.
 */

import { describe, expect, it } from "vitest";

import {
  clasificar, correlacionAsistencia, correlacionOtf, escribe, esSinPermiso,
} from "./operaciones.ts";

describe("Correlación", () => {
  /* Un UUID por intento haría que el mismo hecho fueran dos operaciones. */
  it("sale del hecho que la originó, no de un aleatorio", () => {
    expect(correlacionAsistencia(1234)).toBe("assist:1234:tc:record");
    expect(correlacionAsistencia(1234)).toBe(correlacionAsistencia(1234));
  });

  it("dos asistencias distintas no comparten correlación", () => {
    expect(correlacionAsistencia(1)).not.toBe(correlacionAsistencia(2));
  });

  it("en una OTF, cada trabajo es un hecho distinto", () => {
    expect(correlacionOtf(88, "trabajo:12")).toBe("otf:88:tc:trabajo:12");
    expect(correlacionOtf(88, "trabajo:12")).not.toBe(correlacionOtf(88, "trabajo:13"));
  });
});

describe("Qué operaciones escriben", () => {
  it("las de lectura no escriben", () => {
    expect(escribe("TC_VEHICLE_STATE")).toBe(false);
    expect(escribe("TC_AUTH_PROBE")).toBe(false);
  });

  it("las de neumáticos sí", () => {
    for (const op of ["TC_TYRE_MOUNT", "TC_TYRE_REPLACE", "TC_ASSISTANCE_RECORD"] as const) {
      expect(escribe(op)).toBe(true);
    }
  });
});

describe("Clasificación de errores", () => {
  it("los fallos de transporte se reintentan", () => {
    expect(clasificar("tc_unavailable")).toBe("retryable");
    expect(clasificar("tc_timeout")).toBe("retryable");
    expect(clasificar("otro", "fetch failed")).toBe("retryable");
    expect(clasificar("otro", "ETIMEDOUT")).toBe("retryable");
    expect(clasificar("otro", "Error 503 del servidor")).toBe("retryable");
  });

  /* Repetir «medida incompatible» es repetir para siempre algo que no va a salir. */
  it("las decisiones y los errores de configuración NO se reintentan", () => {
    for (const c of ["tc_ambiguous_plate", "tc_mapping_missing", "tc_permission_denied",
                     "tc_incompatible_size", "tc_credentials_missing", "tc_write_disabled"]) {
      expect(clasificar(c)).toBe("permanente");
    }
  });

  /* La sesión caducada se renueva sola: merece otro intento. */
  it("un token caducado se reintenta", () => {
    expect(clasificar("tc_session_expired")).toBe("retryable");
    expect(clasificar("tc_error", "JWT expired")).toBe("retryable");
  });

  /*
   * Un error desconocido NO se reintenta. Lo contrario, aplicado a operaciones
   * que mueven neumáticos, repetiría algo de lo que no se sabe si llegó a
   * hacerse.
   */
  it("lo desconocido se trata como permanente", () => {
    expect(clasificar("algo_que_nadie_ha_visto")).toBe("permanente");
    expect(clasificar(null)).toBe("permanente");
    expect(clasificar(undefined, undefined)).toBe("permanente");
  });

  it("reconoce el rechazo de permisos de TyreControl", () => {
    expect(esSinPermiso("Sin permiso para montar en esta empresa")).toBe(true);
    expect(esSinPermiso("Vehículo no encontrado")).toBe(false);
  });
});
