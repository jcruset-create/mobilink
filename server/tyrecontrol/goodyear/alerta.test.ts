/**
 * Entender el correo de Goodyear, con los diez avisos reales que se miraron
 * antes de escribir nada.
 *
 * Son del 8 al 10 de noviembre de 2026, de siete vehículos distintos de la
 * flota de Plana. Lo que se fija aquí es sobre todo lo que NO se veía con un
 * solo correo: que hay dos tipos, que el segundo no trae número, que el umbral
 * cambia y que el porcentaje del correo no es el que saldría de dividir.
 */

import { describe, expect, it } from "vitest";

import {
  instanteEnZona, leerAlerta, leerAsunto, leerRueda, textoDelCorreo,
  type AlertaGoodyear, type Lectura,
} from "./alerta.ts";

/** La alerta entendida; si no se entendió, revienta diciendo por qué. */
function alerta(r: Lectura): AlertaGoodyear {
  if ("motivo" in r) throw new Error(`No se entendió el aviso: ${r.motivo}`);
  return r;
}

/** El motivo por el que NO se entendió, o cadena vacía si sí se entendió. */
function motivo(r: Lectura): string {
  return "motivo" in r ? r.motivo : "";
}

/** Un correo de Goodyear, con la forma de tabla que tienen todos. */
function correo(campos: {
  encabezado: string;
  aviso: string;
  matricula: string;
  flota: string;
  rueda: string;
  fecha: string;
  recomendada: string;
  bruta: string;
  checkpoint?: boolean;
}): { asunto: string; html: string } {
  return {
    asunto: `[EXTERNO] ${campos.encabezado} — ${campos.matricula}/${campos.flota} — Soledad // La Plana`,
    html: `
      <table><tr><td><h1>${campos.encabezado}!</h1></td></tr>
      <tr><td>${campos.aviso}</td></tr>
      <tr><td><b>Soledad // La Plana</b></td></tr>
      <tr><td><b>Detalles</b></td></tr>
      <tr><td>Matrícula:</td><td><b>${campos.matricula}</b></td></tr>
      <tr><td>ID de flota:</td><td><b>${campos.flota}</b></td></tr>
      <tr><td>Rueda:</td><td><b>${campos.rueda}</b></td></tr>
      <tr><td>Etiquetas:</td><td></td></tr>
      <tr><td>Fecha y hora:</td><td><b>${campos.fecha}</b></td></tr>
      <tr><td>Presión recomendada:</td><td><b>${campos.recomendada}</b></td></tr>
      <tr><td>Presión bruta:</td><td><b>${campos.bruta}</b></td></tr>
      </table>
      ${campos.checkpoint ? "<h3>Ubicación de CheckPoint</h3>" : ""}`,
  };
}

const CRITICO = (pct: number) => `Presión está en el rango crítico (debajo ${pct}%)`;

/** El aviso número 1 de los diez: el que empezó todo esto. */
const BAJA = correo({
  encabezado: "Presión baja", aviso: CRITICO(75),
  matricula: "1467HJS", flota: "854", rueda: "Eje 2 - derecho interior",
  fecha: "10.11.2026 · 22:30:54", recomendada: "8.0 bar", bruta: "4.0 bar (-49.65%)",
});

/** El número 6: otro tipo, y sin lectura de presión. */
const DESINFLADO = correo({
  encabezado: "Neumático desinflado", aviso: "La presión de los neumáticos es muy baja.",
  matricula: "4452MSG", flota: "1708", rueda: "Eje 2 - derecho interior",
  fecha: "10.11.2026 · 09:04:49", recomendada: "8.0 bar", bruta: "!!!",
});

describe("de qué tipo es el aviso", () => {
  it("presión baja", () => {
    const r = leerAlerta(BAJA);
    expect(alerta(r).tipo).toBe("presion_baja");
  });

  it("neumático desinflado, que menciona la presión y NO es «presión baja»", () => {
    // Su texto dice «La presión de los neumáticos es muy baja», así que mirar
    // «presión baja» primero lo clasificaría mal. Es más grave, no menos.
    const r = leerAlerta(DESINFLADO);
    expect(alerta(r).tipo).toBe("desinflado");
  });

  it("lo que no se reconoce se dice, no se adivina", () => {
    const r = leerAlerta({ asunto: "[EXTERNO] Novedades de Goodyear", html: "<p>Boletín</p>" });
    expect(motivo(r)).not.toBe("");
    expect(motivo(r)).toContain("tipo de aviso");
  });
});

describe("el desinflado no trae número, y eso no es un cero", () => {
  it("«!!!» es ausencia de lectura", () => {
    // Guardar 0,0 bar diría que se midió cero. Lo que pasa es que el sensor no
    // da una lectura fiable, que es otra cosa y se enseña distinta.
    const r = leerAlerta(DESINFLADO);
    const a = alerta(r);
    expect(a.presionBar).toBeNull();
    expect(a.desviacionPct).toBeNull();
    // La recomendada sí viene, y sirve para saber cuánto hay que inflar.
    expect(a.presionRecomendadaBar).toBe(8);
  });

  it("y tampoco trae umbral", () => {
    const r = leerAlerta(DESINFLADO);
    expect(alerta(r).umbralPct).toBeNull();
  });
});

describe("el porcentaje se copia, no se calcula", () => {
  it("se guarda el del correo aunque no cuadre con los bares", () => {
    // 4,0 sobre 8,0 serían −50 %, y el correo dice −49,65 %: los bares vienen
    // redondeados a un decimal y el porcentaje sale de los valores crudos.
    // Calcularlo nosotros daría un número distinto del que ve el cliente.
    const r = leerAlerta(BAJA);
    expect(alerta(r).desviacionPct).toBe(-49.65);
    expect(alerta(r).presionBar).toBe(4);
  });

  it("los diez avisos reales, tal cual los dice el correo", () => {
    const reales: Array<[string, string, number | null, number | null]> = [
      ["1467HJS", "4.0 bar (-49.65%)", 4.0, -49.65],
      ["5015HKC", "4.4 bar (-45.19%)", 4.4, -45.19],
      ["4568JXB", "2.0 bar (-18.76%)", 2.0, -18.76],
      ["6439LJS", "5.7 bar (-29.21%)", 5.7, -29.21],
      ["7436KVK", "5.0 bar (-37.76%)", 5.0, -37.76],
      ["4568JXB", "1.9 bar (-22.44%)", 1.9, -22.44],
      ["5015HKC", "4.3 bar (-45.91%)", 4.3, -45.91],
      ["7436KVK", "5.2 bar (-35.15%)", 5.2, -35.15],
      ["2343JDD", "5.5 bar (-30.85%)", 5.5, -30.85],
      ["4452MSG", "!!!", null, null],
    ];
    for (const [matricula, bruta, bar, pct] of reales) {
      const r = leerAlerta(correo({
        encabezado: bruta === "!!!" ? "Neumático desinflado" : "Presión baja",
        aviso: bruta === "!!!" ? "La presión de los neumáticos es muy baja." : CRITICO(75),
        matricula, flota: "1", rueda: "Eje 2 - derecho interior",
        fecha: "10.11.2026 · 12:00:00", recomendada: "8.0 bar", bruta,
      }));
            const a = alerta(r);
      expect(a.presionBar, matricula).toBe(bar);
      expect(a.desviacionPct, matricula).toBe(pct);
    }
  });
});

describe("el umbral no es constante", () => {
  it("se lee el que diga el correo", () => {
    expect(alerta(leerAlerta(BAJA)).umbralPct).toBe(75);
    const ochenta = correo({
      encabezado: "Presión baja", aviso: CRITICO(80),
      matricula: "4568JXB", flota: "2004", rueda: "Eje 2 - izquierdo exterior",
      fecha: "10.11.2026 · 15:13:39", recomendada: "2.5 bar", bruta: "2.0 bar (-18.76%)",
    });
    const r = leerAlerta(ochenta);
    expect(alerta(r).umbralPct).toBe(80);
    // Y la recomendada es por vehículo: 2,5 bar es una furgoneta, no un autobús.
    expect(alerta(r).presionRecomendadaBar).toBe(2.5);
  });
});

describe("la rueda", () => {
  it("las tres piezas, de las formas que se han visto", () => {
    expect(leerRueda("Eje 2 - derecho interior")).toEqual({ eje: 2, lado: "der", interiorExterior: "int" });
    expect(leerRueda("Eje 2 - izquierdo exterior")).toEqual({ eje: 2, lado: "izq", interiorExterior: "ext" });
    expect(leerRueda("Eje 3 - derecho interior")).toEqual({ eje: 3, lado: "der", interiorExterior: "int" });
  });

  it("un eje sin interior/exterior se lee igual", () => {
    // El eje 1 de un autobús es de rueda simple y el correo lo dice así.
    expect(leerRueda("Eje 1 - izquierdo")).toEqual({ eje: 1, lado: "izq", interiorExterior: null });
  });

  it("sin lado no hay rueda que valga", () => {
    expect(leerRueda("Eje 2")).toBeNull();
    expect(leerRueda("")).toBeNull();
    expect(leerRueda(null)).toBeNull();
  });

  it("un aviso con la rueda ilegible se aparta", () => {
    const malo = correo({
      encabezado: "Presión baja", aviso: CRITICO(75), matricula: "1467HJS", flota: "854",
      rueda: "Rueda de repuesto", fecha: "10.11.2026 · 22:30:54",
      recomendada: "8.0 bar", bruta: "4.0 bar (-49.65%)",
    });
    const r = leerAlerta(malo);
    expect(motivo(r)).not.toBe("");
    expect(motivo(r)).toContain("rueda");
  });
});

describe("el asunto contrasta el cuerpo", () => {
  it("saca matrícula e ID de flota", () => {
    expect(leerAsunto("[EXTERNO] Presión baja — 1467HJS/854 — Soledad // La Plana"))
      .toEqual({ matricula: "1467HJS", idFlota: "854" });
  });

  it("si asunto y cuerpo no dicen lo mismo, no se procesa", () => {
    // Pasaría si Goodyear cambiara la plantilla y el rótulo se desalineara.
    // Procesarlo sería avisar sobre el vehículo equivocado.
    const cruzado = { ...BAJA, asunto: "[EXTERNO] Presión baja — 9999ZZZ/854 — Soledad // La Plana" };
    const r = leerAlerta(cruzado);
    expect(motivo(r)).not.toBe("");
    expect(motivo(r)).toContain("9999ZZZ");
  });

  it("vale un asunto sin ID de flota", () => {
    expect(leerAsunto("[EXTERNO] Presión baja — 1467HJS — Soledad")).toEqual({
      matricula: "1467HJS", idFlota: null,
    });
  });
});

describe("la fecha", () => {
  it("se interpreta en hora peninsular, no en UTC", () => {
    // El 10 de noviembre España va en UTC+1: las 22:30:54 de pared son las
    // 21:30:54 UTC. Guardarlo como UTC correría la alerta una hora.
    const r = leerAlerta(BAJA);
    const a = alerta(r);
    expect(a.medidoAt.toISOString()).toBe("2026-11-10T21:30:54.000Z");
  });

  it("en verano el desfase es otro, y sale solo", () => {
    // 15 de julio: UTC+2. Hacerlo a mano con «+1» se equivoca medio año.
    expect(instanteEnZona(2026, 7, 15, 12, 0, 0).toISOString()).toBe("2026-07-15T10:00:00.000Z");
    expect(instanteEnZona(2026, 1, 15, 12, 0, 0).toISOString()).toBe("2026-01-15T11:00:00.000Z");
  });

  it("sin fecha legible se aparta", () => {
    const malo = correo({
      encabezado: "Presión baja", aviso: CRITICO(75), matricula: "1467HJS", flota: "854",
      rueda: "Eje 2 - derecho interior", fecha: "ayer por la tarde",
      recomendada: "8.0 bar", bruta: "4.0 bar (-49.65%)",
    });
    const r = leerAlerta(malo);
    expect(motivo(r)).not.toBe("");
    expect(motivo(r)).toContain("fecha");
  });
});

describe("lo demás del aviso", () => {
  it("la flota de Goodyear se guarda, pero NO es la empresa del SaaS", () => {
    const r = leerAlerta(BAJA);
    expect(alerta(r).flota).toBe("Soledad // La Plana");
  });

  it("se nota si trae la ubicación del CheckPoint", () => {
    const con = correo({
      encabezado: "Presión baja", aviso: CRITICO(75), matricula: "7436KVK", flota: "1129",
      rueda: "Eje 3 - derecho interior", fecha: "10.11.2026 · 13:45:17",
      recomendada: "8.0 bar", bruta: "5.0 bar (-37.76%)", checkpoint: true,
    });
    expect(alerta(leerAlerta(con)).tieneUbicacionCheckpoint).toBe(true);
    expect(alerta(leerAlerta(BAJA)).tieneUbicacionCheckpoint).toBe(false);
  });

  it("el ID de flota viaja para poder contrastarlo con la ficha", () => {
    const r = leerAlerta(BAJA);
    expect(alerta(r).idFlota).toBe("854");
  });
});

describe("el aplanado del HTML", () => {
  it("separa rótulo y valor aunque vivan en celdas distintas", () => {
    const t = textoDelCorreo("<tr><td>Matrícula:</td><td><b>1467HJS</b></td></tr>");
    expect(t).toContain("Matrícula:");
    expect(t).toContain("1467HJS");
  });

  it("si no hay HTML se usa el texto plano", () => {
    expect(textoDelCorreo(null, "Matrícula: 1467HJS")).toBe("Matrícula: 1467HJS");
  });

  it("un correo vacío se aparta en vez de reventar", () => {
    const r = leerAlerta({ asunto: "Presión baja", html: "", texto: "" });
    expect(motivo(r)).not.toBe("");
    expect(motivo(r)).toContain("cuerpo");
  });
});

/**
 * Los dos fallos que se vieron en producción con los primeros 55 correos.
 *
 * De esos 55, 23 se apartaron sin casar: el registro de `tc_goodyear_avisos`
 * dijo exactamente por qué, que es para lo que está. Aquí quedan fijados los
 * dos motivos para que no vuelvan.
 */
describe("lo que falló con los primeros 55 correos reales", () => {
  it("un campo VACÍO no se come el rótulo siguiente", () => {
    // El fallo tal cual: en los avisos de profundidad «ID de flota» viene
    // vacío, y el parser devolvía «Rueda:» —el rótulo de al lado— como si
    // fuera el número de unidad. Luego no casaba contra la ficha y el aviso
    // se apartaba. El dato estaba bien; leerlo era lo que estaba mal.
    const conHueco = {
      asunto: "[EXTERNO] Presión baja — 1467HJS/854 — Soledad // La Plana",
      html: `<table>
        <tr><td><h1>Presión baja!</h1></td></tr>
        <tr><td>${CRITICO(75)}</td></tr>
        <tr><td>Matrícula:</td><td><b>1467HJS</b></td></tr>
        <tr><td>ID de flota:</td><td></td></tr>
        <tr><td>Rueda:</td><td><b>Eje 2 - derecho interior</b></td></tr>
        <tr><td>Fecha y hora:</td><td><b>10.11.2026 · 22:30:54</b></td></tr>
        <tr><td>Presión recomendada:</td><td><b>8.0 bar</b></td></tr>
        <tr><td>Presión bruta:</td><td><b>4.0 bar (-49.65%)</b></td></tr>
      </table>`,
    };
    const a = alerta(leerAlerta(conHueco));
    // Del cuerpo no sale nada, así que se queda el del asunto. Lo que NO
    // puede pasar es que salga «Rueda:».
    expect(a.idFlota).toBe("854");
    // Y la rueda se lee bien, que es lo que el rótulo robado tapaba.
    expect(a.eje).toBe(2);
    expect(a.lado).toBe("der");
  });

  it("«Etiquetas:» vacío, que es el caso de siempre, tampoco", () => {
    // Está vacío en los diez avisos reales. Si se comiera el rótulo
    // siguiente, la fecha se leería mal en todos.
    const a = alerta(leerAlerta(BAJA));
    expect(a.medidoAt.toISOString()).toBe("2026-11-10T21:30:54.000Z");
  });

  it("un aviso de PROFUNDIDAD no se cuela como si fuera de presión", () => {
    // Siete de los 55 eran de profundidad de dibujo y el parser los tipaba
    // como «desinflado», porque su cuerpo también habla de neumáticos.
    // Habrían acabado en tc_alertas_presion diciendo una presión que nadie
    // ha medido.
    const profundidad = {
      asunto: "Alertas de profundidad del dibujo - mantenimiento — 9228MJP — Soledad // La Plana",
      html: `<h1>Alertas de profundidad del dibujo</h1>
        <p>La profundidad del dibujo del neumático está por debajo del umbral.</p>
        <tr><td>Matrícula:</td><td><b>9228MJP</b></td></tr>
        <tr><td>Rueda:</td><td><b>Eje 1 - izquierdo exterior</b></td></tr>`,
    };
    expect(motivo(leerAlerta(profundidad))).toContain("profundidad de dibujo");
    expect(motivo(leerAlerta(profundidad))).toContain("no de presión");
  });

  it("y el de «límite legal» tampoco, que es el mismo caso", () => {
    const limite = {
      asunto: "Alerta de profundidad de dibujo - límite legal — 1949JJR — Soledad // La Plana",
      html: "<h1>Alerta de profundidad de dibujo</h1><p>Límite legal.</p>",
    };
    expect(motivo(leerAlerta(limite))).toContain("profundidad de dibujo");
  });

  it("los de presión siguen entrando igual que antes", () => {
    // La red de seguridad del arreglo: al apartar los de profundidad no se
    // puede haber apartado de paso ninguno de los que sí valen.
    expect(alerta(leerAlerta(BAJA)).tipo).toBe("presion_baja");
    expect(alerta(leerAlerta(DESINFLADO)).tipo).toBe("desinflado");
  });
});
