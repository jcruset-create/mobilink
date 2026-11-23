import { describe, it, expect } from "vitest";
import { heredaCuenta } from "./heredadas.ts";

/**
 * La regla que decide si se le pregunta a Webfleet por la flota de una
 * empresa. Equivocarse aquí no es un error de pantalla: es consultar al
 * proveedor en nombre de un cliente que no es suyo.
 */
describe("heredaCuenta", () => {
  const cliente = {
    tieneCuentaEnHub: false,
    tieneVehiculosEnlazados: true,
    origenCredenciales: "tabla" as const,
  };

  it("el cliente de Webfleet de toda la vida entra sin darlo de alta", () => {
    expect(heredaCuenta(cliente)).toBe(true);
  });

  it("vale cualquier origen de credenciales, también las globales", () => {
    expect(heredaCuenta({ ...cliente, origenCredenciales: "secretos" })).toBe(true);
    expect(heredaCuenta({ ...cliente, origenCredenciales: "globales" })).toBe(true);
  });

  it("el Hub manda: con cuenta dada de alta no se hereda nada", () => {
    // Aunque esté desactivada. Si alguien la dio de alta y la apagó, apagada
    // está: heredarle una por detrás desharía esa decisión en silencio.
    expect(heredaCuenta({ ...cliente, tieneCuentaEnHub: true })).toBe(false);
  });

  it("sin vehículos enlazados NO se hereda, aunque las credenciales resuelvan", () => {
    // Éste es el caso que importa: las credenciales globales resuelven para
    // CUALQUIER empresa. Sin esta condición, una empresa que no ha visto
    // Webfleet en su vida acabaría en el barrido.
    expect(heredaCuenta({ ...cliente, tieneVehiculosEnlazados: false })).toBe(false);
    expect(heredaCuenta({
      tieneCuentaEnHub: false,
      tieneVehiculosEnlazados: false,
      origenCredenciales: "globales",
    })).toBe(false);
  });

  it("sin credenciales no hay a quién preguntar", () => {
    expect(heredaCuenta({ ...cliente, origenCredenciales: "ninguno" })).toBe(false);
  });
});
