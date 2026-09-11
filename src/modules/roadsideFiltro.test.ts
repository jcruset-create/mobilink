import { describe, expect, it } from "vitest";

import { coincide, filtrar, finDelDia, hayCriterios, inicioDelDia, normalizar } from "./roadsideFiltro";

const dia = (aaaammdd: string, h = 12) => {
  const [a, m, d] = aaaammdd.split("-").map(Number);
  return new Date(a, m - 1, d, h, 0, 0, 0).getTime();
};

describe("normalizar", () => {
  it("quita los separadores que la gente mete en las matrículas", () => {
    expect(normalizar("3719 LKK")).toBe("3719LKK");
    expect(normalizar("3719-LKK")).toBe("3719LKK");
    expect(normalizar("3719.LKK")).toBe("3719LKK");
    expect(normalizar(" 3719/lkk ")).toBe("3719LKK");
  });

  it("quita los acentos, que en los nombres de cliente los hay", () => {
    expect(normalizar("Logística Pérez")).toBe("LOGISTICAPEREZ");
    // La Ñ pierde la virgulilla y se queda en N. Es lo que se quiere: quien
    // teclea «Munoz» a toda prisa encuentra «Muñoz», y como se normalizan los
    // dos lados de la comparación, la búsqueda sigue cuadrando.
    expect(normalizar("Transportes Muñoz")).toBe("TRANSPORTESMUNOZ");
  });

  it("y por eso «munoz» encuentra «Muñoz»", () => {
    expect(normalizar("munoz")).toBe(normalizar("Muñoz"));
  });
});

describe("coincide · matrícula y cliente", () => {
  const item = {
    plate: "3719LKK",
    plateRemolque: "R7657BDM",
    customerName: "Autocares Plana",
    createdAtMs: dia("2026-09-07"),
  };

  it("encuentra por matrícula del camión", () => {
    expect(coincide(item, { matricula: "3719LKK" })).toBe(true);
    expect(coincide(item, { matricula: "3719" })).toBe(true);
  });

  it("encuentra aunque se escriba con espacios o guiones", () => {
    // El operario la copia del albarán, donde va separada.
    expect(coincide(item, { matricula: "3719 LKK" })).toBe(true);
    expect(coincide(item, { matricula: "3719-lkk" })).toBe(true);
  });

  it("encuentra por matrícula del REMOLQUE", () => {
    // En una asistencia al remolque puede ser la única matrícula que hay.
    expect(coincide(item, { matricula: "R7657BDM" })).toBe(true);
    expect(coincide(item, { matricula: "7657" })).toBe(true);
  });

  it("encuentra por cliente, sin importar mayúsculas ni acentos", () => {
    expect(coincide(item, { cliente: "plana" })).toBe(true);
    expect(coincide(item, { cliente: "AUTOCARES" })).toBe(true);
    expect(coincide({ ...item, customerName: "Logística Pérez" }, { cliente: "logistica perez" })).toBe(true);
  });

  it("cada campo busca en LO SUYO y no en el otro", () => {
    // Es lo que se gana separándolos: el nombre del cliente no puede colarse
    // como matrícula ni al revés.
    expect(coincide(item, { matricula: "Autocares" })).toBe(false);
    expect(coincide(item, { cliente: "3719LKK" })).toBe(false);
  });

  it("los dos a la vez ACOTAN, no amplían", () => {
    expect(coincide(item, { matricula: "3719", cliente: "Plana" })).toBe(true);
    // La matrícula es de esta asistencia, el cliente no: no vale.
    expect(coincide(item, { matricula: "3719", cliente: "Transmaber" })).toBe(false);
    expect(coincide(item, { matricula: "9999XXX", cliente: "Plana" })).toBe(false);
  });

  it("no encuentra lo que no está", () => {
    expect(coincide(item, { matricula: "9999XXX" })).toBe(false);
    expect(coincide(item, { cliente: "Transmaber" })).toBe(false);
  });

  it("los campos vacíos no rompen la búsqueda", () => {
    expect(coincide({ plate: null, plateRemolque: null, customerName: null, createdAtMs: 1 }, { matricula: "x" })).toBe(false);
    expect(coincide({}, { cliente: "x" })).toBe(false);
  });
});

describe("coincide · fechas", () => {
  const item = { plate: "3719LKK", createdAtMs: dia("2026-09-07") };

  it("el día exacto entra por los dos extremos", () => {
    // Con «hasta» comparado contra el inicio del día, esto fallaría: es el
    // error clásico de los rangos de fechas.
    expect(coincide(item, { desde: "2026-09-07", hasta: "2026-09-07" })).toBe(true);
  });

  it("una asistencia de última hora del día «hasta» sigue entrando", () => {
    const tarde = { plate: "X", createdAtMs: dia("2026-09-07", 23) };
    expect(coincide(tarde, { hasta: "2026-09-07" })).toBe(true);
  });

  it("fuera del rango, fuera", () => {
    expect(coincide(item, { desde: "2026-09-08" })).toBe(false);
    expect(coincide(item, { hasta: "2026-09-06" })).toBe(false);
  });

  it("una fecha a medio escribir no esconde el listado", () => {
    // Mientras se teclea «2026-0» el input manda basura; si eso filtrara, la
    // pantalla se vaciaría delante de quien está escribiendo.
    expect(coincide(item, { desde: "2026-0" })).toBe(true);
    expect(coincide(item, { hasta: "no es una fecha" })).toBe(true);
  });

  it("sin fecha de alta no se cuela en un rango", () => {
    expect(coincide({ plate: "X", createdAtMs: null }, { desde: "2026-09-01" })).toBe(false);
  });
});

describe("filtrar", () => {
  const lista = [
    { plate: "3719LKK", customerName: "La ponderosa", createdAtMs: dia("2026-09-07") },
    { plate: "8693HDC", customerName: "Autocares Plana", createdAtMs: dia("2026-09-08") },
    { plate: "", plateRemolque: "R5547BCR", customerName: "Truck Service", createdAtMs: dia("2026-09-09") },
  ];

  it("sin criterios devuelve la lista tal cual, sin copiarla", () => {
    expect(filtrar(lista, {})).toBe(lista);
    expect(filtrar(lista, { matricula: "   ", cliente: "  " })).toBe(lista);
  });

  it("combina los tres criterios", () => {
    expect(filtrar(lista, { cliente: "truck" }).map((i) => i.plate)).toEqual([""]);
    expect(filtrar(lista, { matricula: "R5547" }).map((i) => i.customerName)).toEqual(["Truck Service"]);
    expect(filtrar(lista, { desde: "2026-09-08" }).length).toBe(2);
    expect(filtrar(lista, { desde: "2026-09-08", hasta: "2026-09-08" }).map((i) => i.plate)).toEqual(["8693HDC"]);
    // Cliente y fecha a la vez: «truck» está en la del 09, no en las otras.
    expect(filtrar(lista, { cliente: "truck", desde: "2026-09-09" }).length).toBe(1);
    expect(filtrar(lista, { cliente: "truck", hasta: "2026-09-08" }).length).toBe(0);
  });
});

describe("hayCriterios", () => {
  it("distingue vacío de espacios de contenido", () => {
    expect(hayCriterios({})).toBe(false);
    expect(hayCriterios({ matricula: "  ", cliente: "  " })).toBe(false);
    expect(hayCriterios({ matricula: "a" })).toBe(true);
    expect(hayCriterios({ cliente: "a" })).toBe(true);
    expect(hayCriterios({ desde: "2026-09-01" })).toBe(true);
  });
});

describe("límites del día", () => {
  it("el fin del día es el último milisegundo, no el siguiente", () => {
    const i = inicioDelDia("2026-09-07")!;
    const f = finDelDia("2026-09-07")!;
    expect(f - i).toBe(24 * 60 * 60 * 1000 - 1);
    expect(new Date(f).getDate()).toBe(7);
  });

  it("una fecha inválida no se inventa un instante", () => {
    expect(inicioDelDia("2026-9-7")).toBeNull();
    expect(inicioDelDia("")).toBeNull();
    expect(finDelDia("ayer")).toBeNull();
  });
});
