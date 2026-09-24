/**
 * El cruce por nombre entre tipo y configuración de ejes.
 *
 * No hay clave ajena que lo garantice, así que estos casos son el contrato.
 */

import { describe, expect, it } from "vitest";
import { avisoDeConfig, configDelTipo } from "./altaLoteConfig.ts";

const CONFIGS = [
  { id: "c-2ejes", nombre: "2 ejes" },
  { id: "c-3ejes", nombre: "3 ejes" },
];
const TIPOS = [
  { id: "t-autocar", nombre: "Autocar", configuracion_ejes: "2 ejes" },
  { id: "t-grande", nombre: "Autocar grande", configuracion_ejes: "3 EJES" },
  { id: "t-raro", nombre: "Góndola", configuracion_ejes: "5 ejes" },
  { id: "t-mudo", nombre: "Sin declarar", configuracion_ejes: null },
];

describe("configDelTipo()", () => {
  it("casa por nombre", () => {
    expect(configDelTipo("t-autocar", TIPOS, CONFIGS)?.id).toBe("c-2ejes");
  });

  it("las mayúsculas y los espacios no rompen el cruce", () => {
    expect(configDelTipo("t-grande", TIPOS, CONFIGS)?.id).toBe("c-3ejes");
    expect(configDelTipo("t-autocar", TIPOS, [{ id: "x", nombre: "  2 Ejes " }])?.id).toBe("x");
  });

  it("un tipo que nombra una configuración inexistente no inventa ninguna", () => {
    expect(configDelTipo("t-raro", TIPOS, CONFIGS)).toBeNull();
  });

  it("sin tipo, o con un tipo que no la declara, no hay configuración", () => {
    expect(configDelTipo("", TIPOS, CONFIGS)).toBeNull();
    expect(configDelTipo("t-mudo", TIPOS, CONFIGS)).toBeNull();
    expect(configDelTipo("t-inexistente", TIPOS, CONFIGS)).toBeNull();
  });
});

describe("avisoDeConfig()", () => {
  it("sin tipo no se dice nada: todavía no hay de qué avisar", () => {
    expect(avisoDeConfig({ tipoVehiculoId: "", configEjesId: "" }, TIPOS, CONFIGS)).toBeNull();
  });

  it("EL CASO QUE SE TRAGABA EN SILENCIO: el tipo nombra una que no existe", () => {
    const aviso = avisoDeConfig({ tipoVehiculoId: "t-raro", configEjesId: "" }, TIPOS, CONFIGS);
    expect(aviso).toContain("5 ejes");
    expect(aviso).toContain("Elígela a mano");
  });

  it("cuando coincide con la del tipo, se dice de dónde salió", () => {
    expect(avisoDeConfig({ tipoVehiculoId: "t-autocar", configEjesId: "c-2ejes" }, TIPOS, CONFIGS))
      .toBe("La que dice el tipo elegido.");
  });

  it("elegir otra distinta es legítimo, pero se ve", () => {
    const aviso = avisoDeConfig(
      { tipoVehiculoId: "t-autocar", configEjesId: "c-3ejes" }, TIPOS, CONFIGS,
    );
    expect(aviso).toContain("Distinta de la del tipo");
    expect(aviso).toContain("2 ejes");
  });

  it("quitarla a mano también se dice, con la del tipo delante", () => {
    const aviso = avisoDeConfig({ tipoVehiculoId: "t-autocar", configEjesId: "" }, TIPOS, CONFIGS);
    expect(aviso).toContain("Sin configuración");
    expect(aviso).toContain("2 ejes");
  });

  it("un tipo que no declara configuración no genera ruido", () => {
    expect(avisoDeConfig({ tipoVehiculoId: "t-mudo", configEjesId: "" }, TIPOS, CONFIGS)).toBeNull();
  });
});
