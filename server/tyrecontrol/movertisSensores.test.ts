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
  it("los dos centinelas de Movertis no son lecturas", () => {
    expect(tieneLectura(-348201.3876)).toBe(false);
    expect(tieneLectura(0)).toBe(false);
  });

  it("un número normal sí", () => {
    expect(tieneLectura(809052.36)).toBe(true);
    expect(tieneLectura(-3)).toBe(true);
  });

  it("vacíos y cadenas en blanco, no", () => {
    expect(tieneLectura(null)).toBe(false);
    expect(tieneLectura("   ")).toBe(false);
  });

  it("un booleano es lectura, aunque sea false: «contacto apagado» es un dato", () => {
    expect(tieneLectura(false)).toBe(true);
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
      sensors: { battery: 12.4, ignition: 0, engine_hours: 4120.5, odometer: 809052 },
    });
    // engine_hours (interesa, con lectura) antes que ignition (interesa, sin
    // lectura) y los dos antes que el resto.
    expect(r.map((s) => s.nombre)).toEqual(["engine_hours", "ignition", "battery", "odometer"]);
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
    const v = de({ engine_hours: 0, ignition: -348201.3876 });
    expect(v.nivel).toBe("nada");
    expect(v.apoyo).toEqual(["engine_hours", "ignition"]);
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
