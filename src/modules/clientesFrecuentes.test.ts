import { describe, expect, it } from "vitest";

import {
  contactoPropuesto,
  detalleDe,
  kMinimoParaBuscar,
  nombreDe,
  normalizar,
  ofrecerAlta,
  telefonoDe,
  tocaBuscar,
  type ClienteFrecuente,
  type ContactoCliente,
} from "./clientesFrecuentes";

const encatrans: ClienteFrecuente = {
  id: 1042,
  name: "Encatrans",
  taxId: "B43214567",
  city: "Tarragona",
  veces: 37,
  erpCode: "A-1042",
  contactos: [
    { id: 1, name: "Anna", phone: "600111222", isPrimary: false },
    { id: 2, name: "Ricart", mobile: "607452612", isPrimary: true },
  ],
};

describe("cuándo se busca", () => {
  it("no se busca con menos de tres letras", () => {
    // Con una o dos, el maestro devuelve medio listado y se tarda más en leer
    // la lista que en escribir el nombre entero.
    expect(tocaBuscar("")).toBe(false);
    expect(tocaBuscar("e")).toBe(false);
    expect(tocaBuscar("en")).toBe(false);
    expect(tocaBuscar("enc")).toBe(true);
    expect(kMinimoParaBuscar).toBe(3);
  });

  it("los espacios no cuentan como letras", () => {
    expect(tocaBuscar("  e  ")).toBe(false);
    expect(tocaBuscar("e n c")).toBe(true);
  });
});

describe("comparar nombres de empresa", () => {
  it("la misma empresa escrita de varias maneras es la misma", () => {
    const formas = ["Encatrans", "ENCATRANS S.L.", "encatrans sl", "Encatrans, S.L."];
    const normalizadas = new Set(formas.map((f) => normalizar(f).replace(/SL$/, "")));
    expect(normalizadas.size).toBe(1);
  });

  it("los acentos no distinguen", () => {
    expect(normalizar("Logística")).toBe(normalizar("Logistica"));
  });

  it("pero dos empresas distintas siguen siendo distintas", () => {
    expect(normalizar("Encatrans")).not.toBe(normalizar("Encatrans Logistica"));
  });
});

describe("qué contacto se propone", () => {
  it("el marcado como principal, aunque no sea el primero", () => {
    expect(contactoPropuesto(encatrans.contactos)?.name).toBe("Ricart");
  });

  it("sin principal, el primero de la lista", () => {
    const sinPrincipal: ContactoCliente[] = [
      { id: 1, name: "Anna" },
      { id: 2, name: "Ricart" },
    ];
    expect(contactoPropuesto(sinPrincipal)?.name).toBe("Anna");
  });

  it("sin contactos, ninguno", () => {
    expect(contactoPropuesto([])).toBeNull();
    expect(contactoPropuesto(null)).toBeNull();
    expect(contactoPropuesto(undefined)).toBeNull();
  });

  it("un contacto sin nombre no se propone", () => {
    // Una fila a medias en la ficha no puede rellenar el formulario con vacío
    // y hacer creer que ya está puesto.
    expect(contactoPropuesto([{ id: 1, name: "" }])).toBeNull();
  });
});

describe("qué teléfono se coge", () => {
  it("el móvil antes que el fijo", () => {
    // A quien pide una asistencia se le llama al móvil; el fijo de centralita
    // a las tres de la madrugada no lo coge nadie.
    expect(telefonoDe({ id: 1, name: "R", phone: "977111222", mobile: "607452612" }))
      .toBe("607452612");
  });

  it("si no hay móvil, el fijo", () => {
    expect(telefonoDe({ id: 1, name: "R", phone: "977111222" })).toBe("977111222");
  });

  it("sin teléfonos, cadena vacía", () => {
    expect(telefonoDe({ id: 1, name: "R" })).toBe("");
    expect(telefonoDe(null)).toBe("");
  });
});

describe("cómo se pinta cada fila", () => {
  it("lleva lo que distingue a dos parecidos", () => {
    const d = detalleDe(encatrans);
    expect(d).toContain("B43214567");
    expect(d).toContain("Tarragona");
    expect(d).toContain("Ricart");
    expect(d).toContain("607452612");
  });

  it("sin contactos cae al teléfono de la ficha", () => {
    const d = detalleDe({ id: 2, name: "Encatrans Logistica", city: "Reus", contactPhone: "977310220" });
    expect(d).toBe("Reus · 977310220");
  });

  it("un cliente pelado no deja una fila con puntos sueltos", () => {
    expect(detalleDe({ id: 3, name: "Solo nombre" })).toBe("");
  });

  it("el apellido va con el nombre", () => {
    expect(nombreDe({ id: 1, name: "Jordi", surname: "Plana" })).toBe("Jordi Plana");
    expect(nombreDe({ id: 1, name: "Jordi" })).toBe("Jordi");
  });
});

describe("cuándo se ofrece dar de alta", () => {
  /*
   * Lo importante: ofrecer el alta de algo que YA está en la lista invita a
   * crear el duplicado que toda esta pantalla viene a evitar.
   */
  it("no se ofrece si ya existe con ese nombre", () => {
    expect(ofrecerAlta("Encatrans", [encatrans])).toBe(false);
  });

  it("tampoco escrito de otra manera", () => {
    expect(ofrecerAlta("ENCATRANS", [encatrans])).toBe(false);
    expect(ofrecerAlta("  encatrans  ", [encatrans])).toBe(false);
  });

  it("sí cuando no hay ninguno", () => {
    expect(ofrecerAlta("Transportes Valles", [])).toBe(true);
  });

  it("sí cuando hay parecidos pero ninguno igual", () => {
    // «Enca» con Encatrans en la lista: puede que quiera crear otra empresa
    // que empieza igual, así que se ofrece.
    expect(ofrecerAlta("Enca", [encatrans])).toBe(true);
  });

  it("no se ofrece con menos de tres letras", () => {
    expect(ofrecerAlta("En", [])).toBe(false);
  });
});
