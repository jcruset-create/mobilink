import { describe, expect, it } from "vitest";
import { empleadosSinFicha, personasDelTaller, tallerDeCentro } from "./personasDeAusencias";

const fichas = [
  { name: "José", workshopId: "sea-tarragona", employeeId: "e-jose" },
  { name: "Ramón", workshopId: "sea-tarragona" },
  { name: "Andrés", workshopId: "sea-reus" },
  { name: "Viejo", activo: false, employeeId: "e-viejo" },
];

const empleados = [
  { id: "e-jose", nombre: "José García", centro: "Taller Tarragona" },
  { id: "e-ramon", nombre: "ramón", centro: null },
  { id: "e-marta", nombre: "Marta Puig", centro: "Oficina Tarragona" },
  { id: "e-laura", nombre: "Laura Vidal", centro: "Mobilink Reus" },
  { id: "e-pere", nombre: "Pere Soler", centro: "Central" },
  { id: "e-andres", nombre: "Andrés Mas", techName: "Andrés" },
  { id: "e-viejo", nombre: "Viejo Pérez" },
  { id: "e-prueba", nombre: "Usuario prueba" },
];

describe("personasDeAusencias", () => {
  it("el taller sale del nombre del centro", () => {
    expect(tallerDeCentro("Mobilink Reus")).toBe("sea-reus");
    expect(tallerDeCentro("Oficina TARRAGONA")).toBe("sea-tarragona");
    expect(tallerDeCentro("Central")).toBeNull();
    expect(tallerDeCentro(null)).toBeNull();
  });

  it("no repite a quien ya está como técnico (vinculado o con el mismo nombre)", () => {
    const nombres = empleadosSinFicha(fichas, empleados).map((e) => e.nombre);
    expect(nombres).not.toContain("José García"); // vinculado por id
    expect(nombres).not.toContain("ramón"); // mismo nombre, sin vincular
    expect(nombres).not.toContain("Andrés Mas"); // vinculado según el servidor
    expect(nombres).not.toContain("Viejo Pérez"); // vinculado a un técnico de baja
    expect(nombres).not.toContain("Usuario prueba");
    expect(nombres).toEqual(["Marta Puig", "Laura Vidal", "Pere Soler"]);
  });

  it("Tarragona: sus técnicos, y detrás sus empleados y los sin taller", () => {
    expect(personasDelTaller(fichas, empleados, "sea-tarragona").map((p) => p.nombre)).toEqual([
      "José",
      "Ramón",
      "Marta Puig",
      "Pere Soler",
    ]);
  });

  it("Reus: los de Reus y los sin taller", () => {
    expect(personasDelTaller(fichas, empleados, "sea-reus").map((p) => p.nombre)).toEqual([
      "Andrés",
      "Laura Vidal",
      "Pere Soler",
    ]);
  });

  it("Todos: todo el mundo, una vez", () => {
    const todos = personasDelTaller(fichas, empleados, "todos");
    expect(todos.map((p) => p.nombre)).toEqual([
      "José",
      "Ramón",
      "Andrés",
      "Marta Puig",
      "Laura Vidal",
      "Pere Soler",
    ]);
    expect(todos.filter((p) => p.esTecnico)).toHaveLength(3);
  });

  it("sin Core (lista vacía) queda exactamente como antes", () => {
    expect(personasDelTaller(fichas, [], "sea-tarragona").map((p) => p.nombre)).toEqual([
      "José",
      "Ramón",
    ]);
  });
});

describe("dados de baja", () => {
  it("por defecto no salen; con incluirBajas, al final y marcados", () => {
    const fichas2 = [
      { name: "José", workshopId: "sea-tarragona" },
      { name: "Viejo", activo: false, workshopId: "sea-tarragona" },
      { name: "Antiguo Reus", activo: false, workshopId: "sea-reus" },
    ];
    expect(personasDelTaller(fichas2, [], "sea-tarragona").map((p) => p.nombre)).toEqual(["José"]);
    const con = personasDelTaller(fichas2, [], "sea-tarragona", { incluirBajas: true });
    expect(con.map((p) => [p.nombre, !!p.deBaja])).toEqual([
      ["José", false],
      ["Viejo", true],
    ]);
    expect(
      personasDelTaller(fichas2, [], "todos", { incluirBajas: true }).filter((p) => p.deBaja)
    ).toHaveLength(2);
  });
});

describe("propuesta del servidor", () => {
  it("el empleado con técnico propuesto no sale duplicado", () => {
    const r = empleadosSinFicha(
      [{ name: "Albert" }],
      [
        { id: "a", nombre: "Albert Belles Bertran", techPropuesto: "Albert" },
        { id: "m", nombre: "Marta Puig" },
      ]
    );
    expect(r.map((e) => e.nombre)).toEqual(["Marta Puig"]);
  });
});
