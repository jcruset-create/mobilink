import { describe, it, expect } from "vitest";
import {
  esAvisoPresion, leerAvisoPresion, camposDelTexto, textoPlano, cuerpoDelCorreo,
  gravedadDeRango, mayorGravedad, fechaDelAviso, decidirAviso, resumenAviso,
  accionRecomendadaBase, type AvisoPresion,
} from "./avisoPresion.ts";

// El correo real, tal cual llega. Es la referencia de todo este fichero: si
// algo de aquí cambia, es que ha cambiado la plantilla de Goodyear.
const AVISO = `Presión está en el rango crítico (debajo 75%)
Soledad // La Plana

Matrícula:              7851JNT
ID de flota:            1015
Rueda:                  Eje 2 - izquierdo exterior
Etiquetas:
Fecha y hora:           19.08.2026 · 22:13:23
Presión recomendada:    8.0 bar
Presión bruta:          5.5 bar (-31.08%)

Ubicación de CheckPoint
Nombre de CheckPoint:   Soledad // La Plana
`;

const ASUNTO = "Presión baja!";

const leer = (texto = AVISO) => {
  const r = leerAvisoPresion(texto);
  if (!r.ok) throw new Error("no se ha podido leer: falta " + r.faltan.join(", "));
  return r.aviso;
};

describe("el correo de ejemplo, entero", () => {
  const a = leer();

  it("la matrícula", () => {
    expect(a.matricula).toBe("7851JNT");
    expect(a.matriculaTexto).toBe("7851JNT");
  });
  it("el ID de flota", () => expect(a.idFlota).toBe("1015"));
  it("la rueda, traducida a nuestro código", () => {
    // "Eje 2 - izquierdo exterior" es masculino y con el lado delante; el
    // informe semanal lo escribe "Exterior izquierda". Misma rueda.
    expect(a.eje).toBe(2);
    expect(a.lado).toBe("izq");
    expect(a.interiorExterior).toBe("ext");
    expect(a.codigoPosicion).toBe("E2_IZQ_EXT");
  });
  it("la presión, con su desviación", () => {
    expect(a.presionBar).toBe(5.5);
    expect(a.presionRecomendadaBar).toBe(8);
    expect(a.desviacionPct).toBe(-31.08);
  });
  it("el rango y su umbral", () => {
    expect(a.rango).toBe("crítico");
    expect(a.umbralPct).toBe(75);
  });
  it("dónde se midió", () => expect(a.checkpoint).toBe("Soledad // La Plana"));

  it("la hora es española, aunque el correo no lo diga", () => {
    // 22:13:23 en Madrid, en agosto, son las 20:13:23 UTC. El servidor corre
    // en UTC: sin esto toda medición entraría dos horas tarde.
    expect(a.medidoAt.toISOString()).toBe("2026-08-19T20:13:23.000Z");
  });

  it("la etiqueta vacía no se come la siguiente", () => {
    // "Etiquetas:" viene vacía y justo debajo está "Fecha y hora:". Si el
    // valor se buscara en la línea siguiente sin mirar qué es, la fecha
    // acabaría siendo el valor de Etiquetas y el aviso se quedaría sin fecha.
    expect(camposDelTexto(AVISO).etiquetas).toBeUndefined();
    expect(camposDelTexto(AVISO).fechaHora).toBe("19.08.2026 · 22:13:23");
  });
});

describe("variantes que hay que aguantar", () => {
  it("coma decimal además de punto", () => {
    const a = leer(AVISO.replace("5.5 bar", "5,5 bar").replace("8.0 bar", "8,0 bar"));
    expect(a.presionBar).toBe(5.5);
    expect(a.presionRecomendadaBar).toBe(8);
  });

  it("presión sin porcentaje", () => {
    const a = leer(AVISO.replace(" (-31.08%)", ""));
    expect(a.presionBar).toBe(5.5);
    expect(a.desviacionPct).toBeNull();
  });

  it("porcentaje en positivo", () => {
    const a = leer(AVISO.replace("(-31.08%)", "(+31.08%)"));
    expect(a.desviacionPct).toBe(31.08);
  });

  it("la fecha en sus variantes", () => {
    expect(fechaDelAviso("19.08.2026 · 22:13:23")!.toISOString()).toBe("2026-08-19T20:13:23.000Z");
    expect(fechaDelAviso("19/08/2026 22:13:23")!.toISOString()).toBe("2026-08-19T20:13:23.000Z");
    expect(fechaDelAviso("19-08-2026 - 22:13")!.toISOString()).toBe("2026-08-19T20:13:00.000Z");
    // En invierno el desfase es de una hora, no de dos.
    expect(fechaDelAviso("19.01.2026 · 22:13:23")!.toISOString()).toBe("2026-01-19T21:13:23.000Z");
    expect(fechaDelAviso("no hay fecha aquí")).toBeNull();
    expect(fechaDelAviso("32.08.2026 · 22:13:23")).toBeNull();
  });

  it("la matrícula con separadores es la misma matrícula", () => {
    const a = leer(AVISO.replace("7851JNT", "7851-JNT"));
    expect(a.matricula).toBe("7851JNT");
    expect(a.matriculaTexto).toBe("7851-JNT");
  });

  it("rueda de eje simple: sin interior ni exterior", () => {
    const a = leer(AVISO.replace("Eje 2 - izquierdo exterior", "Eje 1 - derecho"));
    expect(a.codigoPosicion).toBe("E1_DER");
    expect(a.interiorExterior).toBeNull();
  });
});

describe("el correo maquetado en HTML", () => {
  // Lo mismo, pero como lo manda un gestor de correo: tabla, etiqueta en una
  // celda y valor en la siguiente, y &nbsp; por todas partes.
  const HTML = `<html><body><p>Presi&oacute;n est&aacute; en el rango cr&iacute;tico (debajo 75%)</p>
    <table>
      <tr><td>Matr&iacute;cula:</td><td>7851JNT</td></tr>
      <tr><td>ID de flota:</td><td>1015</td></tr>
      <tr><td>Rueda:</td><td>Eje 2 - izquierdo exterior</td></tr>
      <tr><td>Etiquetas:</td><td>&nbsp;</td></tr>
      <tr><td>Fecha y hora:</td><td>19.08.2026 &middot; 22:13:23</td></tr>
      <tr><td>Presi&oacute;n recomendada:</td><td>8.0 bar</td></tr>
      <tr><td>Presi&oacute;n bruta:</td><td>5.5 bar (-31.08%)</td></tr>
      <tr><td>Nombre de CheckPoint:</td><td>Soledad // La Plana</td></tr>
    </table></body></html>`;

  it("se lee igual que el plano", () => {
    const a = leer(textoPlano(HTML));
    expect(a.matricula).toBe("7851JNT");
    expect(a.codigoPosicion).toBe("E2_IZQ_EXT");
    expect(a.presionBar).toBe(5.5);
    expect(a.medidoAt.toISOString()).toBe("2026-08-19T20:13:23.000Z");
    expect(a.checkpoint).toBe("Soledad // La Plana");
  });

  it("el valor puede caer en la línea siguiente", () => {
    const enFilas = HTML.replace(/<tr><td>Matr&iacute;cula:<\/td><td>7851JNT<\/td><\/tr>/,
      "<tr><td>Matr&iacute;cula:</td></tr><tr><td>7851JNT</td></tr>");
    expect(leer(textoPlano(enFilas)).matricula).toBe("7851JNT");
  });

  it("se prefiere la parte plana cuando el correo trae las dos", () => {
    expect(cuerpoDelCorreo({ text: AVISO, html: "<p>otra cosa</p>" })).toContain("Matrícula:");
    expect(cuerpoDelCorreo({ text: "  ", html: HTML })).toContain("Matrícula:");
  });
});

describe("reconocer el tipo de correo", () => {
  it("el aviso, sí", () => {
    expect(esAvisoPresion(ASUNTO, AVISO)).toBe(true);
    expect(esAvisoPresion("RV: Presión baja!", AVISO)).toBe(true);
  });

  it("el informe semanal del arco, NO", () => {
    // El correo del informe: mismo buzón, mismo remitente, otro asunto y
    // ninguna de las etiquetas de la plantilla.
    const informe = "Adjunto el informe general de la flota de esta semana.\n\nEstado general · Informe general de la flota";
    expect(esAvisoPresion("Estado general · Informe general de la flota", informe)).toBe(false);
    // Y aunque alguien lo reenviara con un asunto confuso, sin plantilla no hay aviso.
    expect(esAvisoPresion("Presión baja! (informe adjunto)", informe)).toBe(false);
  });

  it("la publicidad y lo demás, NO", () => {
    expect(esAvisoPresion("Oferta de neumáticos", "Aproveche nuestras ofertas de presión baja")).toBe(false);
    expect(esAvisoPresion(null, AVISO)).toBe(false);
    expect(esAvisoPresion("", "")).toBe(false);
  });
});

describe("cuando la plantilla cambia, falla entero", () => {
  it("sin matrícula no devuelve NADA, ni siquiera lo que sí leyó", () => {
    const r = leerAvisoPresion(AVISO.replace("Matrícula:              7851JNT", "Vehículo: 7851JNT"));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("debería haber fallado");
    expect(r.faltan).toContain("Matrícula");
    expect(r).not.toHaveProperty("aviso");
  });

  it("dice todo lo que falta, no solo lo primero", () => {
    const r = leerAvisoPresion("Presión baja\nMatrícula: 7851JNT\n");
    if (r.ok) throw new Error("debería haber fallado");
    expect(r.faltan).toEqual(expect.arrayContaining(["Rueda", "Fecha y hora", "Presión bruta"]));
  });

  it("una presión imposible es una plantilla rota, no una presión", () => {
    // Si el analizador coge el número del sitio equivocado, más vale que falle.
    const r = leerAvisoPresion(AVISO.replace("5.5 bar (-31.08%)", "55.0 bar (-31.08%)"));
    if (r.ok) throw new Error("debería haber fallado");
    expect(r.faltan).toContain("Presión bruta");
  });

  it("un eje que no existe tampoco se acepta", () => {
    const r = leerAvisoPresion(AVISO.replace("Eje 2 - izquierdo exterior", "Eje 9 - izquierdo exterior"));
    if (r.ok) throw new Error("debería haber fallado");
    expect(r.faltan).toContain("Rueda");
  });

  it("una rueda sin lado no se coloca a ojo", () => {
    const r = leerAvisoPresion(AVISO.replace("Eje 2 - izquierdo exterior", "Eje 2 - exterior"));
    if (r.ok) throw new Error("debería haber fallado");
    expect(r.faltan).toContain("Rueda");
  });
});

describe("la gravedad la dice el correo", () => {
  it("el rango crítico es el que conocemos", () => {
    expect(gravedadDeRango("crítico")).toEqual({ gravedad: "critica", conocido: true });
    expect(gravedadDeRango("Critico")).toEqual({ gravedad: "critica", conocido: true });
  });

  it("un rango desconocido NO se adivina: la más baja y que se note", () => {
    expect(gravedadDeRango("naranja")).toEqual({ gravedad: "leve", conocido: false });
    expect(gravedadDeRango(null)).toEqual({ gravedad: "leve", conocido: false });

    const r = leerAvisoPresion(AVISO.replace("rango crítico", "rango naranja"));
    if (!r.ok) throw new Error("debería haberse leído");
    expect(r.aviso.rango).toBe("naranja");
    expect(r.notas.join(" ")).toContain("naranja");
  });

  it("de mayor a menor", () => {
    expect(mayorGravedad("leve", "critica")).toBe("critica");
    expect(mayorGravedad("critica", "leve")).toBe("critica");
    expect(mayorGravedad("importante", "leve")).toBe("importante");
  });
});

describe("avisar tarde de una medición vieja se anota", () => {
  it("más de una semana de diferencia con el correo", () => {
    const r = leerAvisoPresion(AVISO, { fechaCorreo: new Date("2026-09-30T10:00:00Z") });
    if (!r.ok) throw new Error("debería haberse leído");
    expect(r.notas.join(" ")).toMatch(/se aparta \d+ días/);
  });
  it("el mismo día, ni una palabra", () => {
    const r = leerAvisoPresion(AVISO, { fechaCorreo: new Date("2026-08-19T20:15:00Z") });
    if (!r.ok) throw new Error("debería haberse leído");
    expect(r.notas).toEqual([]);
  });
});

describe("la deduplicación", () => {
  const a = leer();
  const dia = (n: number): AvisoPresion => ({ ...a, medidoAt: new Date(a.medidoAt.getTime() + n * 86_400_000) });

  it("el primer aviso abre incidencia", () => {
    const d = decidirAviso(null, a, { veces: 1, primero: a.medidoAt });
    expect(d.accion).toBe("crear");
    expect(d.incidenciaId).toBeNull();
    expect(d.gravedad).toBe("critica");
    expect(d.observacion).toContain("19/08/2026");
    expect(d.observacion).toContain("5,5 bar");
  });

  it("el mismo aviso otra vez actualiza el que hay, no crea otro", () => {
    const d = decidirAviso({ id: "inc-1", gravedad: "critica" }, dia(1), { veces: 2, primero: a.medidoAt });
    expect(d.accion).toBe("actualizar");
    expect(d.incidenciaId).toBe("inc-1");
    expect(d.observacion).toContain("repetido 2 veces");
  });

  it("cinco días seguidos: UNA incidencia y constancia de las cinco veces", () => {
    const quinto = { ...dia(4), presionBar: 4.8, desviacionPct: -40 };
    const d = decidirAviso({ id: "inc-1", gravedad: "critica" }, quinto, { veces: 5, primero: a.medidoAt });
    expect(d.accion).toBe("actualizar");
    expect(d.observacion).toContain("repetido 5 veces");
    expect(d.observacion).toContain("entre el 19/08/2026 y el 23/08/2026");
    expect(d.observacion).toContain("4,8 bar");
  });

  it("si la incidencia se solucionó, el aviso de la semana siguiente abre una nueva", () => {
    // Quien busca la incidencia abierta no encuentra ninguna: eso es un null.
    const d = decidirAviso(null, dia(7), { veces: 1, primero: dia(7).medidoAt });
    expect(d.accion).toBe("crear");
  });

  it("la gravedad sube pero no baja", () => {
    const suave = { ...a, rango: "naranja" };
    const d = decidirAviso({ id: "inc-1", gravedad: "critica" }, suave, { veces: 2, primero: a.medidoAt });
    expect(d.gravedadAuto).toBe("leve");   // lo que dice este correo
    expect(d.gravedad).toBe("critica");    // lo que sigue siendo la incidencia

    const peor = decidirAviso({ id: "inc-1", gravedad: "leve" }, a, { veces: 2, primero: a.medidoAt });
    expect(peor.gravedad).toBe("critica");
  });

  it("el resumen se regenera, no se acumula", () => {
    const uno = resumenAviso(a, { veces: 3, primero: a.medidoAt });
    const otro = resumenAviso(a, { veces: 3, primero: a.medidoAt });
    expect(uno).toBe(otro);
    expect(uno).not.toContain("repetido 3 veces. Aviso");
  });
});

describe("la acción recomendada sale sin IA", () => {
  it("con presión recomendada, dice a cuánto inflar", () => {
    const t = accionRecomendadaBase(leer());
    expect(t).toContain("Inflar a 8 bar");
    expect(t).toContain("5,5 bar");
    expect(t).toContain("31,08%");
  });
  it("sin ella, sigue diciendo algo útil", () => {
    const t = accionRecomendadaBase({ ...leer(), presionRecomendadaBar: null });
    expect(t).toContain("Corregir la presión");
    expect(t).toContain("5,5 bar");
  });
});
