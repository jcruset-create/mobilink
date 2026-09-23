import { describe, it, expect } from "vitest";
import { cuentasDeConfiguracion, claveDeTipo, prepararTipo, type BorradorTipo } from "./tipoVehiculo";

const vacio: BorradorTipo = {
  nombre: "", descripcion: "", configuracionEjes: "",
  numeroEjes: "", numeroRuedas: "", revisionDias: "", revisionKm: "",
};

describe("cuentasDeConfiguracion", () => {
  it("cuenta los ejes y suma las ruedas", () => {
    expect(cuentasDeConfiguracion("2x4x2")).toEqual({ ejes: 3, ruedas: 8 });
    expect(cuentasDeConfiguracion("2x4x4")).toEqual({ ejes: 3, ruedas: 10 });
    expect(cuentasDeConfiguracion("2x4")).toEqual({ ejes: 2, ruedas: 6 });
  });

  it("no se inventa nada con una etiqueta que no entiende", () => {
    // Un plano inventado descuadra el vehículo y nadie lo revisa después.
    expect(cuentasDeConfiguracion("tridem")).toBeNull();
    expect(cuentasDeConfiguracion("2-4-2")).toBeNull();
    expect(cuentasDeConfiguracion("2x6x2")).toBeNull();
    expect(cuentasDeConfiguracion("")).toBeNull();
    expect(cuentasDeConfiguracion(null)).toBeNull();
  });
});

describe("claveDeTipo", () => {
  it("sale como los tipos que ya existen", () => {
    expect(claveDeTipo("Cabeza tractora 2 ejes")).toBe("cabeza_tractora_2_ejes");
    expect(claveDeTipo("Camión 3 ejes")).toBe("camion_3_ejes");
    expect(claveDeTipo("  Autocar 3 ejes gemelos  ")).toBe("autocar_3_ejes_gemelos");
  });
});

describe("prepararTipo", () => {
  it("la configuración manda sobre ejes y ruedas", () => {
    const r = prepararTipo({ ...vacio, descripcion: "Camión 3 ejes", configuracionEjes: "2x4x4",
                             numeroEjes: "9", numeroRuedas: "99" });
    expect(r).toEqual({ tipo: expect.objectContaining({ numero_ejes: 3, numero_ruedas: 10 }) });
  });

  it("sin configuración se aceptan las cuentas a mano", () => {
    const r = prepararTipo({ ...vacio, descripcion: "Remolque", numeroEjes: "2", numeroRuedas: "8" });
    expect(r).toEqual({ tipo: expect.objectContaining({
      nombre: "remolque", numero_ejes: 2, numero_ruedas: 8, configuracion_ejes: null,
    }) });
  });

  it("la clave se propone de la descripción y se puede escribir a mano", () => {
    expect(prepararTipo({ ...vacio, descripcion: "Autocar 3 ejes", numeroEjes: "3", numeroRuedas: "10" }))
      .toEqual({ tipo: expect.objectContaining({ nombre: "autocar_3_ejes" }) });
    expect(prepararTipo({ ...vacio, nombre: "autocar_gemelos", descripcion: "Autocar 3 ejes",
                          numeroEjes: "3", numeroRuedas: "10" }))
      .toEqual({ tipo: expect.objectContaining({ nombre: "autocar_gemelos" }) });
  });

  it("no deja pasar un tipo a medio hacer", () => {
    expect(prepararTipo(vacio)).toEqual({ error: expect.stringContaining("descripción") });
    expect(prepararTipo({ ...vacio, descripcion: "X", nombre: "Con Mayúsculas" }))
      .toEqual({ error: expect.stringContaining("clave") });
    expect(prepararTipo({ ...vacio, descripcion: "X", configuracionEjes: "tridem" }))
      .toEqual({ error: expect.stringContaining("tridem") });
    expect(prepararTipo({ ...vacio, descripcion: "X", numeroEjes: "2", numeroRuedas: "7" }))
      .toEqual({ error: expect.stringContaining("par") });
    expect(prepararTipo({ ...vacio, descripcion: "X", numeroEjes: "4", numeroRuedas: "4" }))
      .toEqual({ error: expect.stringContaining("menos ruedas") });
    expect(prepararTipo({ ...vacio, descripcion: "X", numeroEjes: "0", numeroRuedas: "4" }))
      .toEqual({ error: expect.stringContaining("ejes") });
  });

  it("las periodicidades son opcionales, pero si se ponen son enteros", () => {
    expect(prepararTipo({ ...vacio, descripcion: "X", configuracionEjes: "2x2", revisionDias: "90", revisionKm: "30000" }))
      .toEqual({ tipo: expect.objectContaining({ revision_intervalo_dias: 90, revision_intervalo_km: 30000 }) });
    expect(prepararTipo({ ...vacio, descripcion: "X", configuracionEjes: "2x2" }))
      .toEqual({ tipo: expect.objectContaining({ revision_intervalo_dias: null, revision_intervalo_km: null }) });
    expect(prepararTipo({ ...vacio, descripcion: "X", configuracionEjes: "2x2", revisionDias: "-3" }))
      .toEqual({ error: expect.stringContaining("días") });
  });
});
