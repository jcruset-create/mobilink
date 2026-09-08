import { describe, expect, it } from "vitest";
import { normalizarNombre, proponerVinculos, type EmpleadoCore } from "./vinculoTecnicos.ts";

const emp = (id: string, nombre: string, apellidos: string | null = null): EmpleadoCore => ({
  id,
  nombre,
  apellidos,
});

describe("normalizarNombre", () => {
  it("iguala tildes, mayúsculas y espacios", () => {
    expect(normalizarNombre("José")).toBe("jose");
    expect(normalizarNombre("  IVÁN  ")).toBe("ivan");
    expect(normalizarNombre("Andrés")).toBe("andres");
  });

  it("la ñ cuenta como n", () => {
    // "Muñoz" tecleado en un sitio y "Munoz" en otro son la misma persona.
    expect(normalizarNombre("Muñoz")).toBe(normalizarNombre("Munoz"));
  });

  it("los signos se convierten en separadores", () => {
    expect(normalizarNombre("Pérez-Gómez")).toBe("perez gomez");
  });

  it("un nombre vacío o basura da cadena vacía", () => {
    expect(normalizarNombre(null)).toBe("");
    expect(normalizarNombre("   ")).toBe("");
    expect(normalizarNombre("---")).toBe("");
  });
});

describe("proponerVinculos", () => {
  const plantilla = [
    emp("e1", "José", "García"),
    emp("e2", "Iván", "López"),
    emp("e3", "Ramón", "Sanz"),
  ];

  it("empareja por nombre de pila cuando solo hay uno", () => {
    // Es el caso normal del taller: los técnicos se apuntan por el nombre.
    const [p] = proponerVinculos(["Iván"], plantilla);
    expect(p).toMatchObject({ employeeId: "e2", certeza: "unica" });
  });

  it("empareja por nombre completo aunque cambien tildes y mayúsculas", () => {
    const [p] = proponerVinculos(["jose garcia"], plantilla);
    expect(p).toMatchObject({ employeeId: "e1", certeza: "exacta" });
  });

  it("NO propone nada si dos personas comparten el nombre de pila", () => {
    // Este es el caso que justifica todo el helper: adivinar aquí significa
    // atribuirle a alguien el trabajo de otro.
    const conDosJose = [...plantilla, emp("e4", "José", "Martín")];
    const [p] = proponerVinculos(["José"], conDosJose);
    expect(p.employeeId).toBeNull();
    expect(p.certeza).toBe("ambigua");
    expect(p.candidatos.map((c) => c.id).sort()).toEqual(["e1", "e4"]);
  });

  it("el nombre completo desempata cuando el de pila es ambiguo", () => {
    const conDosJose = [...plantilla, emp("e4", "José", "Martín")];
    const [p] = proponerVinculos(["José Martín"], conDosJose);
    expect(p).toMatchObject({ employeeId: "e4", certeza: "exacta" });
  });

  it("marca los que no encajan con nadie", () => {
    const [p] = proponerVinculos(["Fulanito"], plantilla);
    expect(p).toMatchObject({
      employeeId: null,
      certeza: "sin_candidato",
      candidatos: [],
    });
  });

  it("devuelve una propuesta por técnico, en el mismo orden", () => {
    const r = proponerVinculos(["Iván", "Fulanito", "José García"], plantilla);
    expect(r.map((p) => p.tech)).toEqual(["Iván", "Fulanito", "José García"]);
    expect(r.map((p) => p.certeza)).toEqual(["unica", "sin_candidato", "exacta"]);
  });

  it("aguanta empleados sin apellidos y nombres vacíos", () => {
    // Sin apellidos, el nombre completo ES el de pila: la coincidencia sale
    // como "exacta", que es la señal más fuerte de las dos.
    const r = proponerVinculos(["", "Ramón"], [emp("e5", "Ramón", null)]);
    expect(r[0].certeza).toBe("sin_candidato");
    expect(r[1]).toMatchObject({ employeeId: "e5", certeza: "exacta" });
  });

  it("sin plantilla no propone nada", () => {
    expect(proponerVinculos(["José"], [])[0].certeza).toBe("sin_candidato");
  });
});
