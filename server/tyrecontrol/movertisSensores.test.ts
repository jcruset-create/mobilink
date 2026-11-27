import { describe, it, expect } from "vitest";
import {
  interesDe, normalizar, sensoresDe, tieneLectura, textoParaMovertis, veredicto,
} from "./movertisSensores.ts";

describe("interesDe", () => {
  it("reconoce el ralentí en los dos idiomas", () => {
    expect(interesDe("idle_time")).toBe("ralenti");
    expect(interesDe("tiempo_ralenti")).toBe("ralenti");
    expect(interesDe("Ralentí")).toBe("ralenti");
  });

  it("reconoce las horas de motor", () => {
    expect(interesDe("engine_hours")).toBe("horas_motor");
    expect(interesDe("horas_motor")).toBe("horas_motor");
    expect(interesDe("tiempo_en_marcha")).toBe("horas_motor");
    expect(interesDe("operating_time")).toBe("horas_motor");
  });

  it("las horas de motor NO se confunden con el contacto", () => {
    // «engine_hours» lleva «engine» dentro: si se preguntara primero por el
    // contacto, lo mejor que tenemos se clasificaría como lo peor.
    expect(interesDe("engine_hours")).not.toBe("contacto");
  });

  it("reconoce el contacto", () => {
    expect(interesDe("ignition")).toBe("contacto");
    expect(interesDe("contacto")).toBe("contacto");
    expect(interesDe("engine_state")).toBe("contacto");
  });

  it("lo que no sirve, no se marca", () => {
    for (const n of ["odometer", "battery_voltage", "gsm_signal", "temperature_1", "fuel_level"]) {
      expect(interesDe(n)).toBeNull();
    }
  });

  it("normalizar quita tildes y mayúsculas", () => {
    expect(normalizar("Ralentí MOTOR")).toBe("ralenti motor");
  });
});

describe("tieneLectura", () => {
  it("el centinela del aparato no es lectura, lo llame como se llame", () => {
    expect(tieneLectura(-348201.3876, "ODO")).toBe(false);
    expect(tieneLectura(-348201.3876, "RPM")).toBe(false);
  });

  it("un cero en un contador acumulado es «no hay lectura»", () => {
    // La regla del odómetro: un cero de total no existe en algo que rueda.
    expect(tieneLectura(0, "ODO")).toBe(false);
    expect(tieneLectura(0, "HORASTOTALES")).toBe(false);
    expect(tieneLectura(0, "CONSUMIDO")).toBe(false);
  });

  it("un cero en el estado del vehículo SÍ es lectura", () => {
    // Era el fallo que se comió la respuesta real: velocidad 0 es «parado» y
    // RPM 0 es «motor apagado». Tratarlos de ausencia es perder el dato que
    // se venía a buscar.
    expect(tieneLectura(0, "VELOCIDAD")).toBe(true);
    expect(tieneLectura(0, "RPM")).toBe(true);
    expect(tieneLectura(0, "CONTACTO")).toBe(true);
  });

  it("un número normal sí", () => {
    expect(tieneLectura(809052.36, "ODO")).toBe(true);
    expect(tieneLectura(-3, "oCAIRE")).toBe(true);
  });

  it("vacíos y cadenas en blanco, no", () => {
    expect(tieneLectura(null, "BLOQUEO")).toBe(false);
    expect(tieneLectura("   ", "CONDUCTOR")).toBe(false);
  });

  it("un booleano es lectura, aunque sea false: «contacto apagado» es un dato", () => {
    expect(tieneLectura(false, "CONTACTO")).toBe(true);
  });
});

describe("sensoresDe — las tres formas posibles", () => {
  it("objeto de escalares", () => {
    const r = sensoresDe({ sensors: { odometer: 809052.36, ignition: 1 } });
    expect(r.map((s) => s.nombre)).toEqual(["ignition", "odometer"]);
    expect(r[0]).toMatchObject({ valor: 1, conLectura: true, interes: "contacto" });
  });

  it("objeto de objetos con value y unit", () => {
    const r = sensoresDe({ sensors: { engine_hours: { value: 4120.5, unit: "h" } } });
    expect(r[0]).toMatchObject({ nombre: "engine_hours", valor: 4120.5, unidad: "h", interes: "horas_motor" });
  });

  it("lista de objetos con name y value", () => {
    const r = sensoresDe({ sensors: [{ name: "idle_time", value: 93 }, { name: "odometer", value: 12 }] });
    expect(r.map((s) => s.nombre)).toEqual(["idle_time", "odometer"]);
    expect(r[0].interes).toBe("ralenti");
  });

  it("sin sensores, lista vacía y nada de inventar", () => {
    expect(sensoresDe({})).toEqual([]);
    expect(sensoresDe({ sensors: null })).toEqual([]);
    expect(sensoresDe(undefined)).toEqual([]);
  });

  it("primero lo que importa y tiene lectura", () => {
    const r = sensoresDe({
      sensors: { battery: 12.4, HORASTOTALES: 0, ignition: 1, odometer: 809052 },
    });
    // ignition (interesa, con lectura) antes que HORASTOTALES (interesa, pero
    // es un acumulado a 0: sin lectura), y los dos antes que el resto.
    expect(r.map((s) => s.nombre)).toEqual(["ignition", "HORASTOTALES", "battery", "odometer"]);
  });
});

describe("veredicto", () => {
  const de = (sensors: Record<string, unknown>) => veredicto(sensoresDe({ sensors }));

  it("ralentí contado por el aparato: lo mejor", () => {
    expect(de({ idle_time: 93 }).nivel).toBe("ralenti_directo");
  });

  it("horas de motor: se calcula y también hacia atrás", () => {
    const v = de({ engine_hours: 4120.5 });
    expect(v.nivel).toBe("horas_motor");
    expect(v.apoyo).toEqual(["engine_hours"]);
  });

  it("solo contacto: muestreo, y se dice que es peor", () => {
    const v = de({ ignition: 1 });
    expect(v.nivel).toBe("solo_contacto");
    expect(v.texto).toMatch(/aproximado/);
  });

  it("un sensor que existe pero viene vacío NO cuenta como que se puede", () => {
    // Es la trampa: prometer la pantalla y descubrir después que la columna
    // es toda nulos.
    const v = de({ HORASTOTALES: 0, CONTACTO: -348201.3876 });
    expect(v.nivel).toBe("nada");
    expect(v.apoyo).toEqual(["CONTACTO", "HORASTOTALES"]);
    expect(v.texto).toMatch(/sin lectura/);
  });

  it("nada que sirva: se dice que es un no, no un «quizá»", () => {
    const v = de({ odometer: 809052, battery: 12.4 });
    expect(v.nivel).toBe("nada");
    expect(v.texto).toMatch(/no se puede sacar el ralentí/);
  });

  it("sin sensores no se confunde con «no hay»", () => {
    const v = veredicto([]);
    expect(v.nivel).toBe("sin_sensores");
    expect(v.texto).toMatch(/no reconoce/);
  });
});

describe("textoParaMovertis", () => {
  it("lleva la petición, cada sensor y la conclusión", () => {
    const sensores = sensoresDe({ sensors: { engine_hours: 4120.5, odometer: 0 } });
    const t = textoParaMovertis({
      matricula: "1678 GCM",
      unidad: "26134116",
      peticion: { flags: { basicData: true, sensors: true }, id: [26134116] },
      sensores,
      veredicto: veredicto(sensores),
      crudo: '{"sensors":{"engine_hours":4120.5}}',
    });
    expect(t).toContain("1678 GCM");
    expect(t).toContain('"sensors":true');
    expect(t).toContain("engine_hours = 4120.5");
    expect(t).toContain("(sin lectura)");
    expect(t).toContain("Conclusión:");
  });
});

/**
 * La respuesta REAL de la unidad 1807 (7523NNB, Empresa Plana), copiada de la
 * pantalla el 27/11/2026. Es la prueba que de verdad importa: la primera
 * versión del clasificador la habría leído mal.
 *
 * Los que aquí salen a 0 son los que la pantalla enseñó como «sin lectura»
 * con la regla vieja; no sabemos si venían como 0 o como centinela, así que se
 * escriben como 0, que es el caso que se arregla. Los nombres son literales.
 */
const UNIDAD_1807 = {
  CONTACTO: 1,
  BLOQUEO: 0,
  CARGAMOTOR: 0,
  "CºCARGA": 0,
  CONDUCTOR: 0,
  CONSUMIDO: 19267,
  CONSUMOINST: 0.0128164570779,
  DEPOSITO: 100,
  DEPOSITOADBLUE: 90.8,
  DEPOSITOL: 550,
  HORASTOTALES: 2234,
  KM: 78909.16,
  "ºCAIRE": 13.625,
  "ºCMOTOR": -40,
  ODO: 0,
  "PESOEJE 1": 11388,
  "PESOEJE 2": 18405,
  RPM: 499,
  RPMDIGITAL: 4.16333333317,
  TACHOODO: 78909.16,
  TACOGRAFO: 2,
  VELOCIDAD: 0,
  VOLTAJE: 28.105,
};

describe("la respuesta real de la unidad 1807", () => {
  const leidos = sensoresDe({ sensors: UNIDAD_1807 });
  const por = (n: string) => leidos.find((s) => s.nombre === n)!;

  it("HORASTOTALES son las horas de motor — esto es lo que se escapaba", () => {
    // Exigir que el nombre dijera «motor» o «engine» dejaba fuera el nombre
    // que usa la cuenta real, y el veredicto salía peor de lo que es.
    expect(por("HORASTOTALES").interes).toBe("horas_motor");
    expect(por("HORASTOTALES").conLectura).toBe(true);
  });

  it("RPM cuenta como revoluciones, y RPMDIGITAL también", () => {
    expect(por("RPM").interes).toBe("revoluciones");
    expect(por("RPMDIGITAL").interes).toBe("revoluciones");
  });

  it("CONTACTO se reconoce", () => {
    expect(por("CONTACTO")).toMatchObject({ interes: "contacto", valor: 1, conLectura: true });
  });

  it("VELOCIDAD 0 es «parado», no «sin lectura»", () => {
    expect(por("VELOCIDAD").conLectura).toBe(true);
  });

  it("ODO a 0 sigue siendo «sin lectura»: es un acumulado", () => {
    expect(por("ODO").conLectura).toBe(false);
    expect(por("TACHOODO").conLectura).toBe(true);
  });

  it("lo que no sirve para el ralentí no se marca", () => {
    for (const n of ["DEPOSITO", "VOLTAJE", "PESOEJE 1", "TACOGRAFO", "ºCAIRE"]) {
      expect(por(n).interes).toBeNull();
    }
  });

  it("veredicto: se puede, con horas de motor", () => {
    const v = veredicto(leidos);
    expect(v.nivel).toBe("horas_motor");
    expect(v.apoyo).toContain("HORASTOTALES");
    expect(v.apoyo).toContain("RPM");
  });

  it("y el veredicto NO promete el mes pasado", () => {
    // El contador es de ahora, no un histórico: prometerlo hacia atrás sería
    // el mismo engaño que esta pantalla existe para evitar.
    expect(veredicto(leidos).texto).toMatch(/no del mes pasado/);
  });
});
