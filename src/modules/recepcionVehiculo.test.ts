import { describe, expect, it } from "vitest";

import {
  normalizarMatricula as normalizarEnServidor,
} from "../../server/tyrecontrol/matricula.ts";
import type { QuickTemplate } from "./workshopTypes";
import {
  CONFIANZA_OCR_MINIMA,
  KILOMETROS_MAXIMOS,
  kilometrosEscritos,
  kilometrosPropuestosPorOcr,
  eligeVehiculo,
  jobDesdeRecepcion,
  loQueFaltaParaConvertir,
  matriculaComparable,
  matriculaPropuestaPorOcr,
  plantillaParaOperario,
  posibleDuplicado,
  type RecepcionVehiculo,
} from "./recepcionVehiculo";

function recepcion(extra: Partial<RecepcionVehiculo> = {}): RecepcionVehiculo {
  return {
    id: 1,
    workshopId: "sea-tarragona",
    matricula: "1234-ABC",
    urgente: false,
    fotos: [],
    estado: "pendiente",
    operarioNombre: "Andrés",
    creadaAtMs: 1_700_000_000_000,
    area: "mecanica",
    plantillaKey: "cambio-aceite",
    ...extra,
  };
}

describe("matriculaComparable", () => {
  it("iguala las tres formas de escribir la misma matrícula", () => {
    expect(matriculaComparable("1234-ABC")).toBe("1234ABC");
    expect(matriculaComparable("1234 abc")).toBe("1234ABC");
    expect(matriculaComparable("1234ABC")).toBe("1234ABC");
  });

  it("aguanta null y basura sin reventar", () => {
    expect(matriculaComparable(null)).toBe("");
    expect(matriculaComparable(undefined)).toBe("");
    expect(matriculaComparable(42)).toBe("42");
  });

  /*
   * El servidor tiene su propia copia de esta regla porque los dos árboles se
   * compilan por separado. Si alguien toca una y no la otra, un vehículo se
   * encuentra por una vía y no por otra, en silencio. Esto lo impide.
   */
  it("da exactamente lo mismo que la del servidor", () => {
    const casos = ["1234-ABC", "1234 abc", "b 1234 xy", "", "  ", "ñ1234!", "0000AAA"];
    for (const caso of casos) {
      expect(matriculaComparable(caso)).toBe(normalizarEnServidor(caso));
    }
  });
});

describe("matriculaPropuestaPorOcr", () => {
  it("acepta una lectura clara", () => {
    expect(matriculaPropuestaPorOcr({ matricula: "1234-abc", confianza: 0.9 })).toBe("1234ABC");
  });

  it("rechaza la lectura dudosa: que la escriba la persona", () => {
    expect(matriculaPropuestaPorOcr({ matricula: "1234ABC", confianza: 0.5 })).toBeNull();
  });

  it("el umbral es el documentado, no uno cualquiera", () => {
    expect(matriculaPropuestaPorOcr({ matricula: "1234ABC", confianza: CONFIANZA_OCR_MINIMA })).toBe("1234ABC");
    expect(
      matriculaPropuestaPorOcr({ matricula: "1234ABC", confianza: CONFIANZA_OCR_MINIMA - 0.01 })
    ).toBeNull();
  });

  it("rechaza lo demasiado corto aunque la IA esté segurísima", () => {
    expect(matriculaPropuestaPorOcr({ matricula: "AB1", confianza: 1 })).toBeNull();
  });

  it("rechaza lo que no es una lectura", () => {
    expect(matriculaPropuestaPorOcr(null)).toBeNull();
    expect(matriculaPropuestaPorOcr({})).toBeNull();
    expect(matriculaPropuestaPorOcr({ matricula: null, confianza: "alta" })).toBeNull();
  });
});

describe("kilometrosPropuestosPorOcr", () => {
  it("lee el cuadro con los separadores que trae", () => {
    expect(kilometrosPropuestosPorOcr({ kilometros: "123.456", confianza: 0.9 })).toBe(123456);
    expect(kilometrosPropuestosPorOcr({ kilometros: "123 456", confianza: 0.9 })).toBe(123456);
    expect(kilometrosPropuestosPorOcr({ kilometros: 98765, confianza: 0.8 })).toBe(98765);
  });

  it("un camión puede pasar del millón", () => {
    expect(kilometrosPropuestosPorOcr({ kilometros: "1250000", confianza: 0.9 })).toBe(1250000);
  });

  /*
   * El OCR se come un dígito o se inventa otro con toda naturalidad, y un
   * kilometraje absurdo metido sin mirar contamina el histórico del vehículo.
   */
  it("descarta lo que ningún vehículo ha recorrido", () => {
    expect(kilometrosPropuestosPorOcr({ kilometros: "99999999", confianza: 1 })).toBeNull();
    expect(kilometrosPropuestosPorOcr({ kilometros: KILOMETROS_MAXIMOS + 1, confianza: 1 })).toBeNull();
    expect(kilometrosPropuestosPorOcr({ kilometros: KILOMETROS_MAXIMOS, confianza: 1 })).toBe(KILOMETROS_MAXIMOS);
  });

  it("el cero es una lectura fallida, no un vehículo nuevo", () => {
    expect(kilometrosPropuestosPorOcr({ kilometros: "0", confianza: 1 })).toBeNull();
  });

  it("rechaza la lectura dudosa: que lo escriba la persona", () => {
    expect(kilometrosPropuestosPorOcr({ kilometros: "123456", confianza: 0.5 })).toBeNull();
    expect(
      kilometrosPropuestosPorOcr({ kilometros: "123456", confianza: CONFIANZA_OCR_MINIMA })
    ).toBe(123456);
  });

  it("rechaza lo que no es una lectura", () => {
    expect(kilometrosPropuestosPorOcr(null)).toBeNull();
    expect(kilometrosPropuestosPorOcr({})).toBeNull();
    expect(kilometrosPropuestosPorOcr({ kilometros: "no se ve", confianza: 1 })).toBeNull();
  });
});

describe("kilometrosEscritos", () => {
  it("lo que teclea la persona pasa por el mismo filtro", () => {
    expect(kilometrosEscritos("123.456")).toBe(123456);
    expect(kilometrosEscritos("")).toBeNull();
    expect(kilometrosEscritos("0")).toBeNull();
    expect(kilometrosEscritos(KILOMETROS_MAXIMOS + 1)).toBeNull();
  });
});

describe("eligeVehiculo", () => {
  const candidatos = [
    { id: "tc-9", matricula: "1 2 3 4 A B C", clienteNombre: "Transportes Sur", origen: "tyrecontrol" as const },
    { id: "rs-3", matricula: "1234-ABC", clienteNombre: "Flota propia", origen: "roadside" as const },
    { id: "tc-7", matricula: "9999ZZZ", origen: "tyrecontrol" as const },
  ];

  it("descarta lo que el patrón de comodines coló de más", () => {
    expect(eligeVehiculo(candidatos, "9999ZZZ")?.id).toBe("tc-7");
  });

  it("si está en los dos sitios gana la flota propia", () => {
    expect(eligeVehiculo(candidatos, "1234 abc")?.id).toBe("rs-3");
  });

  it("devuelve null cuando no hay coincidencia real", () => {
    expect(eligeVehiculo(candidatos, "0000XYZ")).toBeNull();
    expect(eligeVehiculo(candidatos, "")).toBeNull();
    expect(eligeVehiculo([], "1234ABC")).toBeNull();
  });
});

describe("posibleDuplicado", () => {
  const ahora = 1_700_000_000_000;

  it("avisa de la misma matrícula recibida hoy y sin resolver", () => {
    const previa = recepcion({ id: 5, creadaAtMs: ahora - 60_000 });
    expect(posibleDuplicado([previa], "1234 ABC", ahora)?.id).toBe(5);
  });

  it("no avisa si la anterior ya se convirtió", () => {
    const previa = recepcion({ id: 5, estado: "convertida", creadaAtMs: ahora - 60_000 });
    expect(posibleDuplicado([previa], "1234ABC", ahora)).toBeNull();
  });

  it("no avisa si fue hace días: un camión puede entrar dos veces", () => {
    const previa = recepcion({ id: 5, creadaAtMs: ahora - 3 * 24 * 60 * 60 * 1000 });
    expect(posibleDuplicado([previa], "1234ABC", ahora)).toBeNull();
  });
});

describe("loQueFaltaParaConvertir", () => {
  it("no falta nada en una recepción completa", () => {
    expect(loQueFaltaParaConvertir(recepcion())).toEqual([]);
  });

  it("enumera lo que tiene que decidir la persona", () => {
    const falta = loQueFaltaParaConvertir(
      recepcion({ matricula: "  ", area: null, plantillaKey: null, operacionLabel: null })
    );
    expect(falta).toEqual(["la matrícula", "el área", "la operación"]);
  });

  it("una operación escrita a mano vale aunque no haya plantilla", () => {
    expect(
      loQueFaltaParaConvertir(recepcion({ plantillaKey: null, operacionLabel: "Revisar fuga" }))
    ).toEqual([]);
  });
});

describe("jobDesdeRecepcion", () => {
  const plantilla: QuickTemplate = {
    key: "cambio-aceite",
    label: "Cambio de aceite",
    area: "mecanica",
    mode: "single",
    allowedTechs: [],
    priorityOrder: [],
    standardMinutes: 45,
    unitMinutes: 45,
    unitPrice: 62.5,
  };

  it("nace en validacion, nunca en activo ni en espera", () => {
    const job = jobDesdeRecepcion(recepcion(), 77, plantilla, 1_700_000_100_000);
    expect(job.status).toBe("validacion");
    expect(job.assignedNames).toEqual([]);
  });

  it("la matrícula va como la confirmó la persona, en mayúsculas", () => {
    const job = jobDesdeRecepcion(recepcion({ matricula: " 1234-abc " }), 1, plantilla, 1);
    expect(job.plate).toBe("1234-ABC");
  });

  it("la hora de entrada es la de la recepción, no la de convertirla", () => {
    const r = recepcion({ creadaAtMs: 1_700_000_000_000 });
    const job = jobDesdeRecepcion(r, 1, plantilla, 1_700_000_999_000);
    expect(job.ptEntradaMs).toBe(1_700_000_000_000);
    expect(job.createdAtMs).toBe(1_700_000_999_000);
  });

  it("el motivo dice quién recibió el vehículo y lo que anotó", () => {
    const job = jobDesdeRecepcion(recepcion({ notas: "Pierde aceite." }), 1, plantilla, 1);
    expect(job.reason).toBe("Recepción en patio (Andrés). Pierde aceite.");
  });

  it("el kilometraje viaja con el trabajo, no solo en la ficha", () => {
    const job = jobDesdeRecepcion(
      recepcion({ kilometros: 123456, notas: "Pierde aceite." }),
      1,
      plantilla,
      1
    );
    expect(job.reason).toContain("123.456 km.");
  });

  it("sin kilometraje el motivo no deja un hueco raro", () => {
    const job = jobDesdeRecepcion(recepcion({ kilometros: null }), 1, plantilla, 1);
    expect(job.reason).toBe("Recepción en patio (Andrés).");
  });

  it("sin plantilla sigue saliendo un trabajo usable", () => {
    const job = jobDesdeRecepcion(
      recepcion({ plantillaKey: null, operacionLabel: "Revisar fuga", area: "camion" }),
      1,
      null,
      1
    );
    expect(job.area).toBe("camion");
    expect(job.quickEntryLabel).toBe("Revisar fuga");
    expect(job.unitMinutes).toBeNull();
  });
});

describe("plantillaParaOperario", () => {
  /*
   * El encargo es explícito: la APK del técnico no enseña precios, tarifas,
   * importes, márgenes ni facturación. Esto es lo único que separa el
   * `unitPrice` del catálogo de la pantalla del patio.
   */
  it("no deja pasar el precio a la APK", () => {
    const plantilla: QuickTemplate = {
      key: "cambio-aceite",
      label: "Cambio de aceite",
      area: "mecanica",
      mode: "single",
      allowedTechs: [],
      priorityOrder: [],
      standardMinutes: 45,
      unitMinutes: 45,
      unitPrice: 62.5,
    };
    const salida = plantillaParaOperario(plantilla);
    expect(Object.keys(salida).sort()).toEqual(["area", "key", "label"]);
    expect(JSON.stringify(salida)).not.toContain("62.5");
  });
});
