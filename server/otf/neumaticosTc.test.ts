import { describe, expect, it } from "vitest";

import {
  ErrorNeumaticos, etiquetaOtf, limpiarNeumaticos, montajeOtfActivo, nombreCorto, planMontaje,
  resumenPosiciones, textoNeumaticos,
} from "./neumaticosTc.ts";

const pos = (codigo: string, eje: number, lado: string, ie: string | null = null) => ({
  id: `id-${codigo}`, codigo, nombre: codigo, eje, lado, interiorExterior: ie, x: 1, y: 2, w: 14, h: 14, montado: null,
});

const tractora2x4 = [
  pos("E1_IZQ", 1, "izq"), pos("E1_DER", 1, "der"),
  pos("E2_IZQ_EXT", 2, "izq", "ext"), pos("E2_IZQ_INT", 2, "izq", "int"),
  pos("E2_DER_INT", 2, "der", "int"), pos("E2_DER_EXT", 2, "der", "ext"),
];

const entrada = (extra: Record<string, unknown> = {}) => ({
  tcEmpresaId: "emp", tcVehiculoId: null, tcTipoVehiculoId: "tipo", tipoNombre: "Tractora", config: "2x4",
  posiciones: tractora2x4, seleccion: ["E2_IZQ_EXT", "E2_IZQ_INT", "E2_DER_INT", "E2_DER_EXT"],
  referenciaId: "ref", marca: "Continental", modelo: "Conti Hybrid HD3", medida: "315/70r22.5",
  ...extra,
});

describe("lo que manda el panel", () => {
  it("un cambio de las cuatro gemelas", () => {
    const n = limpiarNeumaticos(entrada());
    expect(n.seleccion).toHaveLength(4);
    expect(n.medida).toBe("315/70R22.5");
    expect(n.condicion).toBe("nuevo");
    // Lo que se quita en una base de cliente se da de baja salvo que se diga otra cosa.
    expect(n.destinoRetirado).toBe("descartado");
    expect(textoNeumaticos(n)).toBe("4 × Continental Conti Hybrid HD3 315/70R22.5 (nuevo)");
    expect(resumenPosiciones(n)).toBe("Eje 2: izq. ext., izq. int., der. int., der. ext.");
  });

  it("sin ruedas marcadas, sin tipo o sin medida, no", () => {
    expect(() => limpiarNeumaticos(entrada({ seleccion: [] }))).toThrow(ErrorNeumaticos);
    expect(() => limpiarNeumaticos(entrada({ seleccion: ["E9_IZQ"] }))).toThrow(ErrorNeumaticos);
    expect(() => limpiarNeumaticos(entrada({ tcTipoVehiculoId: "" }))).toThrow(ErrorNeumaticos);
    expect(() => limpiarNeumaticos(entrada({ medida: " " }))).toThrow(ErrorNeumaticos);
    expect(() => limpiarNeumaticos(null)).toThrow(ErrorNeumaticos);
  });

  it("los nombres de las posiciones", () => {
    expect(nombreCorto(pos("E1_IZQ", 1, "izq"))).toBe("Eje 1 izq.");
    expect(nombreCorto(pos("E2_DER_EXT", 2, "der", "ext"))).toBe("Eje 2 der. ext.");
    const n = limpiarNeumaticos(entrada({ seleccion: ["E1_IZQ", "E1_DER", "E2_IZQ_EXT"] }));
    expect(resumenPosiciones(n)).toBe("Eje 1: izq., der. · Eje 2: izq. ext.");
  });
});

describe("plan de montaje", () => {
  const n = limpiarNeumaticos(entrada({ seleccion: ["E1_IZQ", "E1_DER", "E2_IZQ_EXT"] }));
  const etiqueta = etiquetaOtf(12, 40);

  it("rueda vacía se monta, ocupada se sustituye y la ya hecha no se repite", () => {
    const actuales = new Map([
      ["id-E1_DER", { id: "m-viejo", observaciones: "revisión" }],
      ["id-E2_IZQ_EXT", { id: "m-nuestro", observaciones: `${etiqueta} OTF #12 · Cambio` }],
    ]);
    expect(planMontaje(n, actuales, etiqueta)).toEqual([
      { posicionId: "id-E1_IZQ", codigo: "E1_IZQ", montajeActualId: null, hecho: false },
      { posicionId: "id-E1_DER", codigo: "E1_DER", montajeActualId: "m-viejo", hecho: false },
      { posicionId: "id-E2_IZQ_EXT", codigo: "E2_IZQ_EXT", montajeActualId: null, hecho: true },
    ]);
  });

  it("la marca de otro trabajo no cuenta como hecha", () => {
    const actuales = new Map([["id-E1_IZQ", { id: "m", observaciones: etiquetaOtf(12, 4) }]]);
    expect(planMontaje(n, actuales, etiqueta)[0]).toMatchObject({ hecho: false, montajeActualId: "m" });
  });
});

describe("las dos llaves", () => {
  it("apagado salvo que estén las dos", () => {
    expect(montajeOtfActivo({})).toBe(false);
    expect(montajeOtfActivo({ TYRE_CONTROL_WRITE_ENABLED: "true" })).toBe(false);
    expect(montajeOtfActivo({ TYRE_CONTROL_OTF_MOUNT_ENABLED: "true" })).toBe(false);
    expect(montajeOtfActivo({ TYRE_CONTROL_WRITE_ENABLED: "true", TYRE_CONTROL_OTF_MOUNT_ENABLED: "TRUE" })).toBe(true);
  });
});
