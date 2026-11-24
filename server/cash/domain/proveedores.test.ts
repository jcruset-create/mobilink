import { describe, expect, it } from "vitest";
import { nifDeProveedor, nombreDeProveedorNormalizado, proveedorDeFila } from "./proveedores.ts";

describe("el nombre de un proveedor escrito a mano", () => {
  it("sin mayúsculas, tildes, puntuación ni forma jurídica", () => {
    const repsol = nombreDeProveedorNormalizado("Repsol");
    expect(nombreDeProveedorNormalizado("REPSOL, S.A.")).toBe(repsol);
    expect(nombreDeProveedorNormalizado("repsol sa")).toBe(repsol);
    expect(nombreDeProveedorNormalizado("Ferretería Martí S.L.U.")).toBe("ferreteria marti");
    expect(nombreDeProveedorNormalizado("Ferreteria Marti, SL")).toBe("ferreteria marti");
    expect(nombreDeProveedorNormalizado("Germans Puig C.B.")).toBe("germans puig");
  });

  it("la forma jurídica solo se quita del final, y nunca deja el nombre vacío", () => {
    // «sa» en medio es parte del nombre, no una sociedad anónima.
    expect(nombreDeProveedorNormalizado("Sa Riera Talleres")).toBe("sa riera talleres");
    expect(nombreDeProveedorNormalizado("S.A.")).toBe("s a");
  });

  it("lo que no une, no lo une: otro nombre es otro proveedor", () => {
    expect(nombreDeProveedorNormalizado("Gasolinera Repsol Valls")).not.toBe(nombreDeProveedorNormalizado("Repsol"));
  });

  it("vacío o solo signos = sin nombre", () => {
    expect(nombreDeProveedorNormalizado("")).toBe("");
    expect(nombreDeProveedorNormalizado("  -- ")).toBe("");
    expect(nombreDeProveedorNormalizado(null)).toBe("");
  });
});

describe("el NIF de un proveedor", () => {
  it("con o sin puntuación, y con o sin el ES del NIF-IVA, es el mismo", () => {
    expect(nifDeProveedor("B-43.044.379")).toBe("B43044379");
    expect(nifDeProveedor("b43044379")).toBe("B43044379");
    expect(nifDeProveedor("ESB43044379")).toBe("B43044379");
    expect(nifDeProveedor("ES B-43044379")).toBe("B43044379");
  });

  it("lo que no llega a NIF no cuenta", () => {
    expect(nifDeProveedor("")).toBeNull();
    expect(nifDeProveedor("12")).toBeNull();
    expect(nifDeProveedor(null)).toBeNull();
  });
});

describe("la clave del proveedor de un gasto", () => {
  it("manda el código de la ERP, aunque el nombre escrito diga otra cosa", () => {
    expect(proveedorDeFila({ erpCodigo: "400123", nif: null, nombre: "otro nombre" })).toEqual({
      clave: "ERP:400123",
      via: "ERP",
      identificador: "400123",
    });
  });

  it("sin código, el NIF del ticket; sin NIF, el nombre", () => {
    expect(proveedorDeFila({ erpCodigo: null, nif: "B-43.044.379", nombre: "Bar Central" })?.clave).toBe(
      "NIF:B43044379"
    );
    expect(proveedorDeFila({ erpCodigo: "", nif: null, nombre: "Correos" })).toEqual({
      clave: "NOMBRE:correos",
      via: "NOMBRE",
      identificador: null,
    });
  });

  it("sin nada por donde reconocerlo, no hay proveedor", () => {
    expect(proveedorDeFila({ erpCodigo: "  ", nif: "", nombre: "" })).toBeNull();
  });
});
