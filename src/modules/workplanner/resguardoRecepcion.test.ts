import { describe, expect, it } from "vitest";

import {
  escapa,
  fechaHora,
  htmlDelResguardo,
  kilometrosLegibles,
} from "./resguardoRecepcion";
import type { RecepcionVehiculo } from "../recepcionVehiculo";

function recepcion(extra: Partial<RecepcionVehiculo> = {}): RecepcionVehiculo {
  return {
    id: 42,
    matricula: "9780MKY",
    clienteNombre: "Becsa",
    clienteTelefono: "610473077",
    kilometros: 10558,
    area: "turismo",
    operacionLabel: "Pinchazo Turismo",
    notas: null,
    urgente: false,
    fotos: [],
    estado: "pendiente",
    operarioNombre: "Anthoni",
    creadaAtMs: new Date("2026-09-25T09:44:00").getTime(),
    ...extra,
  } as RecepcionVehiculo;
}

const DATOS = { taller: "Taller Tarragona", ahoraMs: new Date("2026-09-25T10:00:00").getTime() };

describe("escapa", () => {
  /*
   * No es paranoia de manual: las notas las escribe una persona en una tablet
   * del patio. Un `<` suelto parte el documento y de la impresora sale medio
   * resguardo, sin que nada avise.
   */
  it("neutraliza lo que rompería el documento", () => {
    expect(escapa("<script>")).toBe("&lt;script&gt;");
    expect(escapa('Talleres "El Pilar" & hijos')).toBe(
      "Talleres &quot;El Pilar&quot; &amp; hijos"
    );
    expect(escapa("O'Donnell")).toBe("O&#39;Donnell");
  });

  it("convierte la ausencia en cadena vacía, no en «null»", () => {
    expect(escapa(null)).toBe("");
    expect(escapa(undefined)).toBe("");
  });
});

describe("fechaHora", () => {
  it("la dice como se dice aquí", () => {
    expect(fechaHora(new Date("2026-09-25T09:44:00").getTime())).toBe(
      "25/09/2026 09:44"
    );
  });

  it("pone una raya cuando no hay fecha, en vez de «Invalid Date»", () => {
    expect(fechaHora(null)).toBe("—");
    expect(fechaHora(undefined)).toBe("—");
    expect(fechaHora(Number.NaN)).toBe("—");
  });
});

describe("kilometrosLegibles", () => {
  it("pone el punto de los miles", () => {
    expect(kilometrosLegibles(10558)).toBe("10.558");
  });

  it("distingue «no se tomaron» de cero", () => {
    expect(kilometrosLegibles(null)).toBe("—");
    expect(kilometrosLegibles(0)).toBe("0");
  });
});

describe("htmlDelResguardo", () => {
  it("lleva todo lo que hay en la ficha", () => {
    const html = htmlDelResguardo(recepcion(), DATOS);
    for (const dato of [
      "9780MKY",
      "Becsa",
      "610473077",
      "10.558",
      "Pinchazo Turismo",
      "Anthoni",
      "25/09/2026 09:44",
      "Taller Tarragona",
      "Pendiente de validar",
    ]) {
      expect(html).toContain(dato);
    }
  });

  it("se imprime solo cuando han cargado las fotos, no antes", () => {
    // Sin esperar al `load` la hoja sale con los recuadros en blanco.
    expect(htmlDelResguardo(recepcion(), DATOS)).toContain("window.onload");
  });

  it("no deja que una nota rompa el documento", () => {
    const html = htmlDelResguardo(
      recepcion({ notas: "Golpe <derecho> & rueda 'trasera'" }),
      DATOS
    );
    expect(html).toContain("Golpe &lt;derecho&gt; &amp; rueda &#39;trasera&#39;");
    expect(html).not.toContain("<derecho>");
  });

  it("enseña la ausencia como una raya, no como un hueco", () => {
    const html = htmlDelResguardo(
      recepcion({ clienteNombre: null, clienteTelefono: null, kilometros: null }),
      DATOS
    );
    expect(html).toContain("Sin notas.");
    expect(html).toContain("Sin fotos.");
  });

  it("saca el bloque de la orden solo cuando ya hay trabajo", () => {
    expect(htmlDelResguardo(recepcion(), DATOS)).not.toContain("ORDEN DE TRABAJO");

    const convertida = htmlDelResguardo(
      recepcion({
        estado: "convertida",
        jobId: 1142,
        resueltaPor: "Jordi",
        resueltaAtMs: new Date("2026-09-25T09:51:00").getTime(),
      }),
      DATOS
    );
    expect(convertida).toContain("ORDEN DE TRABAJO");
    expect(convertida).toContain("1142");
    expect(convertida).toContain("Jordi");
  });

  it("saca el motivo cuando se descartó", () => {
    const html = htmlDelResguardo(
      recepcion({ estado: "descartada", motivoDescarte: "El cliente se lo llevó" }),
      DATOS
    );
    expect(html).toContain("MOTIVO DEL DESCARTE");
    expect(html).toContain("El cliente se lo llevó");
  });

  /*
   * El texto legal es lo que convierte esta hoja en un resguardo de depósito.
   * Mientras no exista, el papel es interno y lo dice; el bloque no deja hueco.
   */
  it("mientras no haya texto legal, el papel se declara interno", () => {
    const html = htmlDelResguardo(recepcion(), DATOS);
    expect(html).not.toContain("CONDICIONES DE DEPÓSITO");
    expect(html).toContain("Documento interno");
  });

  it("con texto legal aparece el bloque y el pie cambia", () => {
    const html = htmlDelResguardo(recepcion(), {
      ...DATOS,
      textoLegal: "El vehículo queda depositado en el taller.",
    });
    expect(html).toContain("CONDICIONES DE DEPÓSITO");
    expect(html).toContain("El vehículo queda depositado en el taller.");
    expect(html).toContain("Resguardo de depósito");
    expect(html).not.toContain("Documento interno");
  });

  it("un texto legal en blanco no cuenta como texto legal", () => {
    const html = htmlDelResguardo(recepcion(), { ...DATOS, textoLegal: "   " });
    expect(html).not.toContain("CONDICIONES DE DEPÓSITO");
  });

  it("marca la urgencia, que es lo que hace correr a alguien", () => {
    expect(htmlDelResguardo(recepcion({ urgente: true }), DATOS)).toContain("URGENTE");
    expect(htmlDelResguardo(recepcion(), DATOS)).not.toContain("URGENTE");
  });

  it("pinta una foto por cada una que haya", () => {
    const html = htmlDelResguardo(
      recepcion({
        fotos: [
          { url: "https://x/1.jpg", nombre: "matrícula" },
          { url: "https://x/2.jpg" },
        ],
      }),
      DATOS
    );
    expect(html.match(/<img /g) ?? []).toHaveLength(2);
    expect(html).toContain("https://x/2.jpg");
  });

  it("se salta una foto sin url en vez de pintar un roto", () => {
    const html = htmlDelResguardo(
      recepcion({ fotos: [{ url: "" }, { url: "https://x/1.jpg" }] as any }),
      DATOS
    );
    expect(html.match(/<img /g) ?? []).toHaveLength(1);
  });
});
