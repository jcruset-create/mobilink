/**
 * Las reglas de la fecha de una revisión tecleada desde el escritorio.
 *
 * Lo que se fija aquí es qué se deja guardar y qué no. Importa porque la fecha
 * es el dato del que vive el cálculo de desgaste: una fila con la fecha mal
 * puesta no da un error, da una proyección equivocada meses después, cuando ya
 * nadie se acuerda de haberla tecleado.
 */

import { describe, expect, it } from "vitest";

import {
  avisoKmDeOtroDia, diasAtras, diasDeRetraso, esEnPapel, juzgarFecha,
  origenDeLosKm, textoEnPapel,
} from "./revisionEnPapel";

const HOY = "2026-11-13";

describe("qué fechas se dejan guardar", () => {
  it("la de hoy, que es el caso normal", () => {
    expect(juzgarFecha(HOY, HOY)).toEqual({ error: null, aviso: null });
  });

  it("la de hace unos días, que es para lo que se hace esto", () => {
    // El parte real: revisión del 09-11, tecleada el 13.
    expect(juzgarFecha("2026-11-09", HOY)).toEqual({ error: null, aviso: null });
  });

  it("una fecha FUTURA se rechaza", () => {
    // No es un error de dedo que se pueda dejar pasar: sería afirmar que
    // alguien midió un vehículo un día que todavía no ha llegado.
    const j = juzgarFecha("2026-11-14", HOY);
    expect(j.error).toContain("todavía no ha llegado");
    expect(j.aviso).toBeNull();
  });

  it("hace más de un año se rechaza, porque lo normal es que sea el año", () => {
    // Teclear 2025 en vez de 2026 es el error de dedo más probable de todos.
    // Aceptarlo metería una medición falsa sin que nadie se entere.
    const j = juzgarFecha("2025-11-09", HOY);
    expect(j.error).toContain("Comprueba el año");
  });

  it("entre un mes y un año se AVISA, pero se deja guardar", () => {
    // Los partes viejos que aparecen en un cajón existen, y perderlos sería
    // peor que tenerlos con un aviso. La decisión es de quien tiene el papel.
    const j = juzgarFecha("2026-09-01", HOY);
    expect(j.error).toBeNull();
    expect(j.aviso).toContain("73 días");
  });

  it("justo en el límite del aviso no avisa todavía", () => {
    // 30 días exactos: sigue siendo «hace unas semanas».
    expect(juzgarFecha("2026-10-14", HOY).aviso).toBeNull();
    expect(juzgarFecha("2026-10-13", HOY).aviso).toContain("31 días");
  });

  it("sin fecha no se guarda", () => {
    expect(juzgarFecha("", HOY).error).toContain("Falta la fecha");
    expect(juzgarFecha("   ", HOY).error).toContain("Falta la fecha");
  });

  it("una fecha que no existe no se guarda", () => {
    // El 31 de febrero se teclea más de lo que parece.
    expect(juzgarFecha("2026-02-31", HOY).error).toContain("no se entiende");
    expect(juzgarFecha("09-11-2026", HOY).error).toContain("no se entiende");
    expect(juzgarFecha("2026-13-01", HOY).error).toContain("no se entiende");
  });
});

describe("contar los días", () => {
  it("cuenta días de calendario, no de reloj", () => {
    expect(diasAtras("2026-11-09", "2026-11-13")).toBe(4);
    expect(diasAtras("2026-11-13", "2026-11-13")).toBe(0);
  });

  it("el cambio de hora no se come un día", () => {
    // En España el reloj cambia la madrugada del 25 de octubre de 2026. Por
    // milisegundos, ese tramo mide 23 horas y un cálculo con división daría
    // 6,96 días; por calendario son 7.
    expect(diasAtras("2026-10-23", "2026-10-30")).toBe(7);
  });

  it("cruza el fin de año", () => {
    expect(diasAtras("2025-12-30", "2026-01-02")).toBe(3);
  });

  it("una fecha futura da negativo, no un número raro", () => {
    expect(diasAtras("2026-11-14", "2026-11-13")).toBe(-1);
  });

  it("lo que no se entiende da null y no cero", () => {
    // Cero significaría «hoy», que es justo lo contrario de «no se sabe».
    expect(diasAtras("ayer", "2026-11-13")).toBeNull();
    expect(diasAtras("2026-11-09", "")).toBeNull();
  });
});

describe("de dónde se dice que salen los kilómetros", () => {
  it("de la telemática, cuando la revisión es de hoy", () => {
    expect(origenDeLosKm(true, HOY, HOY)).toBe("telematica");
  });

  it("a mano, cuando los ha tecleado una persona", () => {
    expect(origenDeLosKm(false, HOY, HOY)).toBe("manual");
  });

  it("a mano también si la lectura es de hoy y la revisión de otro día", () => {
    // El endpoint contesta el odómetro de AHORA y el histórico de Movertis no
    // trae odómetro: no hay forma de saber cuánto marcaba el día 9. Aplicarle
    // la lectura de hoy puede valer como aproximación, pero llamarla
    // «telematica» sería firmar una precisión que no tiene, y esa palabra ya
    // significa algo en 7.551 revisiones.
    expect(origenDeLosKm(true, "2026-11-09", HOY)).toBe("manual");
  });

  it("y tampoco se llama telemática a una fecha que no se entiende", () => {
    expect(origenDeLosKm(true, "", HOY)).toBe("manual");
  });
});

describe("el aviso de que los km son de otro día", () => {
  it("no se dice cuando la revisión es de hoy", () => {
    // Ese día la lectura SÍ corresponde, así que avisar sería ruido.
    expect(avisoKmDeOtroDia(HOY, HOY)).toBeNull();
  });

  it("se dice cuando la revisión es de días atrás", () => {
    const a = avisoKmDeOtroDia("2026-11-09", HOY);
    expect(a).toContain("hace 4 días");
    expect(a).toContain("a mano");
  });

  it("ayer se dice «ayer», no «hace 1 días»", () => {
    expect(avisoKmDeOtroDia("2026-11-12", HOY)).toContain("de ayer");
  });

  it("una fecha futura o ilegible no genera aviso", () => {
    // La pantalla ya las rechaza; aquí simplemente no se inventa un texto.
    expect(avisoKmDeOtroDia("2026-11-20", HOY)).toBeNull();
    expect(avisoKmDeOtroDia("mañana", HOY)).toBeNull();
  });
});

describe("reconocer una revisión hecha en papel", () => {
  it("la fecha es anterior al día en que se creó la fila", () => {
    const r = { fecha_revision: "2026-11-09", created_at: "2026-11-13T10:22:00+01:00" };
    expect(esEnPapel(r)).toBe(true);
    expect(diasDeRetraso(r)).toBe(4);
    expect(textoEnPapel(r)).toBe("Hecha en papel · tecleada 4 días después");
  });

  it("tecleada el mismo día NO sale marcada", () => {
    // Ese día la fila no afirma nada distinto de una hecha con la tablet, así
    // que no hay nada que advertir.
    const r = { fecha_revision: "2026-11-13", created_at: "2026-11-13T10:22:00+01:00" };
    expect(esEnPapel(r)).toBe(false);
    expect(textoEnPapel(r)).toBeNull();
  });

  it("un día de retraso se dice en singular", () => {
    expect(textoEnPapel({ fecha_revision: "2026-11-12", created_at: "2026-11-13T09:00:00+01:00" }))
      .toBe("Hecha en papel · tecleada al día siguiente");
  });

  it("una creada de madrugada no se marca por la zona horaria", () => {
    // 00:30 del día 13 en Madrid son las 23:30 del 12 en UTC. Comparando en
    // UTC saldría «tecleada 1 día después» sin serlo.
    const r = { fecha_revision: "2026-11-13", created_at: "2026-11-12T23:30:00Z" };
    expect(esEnPapel(r)).toBe(false);
  });

  it("sin los datos para saberlo, no se afirma que lo sea", () => {
    expect(esEnPapel({ fecha_revision: "2026-11-09", created_at: null })).toBe(false);
    expect(esEnPapel({ fecha_revision: null, created_at: "2026-11-13T10:00:00Z" })).toBe(false);
    expect(esEnPapel({})).toBe(false);
    expect(esEnPapel({ fecha_revision: "2026-11-09", created_at: "no es una fecha" })).toBe(false);
  });

  it("una revisión del futuro tampoco cuenta como de papel", () => {
    // No debería existir —la pantalla la rechaza— pero si una entra por otro
    // camino, no se la llama «tecleada después», que sería al revés.
    expect(esEnPapel({ fecha_revision: "2026-11-20", created_at: "2026-11-13T10:00:00+01:00" }))
      .toBe(false);
  });
});
