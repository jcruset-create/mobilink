/**
 * La regla que impide subir un PDF a medio escribir.
 *
 * Lo que se prueba aquí no es que un contador cuente: es que el agente NO se
 * lleve un fichero antes de tiempo. Un PDF truncado es un PDF válido con menos
 * páginas — el servidor lo acepta, el escaneo se archiva en Sent y la factura
 * que faltaba no la echa de menos nadie hasta que la pide la gestoría.
 *
 * Se prueba con reloj de mentira y a propósito: con esperas de verdad, el caso
 * que importa —que el fichero crezca justo en el último segundo— tardaría lo
 * mismo que el fallo y no se probaría nunca.
 */

import { describe, expect, it } from "vitest";
import { Estabilizador } from "../src/estabilidad.ts";

const ESTABILIDAD = 5_000;
const f = (tamano: number, modificadoMs = 1_000) => ({ tamano, modificadoMs });

describe("un fichero que se está escribiendo no se toca", () => {
  it("recién visto nunca es estable, por mucho que pese", () => {
    const e = new Estabilizador(ESTABILIDAD);
    /*
     * El evento del sistema de ficheros llega cuando el fichero EXISTE, no
     * cuando está terminado. La primera observación no puede decidir nada.
     */
    expect(e.observar("a.pdf", f(2_000_000), 0)).toBe("cambiando");
  });

  it("mientras crece, la cuenta vuelve a empezar", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", f(1_000), 0);
    e.observar("a.pdf", f(50_000), 1_000);
    e.observar("a.pdf", f(90_000), 2_000);

    // Han pasado 5 s desde la PRIMERA observación, pero no desde la última.
    expect(e.observar("a.pdf", f(90_000), 5_000)).toBe("cambiando");
  });

  it("crecer en el último momento aplaza la subida", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", f(90_000), 0);
    expect(e.observar("a.pdf", f(90_000), 4_900)).toBe("cambiando");

    // El lote sigue: entra otra página justo antes de cumplirse el plazo.
    expect(e.observar("a.pdf", f(140_000), 4_950)).toBe("cambiando");
    expect(e.observar("a.pdf", f(140_000), 9_000)).toBe("cambiando");
    expect(e.observar("a.pdf", f(140_000), 9_950)).toBe("estable");
  });

  it("quieto el tiempo acordado, se da por terminado", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", f(90_000), 0);
    expect(e.observar("a.pdf", f(90_000), 5_000)).toBe("estable");
  });
});

describe("el mismo tamaño no significa el mismo fichero", () => {
  it("si cambia la fecha de modificación, vuelve a empezar", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", { tamano: 90_000, modificadoMs: 1_000 }, 0);
    /*
     * ScanSnap Home reescribe el PDF al aplicarle su procesado. Puede quedar
     * exactamente del mismo tamaño: mirando solo el tamaño, el agente creería
     * que lleva quieto desde el principio y se lo llevaría a medio reescribir.
     */
    expect(e.observar("a.pdf", { tamano: 90_000, modificadoMs: 4_000 }, 4_000)).toBe("cambiando");
    expect(e.observar("a.pdf", { tamano: 90_000, modificadoMs: 4_000 }, 8_000)).toBe("cambiando");
    expect(e.observar("a.pdf", { tamano: 90_000, modificadoMs: 4_000 }, 9_000)).toBe("estable");
  });
});

describe("cero bytes", () => {
  it("nunca se da por terminado, por mucho que espere", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("roto.pdf", f(0), 0);
    /*
     * Un escaneo que se cortó —papel atascado, USB fuera— deja un fichero de 0
     * bytes que lleva quieto una eternidad. Sin esta regla el agente subiría un
     * documento vacío, que en el módulo aparece como una factura de verdad
     * esperando a que alguien la mire.
     */
    expect(e.observar("roto.pdf", f(0), 60_000)).toBe("vacio");
    expect(e.observar("roto.pdf", f(0), 3_600_000)).toBe("vacio");
  });

  it("y si al final se llena, cuenta desde que se llenó", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", f(0), 0);
    e.observar("a.pdf", f(0), 10_000);

    expect(e.observar("a.pdf", f(90_000), 11_000)).toBe("cambiando");
    // No vale que hayan pasado 5 s desde que apareció: cuentan desde que tiene algo dentro.
    expect(e.observar("a.pdf", f(90_000), 15_000)).toBe("cambiando");
    expect(e.observar("a.pdf", f(90_000), 16_000)).toBe("estable");
  });

  it("un fichero que se vacía deja de estar terminado", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", f(90_000), 0);
    expect(e.observar("a.pdf", f(90_000), 5_000)).toBe("estable");
    expect(e.observar("a.pdf", f(0), 6_000)).toBe("vacio");
  });
});

describe("no se acuerda de todo para siempre", () => {
  it("olvidar quita el fichero de la vigilancia", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", f(90_000), 0);
    expect(e.vigilados).toBe(1);

    e.olvidar("a.pdf");
    expect(e.vigilados).toBe(0);
    /*
     * Importa que además REINICIE la cuenta: si un fichero con el mismo nombre
     * vuelve a aparecer —ScanSnap reutiliza nombres—, no puede heredar la
     * antigüedad del anterior y subirse al primer vistazo.
     */
    expect(e.observar("a.pdf", f(90_000), 1_000)).toBe("cambiando");
  });

  it("olvida de golpe los que ya no están en la carpeta", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", f(90_000), 0);
    e.observar("b.pdf", f(90_000), 0);
    e.observar("c.pdf", f(0), 0);

    /*
     * `olvidar()` cubre el fichero que se encola. Éste cubre el otro camino:
     * el que alguien mueve o borra a mano ANTES de que se dé por terminado, y
     * que si no nadie volvería a nombrar nunca.
     */
    const olvidados = e.olvidarLosQueNoEsten(new Set(["b.pdf"]));

    expect(olvidados).toBe(2);
    expect(e.vigilados).toBe(1);
    expect(e.quietoDesdeMs("a.pdf")).toBeNull();
    expect(e.quietoDesdeMs("b.pdf")).toBe(0);
  });

  it("cada fichero lleva su propia cuenta", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("a.pdf", f(90_000), 0);
    e.observar("b.pdf", f(90_000), 3_000);

    expect(e.observar("a.pdf", f(90_000), 5_000)).toBe("estable");
    expect(e.observar("b.pdf", f(90_000), 5_000)).toBe("cambiando");
    expect(e.vigilados).toBe(2);
  });

  it("se puede saber desde cuándo está quieto, para avisar de los que no avanzan", () => {
    const e = new Estabilizador(ESTABILIDAD);
    e.observar("roto.pdf", f(0), 7_000);
    expect(e.quietoDesdeMs("roto.pdf")).toBe(7_000);
    expect(e.quietoDesdeMs("nunca-visto.pdf")).toBeNull();
  });
});
