/**
 * Reglas del expediente. Sin base de datos: son las mismas comprobaciones que
 * hace la hoja `DATOS` del libro, y su valor está en que no se separen de ella.
 */

import { describe, it, expect } from "vitest";
import {
  camposQueFaltan,
  fechaLimiteDestruccion,
  normalizarMatricula,
  seAchatarra,
  type DatosExpediente,
} from "./domain.ts";

function completo(): DatosExpediente {
  return {
    numInforme: "E943009003781L",
    tipo: "intransferibilidad",
    empresaCliente: "COMERCIAL TANK FOODS S.L.",
    autorizaNombre: "Joan Pla Serra",
    autorizaNif: "39887654T",
    docTitularidad: true,
    matricula: "7567MPF",
    bastidor: "VF3XXXXXXXXXXXXXX",
    tacMarca: "VDO",
    tacModelo: "1381.7550303006",
    tacSerie: "1000567",
    fechaInforme: "2025-03-10",
    fechaEntrega: "2025-03-14",
    fechaTransferencia: null,
    fechaEnvio: null,
    tecnico: "Marc Roig",
    modalidadEntrega: null,
    receptorNombre: "Marta Solé Vidal",
    receptorDni: "40123456X",
    entregaAparato: false,
    intervencionId: null,
  };
}

describe("camposQueFaltan", () => {
  it("no exige nada cuando la intransferibilidad está completa", () => {
    expect(camposQueFaltan(completo())).toEqual([]);
  });

  it("exige modalidad y fecha de transferencia sólo en una transferencia", () => {
    const d = { ...completo(), tipo: "transferencia" as const };
    const faltan = camposQueFaltan(d).map((c) => c.campo);
    expect(faltan).toContain("modalidadEntrega");
    expect(faltan).toContain("fechaTransferencia");
    // Los del acuse no aplican a una transferencia correcta.
    expect(faltan).not.toContain("receptorNombre");
    expect(faltan).not.toContain("fechaEntrega");
  });

  it("exige receptor y fecha de entrega sólo en una intransferibilidad", () => {
    const d = { ...completo(), receptorNombre: "", receptorDni: "  " };
    const faltan = camposQueFaltan(d).map((c) => c.campo);
    expect(faltan).toEqual(["receptorNombre", "receptorDni"]);
  });

  it("los campos comunes se exigen en los dos tipos", () => {
    for (const tipo of ["transferencia", "intransferibilidad"] as const) {
      const d = { ...completo(), tipo, tacSerie: "", tecnico: "" };
      const faltan = camposQueFaltan(d).map((c) => c.campo);
      expect(faltan).toContain("tacSerie");
      expect(faltan).toContain("tecnico");
    }
  });

  it("devuelve todos los que faltan de una vez, no el primero", () => {
    const d = { ...completo(), empresaCliente: "", autorizaNombre: "", matricula: "" };
    expect(camposQueFaltan(d)).toHaveLength(3);
  });

  it("un campo con sólo espacios cuenta como vacío", () => {
    expect(camposQueFaltan({ ...completo(), autorizaNif: "   " })).toHaveLength(1);
  });
});

describe("normalizarMatricula", () => {
  it("pasa a mayúsculas y quita los espacios", () => {
    expect(normalizarMatricula(" 7567 mpf ")).toBe("7567MPF");
  });
});

describe("seAchatarra", () => {
  it("es siempre lo contrario de entregar el aparato", () => {
    expect(seAchatarra(true)).toBe(false);
    expect(seAchatarra(false)).toBe(true);
  });
});

describe("fechaLimiteDestruccion", () => {
  it("es un año exacto después de la transferencia", () => {
    expect(fechaLimiteDestruccion("2025-03-10")).toBe("2026-03-10");
  });

  it("no hay plazo si no hubo transferencia", () => {
    // En una intransferibilidad no existe archivo que custodiar: de eso da fe
    // el propio certificado.
    expect(fechaLimiteDestruccion(null)).toBeNull();
  });

  it("un 29 de febrero cae en el 1 de marzo del año siguiente", () => {
    expect(fechaLimiteDestruccion("2024-02-29")).toBe("2025-03-01");
  });

  it("una fecha con formato inesperado no revienta", () => {
    expect(fechaLimiteDestruccion("10/03/2025")).toBeNull();
  });
});
