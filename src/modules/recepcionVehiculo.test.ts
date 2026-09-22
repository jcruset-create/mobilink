import { describe, expect, it } from "vitest";

import {
  normalizarMatricula as normalizarEnServidor,
} from "../../server/tyrecontrol/matricula.ts";
import type { QuickTemplate } from "./workshopTypes";
import {
  KILOMETROS_MAXIMOS,
  kilometrosDeTextoIA,
  kilometrosEscritos,
  eligeVehiculo,
  jobDesdeRecepcion,
  loQueFaltaParaConvertir,
  matriculaComparable,
  matriculaDeTextoIA,
  plantillaParaOperario,
  plantillasParaElPatio,
  diaDeRecepcion,
  horaDeRecepcion,
  recepcionesDelDia,
  citasParaRecibir,
  idsDeCitasYaRecibidas,
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

  it("el teléfono del cliente llega al trabajo", () => {
    const job = jobDesdeRecepcion(
      recepcion({ clienteTelefono: "600 11 22 33" }),
      1,
      plantilla,
      1
    );
    expect(job.customerPhone).toBe("600 11 22 33");
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

describe("citasParaRecibir", () => {
  const base = {
    status: "programado",
    date: "2026-09-19",
    workshopId: "sea-tarragona",
    jobId: null as number | null,
  };

  it("ordena por hora, que es como las busca quien tiene el coche delante", () => {
    const citas = [
      { id: 3, startTime: "11:30", ...base },
      { id: 1, startTime: "09:00", ...base },
      { id: 2, startTime: "09:30", ...base },
    ];
    expect(citasParaRecibir(citas, "2026-09-19", "sea-tarragona").map((c) => c.id)).toEqual([1, 2, 3]);
  });

  /*
   * La de la izquierda es la razón de ser de este filtro: si la cita ya tiene
   * trabajo, el vehículo entró por la otra puerta —el botón «Llegó»— y
   * recibirlo otra vez crearía un segundo trabajo del mismo camión.
   */
  it("deja fuera las que ya tienen trabajo creado", () => {
    const citas = [
      { id: 1, startTime: "09:00", ...base, jobId: 4321 },
      { id: 2, startTime: "09:30", ...base },
    ];
    expect(citasParaRecibir(citas, "2026-09-19").map((c) => c.id)).toEqual([2]);
  });

  it("deja fuera las canceladas y las realizadas", () => {
    const citas = [
      { id: 1, startTime: "09:00", ...base, status: "cancelado" },
      { id: 2, startTime: "09:30", ...base, status: "realizado" },
      { id: 3, startTime: "10:00", ...base },
    ];
    expect(citasParaRecibir(citas, "2026-09-19").map((c) => c.id)).toEqual([3]);
  });

  it("deja fuera las de otro día y las de otro taller", () => {
    const citas = [
      { id: 1, startTime: "09:00", ...base, date: "2026-09-20" },
      { id: 2, startTime: "09:30", ...base, workshopId: "sea-reus" },
      { id: 3, startTime: "10:00", ...base },
    ];
    expect(citasParaRecibir(citas, "2026-09-19", "sea-tarragona").map((c) => c.id)).toEqual([3]);
  });

  /*
   * La ventana entre el patio y la oficina: la cita no se cierra hasta que se
   * valida, y mientras tanto no puede seguir ofreciéndose como «por recibir».
   */
  it("deja fuera las que ya tienen una recepción esperando validación", () => {
    const citas = [
      { id: 1, startTime: "09:00", ...base },
      { id: 2, startTime: "09:30", ...base },
    ];
    const recibidas = idsDeCitasYaRecibidas([
      { estado: "pendiente", scheduledJobId: 1 },
    ]);
    expect(citasParaRecibir(citas, "2026-09-19", null, recibidas).map((c) => c.id)).toEqual([2]);
  });

  it("una recepción ya resuelta no bloquea la cita", () => {
    const recibidas = idsDeCitasYaRecibidas([
      { estado: "convertida", scheduledJobId: 1 },
      { estado: "descartada", scheduledJobId: 2 },
    ]);
    expect(recibidas.size).toBe(0);
  });

  it("una recepción sin cita no bloquea nada", () => {
    const recibidas = idsDeCitasYaRecibidas([
      { estado: "pendiente", scheduledJobId: null },
      { estado: "pendiente" },
    ]);
    expect(recibidas.size).toBe(0);
  });

  it("una cita sin taller vale para cualquiera", () => {
    const citas = [{ id: 1, startTime: "09:00", ...base, workshopId: null }];
    expect(citasParaRecibir(citas, "2026-09-19", "sea-reus")).toHaveLength(1);
  });
});

describe("colocación en la agenda", () => {
  // 19/09/2026 a las 23:57 hora local: la recepción real con la que se probó.
  const tarde = new Date(2026, 8, 19, 23, 57).getTime();
  const manana = new Date(2026, 8, 20, 8, 5).getTime();

  it("saca la hora local, que es la que mira quien está en el taller", () => {
    expect(horaDeRecepcion(tarde)).toBe("23:57");
    expect(horaDeRecepcion(manana)).toBe("08:05");
  });

  /*
   * Una recepción de las 23:57 pertenece a ESE día aunque en UTC ya sea el
   * siguiente. Comparando milisegundos contra un corte en UTC, la del patio de
   * las once y media de la noche aparecería en la agenda de mañana.
   */
  it("el día es el local, no el de UTC", () => {
    expect(diaDeRecepcion(tarde)).toBe("2026-09-19");
    expect(diaDeRecepcion(manana)).toBe("2026-09-20");
  });

  it("solo devuelve las del día que la agenda está pintando", () => {
    const lista = [{ creadaAtMs: tarde }, { creadaAtMs: manana }];
    expect(recepcionesDelDia(lista, "2026-09-19")).toEqual([{ creadaAtMs: tarde }]);
    expect(recepcionesDelDia(lista, "2026-09-20")).toEqual([{ creadaAtMs: manana }]);
    expect(recepcionesDelDia(lista, "2026-09-21")).toEqual([]);
  });
});

describe("plantillasParaElPatio", () => {
  /*
   * El desplegable de operaciones salió vacío en el patio DOS veces, y las dos
   * por lo mismo: la consulta nombraba una columna que el esquema no tiene
   * —`usesQuantity` primero, `workshopId` después— y Postgres tumba la
   * consulta entera, no devuelve null. Por eso esto recibe filas crudas y
   * decide aquí: sin nombrar columnas no hay nada que se pueda caer.
   */
  it("funciona con filas que NO traen workshopId, que es el caso real", () => {
    const filas = [
      { key: "aceite", label: "Cambio de aceite", area: "mecanica" },
      { key: "ruedas", label: "Montaje de ruedas", area: "camion" },
    ];
    expect(plantillasParaElPatio(filas, "sea-tarragona")).toEqual([
      { key: "aceite", label: "Cambio de aceite", area: "mecanica" },
      { key: "ruedas", label: "Montaje de ruedas", area: "camion" },
    ]);
  });

  it("una plantilla sin taller es de todos los talleres", () => {
    const filas = [{ key: "a", label: "A", area: "camion", workshopId: null }];
    expect(plantillasParaElPatio(filas, "sea-reus")).toHaveLength(1);
  });

  it("si la fila trae taller, se respeta", () => {
    const filas = [
      { key: "a", label: "A", area: "camion", workshopId: "sea-tarragona" },
      { key: "b", label: "B", area: "camion", workshopId: "sea-reus" },
    ];
    expect(plantillasParaElPatio(filas, "sea-reus").map((p) => p.key)).toEqual(["b"]);
  });

  it("sin taller pedido se ofrecen todas", () => {
    const filas = [
      { key: "a", label: "A", area: "camion", workshopId: "sea-tarragona" },
      { key: "b", label: "B", area: "camion", workshopId: "sea-reus" },
    ];
    expect(plantillasParaElPatio(filas, null)).toHaveLength(2);
  });

  it("descarta filas inservibles en vez de ofrecer huecos", () => {
    const filas = [
      { key: "", label: "Sin clave", area: "camion" },
      { key: "b", label: "", area: "camion" },
      { key: "c", label: "C", area: "camion" },
    ];
    expect(plantillasParaElPatio(filas).map((p) => p.key)).toEqual(["c"]);
  });

  /*
   * `SELECT *` trae también unitPrice cuando esa columna existe. Que no se
   * cuele hasta la pantalla del técnico.
   */
  it("no deja pasar el precio aunque venga en la fila", () => {
    const filas = [
      { key: "a", label: "A", area: "camion", unitPrice: 62.5, unitMinutes: 45 },
    ];
    const salida = plantillasParaElPatio(filas);
    expect(Object.keys(salida[0]).sort()).toEqual(["area", "key", "label"]);
    expect(JSON.stringify(salida)).not.toContain("62.5");
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

/*
 * Lectura en texto plano, la vía por la que lee Assist.
 *
 * Los casos no son inventados: son las formas en que el modelo contesta
 * cuando no se le obliga a un JSON —a veces la matrícula pelada, a veces
 * envuelta en una frase— y el motivo de cambiar es justo ese, que antes
 * cualquier adorno tiraba la lectura entera.
 */
describe("matriculaDeTextoIA", () => {
  it("acepta la matrícula pelada", () => {
    expect(matriculaDeTextoIA("4610CCV")).toBe("4610CCV");
  });

  it("se come los espacios, los guiones y el salto de línea", () => {
    expect(matriculaDeTextoIA(" 4610 CCV\n")).toBe("4610CCV");
    expect(matriculaDeTextoIA("T-1234-AB")).toBe("T1234AB");
  });

  it("rescata la matrícula aunque el modelo la envuelva en prosa", () => {
    expect(matriculaDeTextoIA("La matrícula es 4610 CCV.")).toBe("4610CCV");
    expect(matriculaDeTextoIA("Se lee T-1234-AB en la placa.")).toBe("T1234AB");
  });

  it("prefiere no leer nada a escribir un churro en el campo", () => {
    // Aplastar el texto entero daba LAMATRICULAESILEGIBLE, y eso se enviaba.
    expect(matriculaDeTextoIA("La matrícula es ilegible")).toBeNull();
  });

  it("acepta una placa extranjera si contesta solo eso", () => {
    expect(matriculaDeTextoIA("AB123CD")).toBe("AB123CD");
  });

  it("devuelve null cuando el modelo dice NONE", () => {
    expect(matriculaDeTextoIA("NONE")).toBeNull();
    expect(matriculaDeTextoIA("  none  ")).toBeNull();
    expect(matriculaDeTextoIA("No se lee ninguna matrícula")).toBeNull();
  });

  it("devuelve null sin respuesta, que es lo que vuelve si la IA falla", () => {
    expect(matriculaDeTextoIA("")).toBeNull();
    expect(matriculaDeTextoIA(null)).toBeNull();
    expect(matriculaDeTextoIA(undefined)).toBeNull();
  });

  it("no da por buena una sílaba suelta", () => {
    expect(matriculaDeTextoIA("AB")).toBeNull();
  });
});

describe("kilometrosDeTextoIA", () => {
  it("acepta el número pelado", () => {
    expect(kilometrosDeTextoIA("123456")).toBe(123456);
  });

  it("entiende los separadores de miles del cuadro", () => {
    expect(kilometrosDeTextoIA("123.456")).toBe(123456);
    expect(kilometrosDeTextoIA("123 456 km")).toBe(123456);
  });

  it("se queda con el odómetro, no con el parcial", () => {
    expect(kilometrosDeTextoIA("123456 km (el parcial marca 321)")).toBe(123456);
  });

  it("devuelve null con NONE, con cero y con un absurdo", () => {
    expect(kilometrosDeTextoIA("NONE")).toBeNull();
    expect(kilometrosDeTextoIA("0")).toBeNull();
    expect(kilometrosDeTextoIA("99999999")).toBeNull();
  });

  it("devuelve null sin respuesta", () => {
    expect(kilometrosDeTextoIA("")).toBeNull();
    expect(kilometrosDeTextoIA(null)).toBeNull();
  });
});
