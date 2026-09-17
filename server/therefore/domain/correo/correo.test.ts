/**
 * El parser de correo, contra las formas que aparecen de verdad.
 *
 * ── Los valores son INVENTADOS, las formas no ───────────────────────────────
 *
 * Todo lo que se lee aquí —proveedores, facturas, albaranes, importes,
 * personas, dominios— está fabricado. Lo que se conserva del corpus real es la
 * ESTRUCTURA: dónde va cada campo, con qué puntuación, qué variantes de la
 * misma instrucción se escriben, y cómo se pega un importe a un albarán.
 *
 * No es prudencia de más. Este repositorio es público y un correo de incidencia
 * lleva el nombre del proveedor, el número de su factura y lo que se le compró;
 * el lote real se queda en local (ver `fixtures/README.md`). Y, sobre todo: un
 * parser afinado contra los veinte correos que había un martes acierta el
 * 100 % de esos veinte. Probarlo con valores distintos a los de calibración es
 * lo único que demuestra que lee la forma y no se ha aprendido los datos.
 */

import { describe, expect, it } from "vitest";
import {
  clasificar,
  leerBloque,
  leerCampos,
  leerEmpresa,
  leerFecha,
  leerImporte,
  leerLineaDeAlbaran,
  parsearCorreo,
  recortarBloqueLibre,
} from "./index.ts";

/* ── Plantillas ──────────────────────────────────────────────────────────── */

const PIE =
  "Este es un mensaje enviado automáticamente. Por favor no responda a este correo. " +
  "Si tiene cualquier consulta envíe un correo a: incidencias@ejemplo.invalid\n\nUn saludo.\n";

const EMPRESA = "031 Comercial Ejemplo_New";
const ASUNTO_INCIDENCIA = `Incidencia en factura recibida. Empresa ${EMPRESA}`;
const ASUNTO_APROBACION = "Aprobación de Factura recibida. 031-Comercial Ejemplo_New";
const ASUNTO_VENCIDA = `Tarea vencida. ${ASUNTO_APROBACION}`;

function incidencia(
  bloque: string,
  campos: Partial<Record<string, string>> = {}
): string {
  const c = {
    proveedor: "77",
    razon: "NEUMATICOS EJEMPLO, S.L.",
    cuenta: "4040000077",
    factura: "0000555111",
    fecha: "31/08/2026",
    importe: "1.234,56",
    ...campos,
  };
  return (
    `Por favor procese la incidencia de la factura recibida. Empresa ${EMPRESA}:\n\n` +
    `Información Adicional:\n${bloque}\n` +
    `Código Proveedor: ${c.proveedor}.\nRazón Social: ${c.razon}.\n` +
    `Cuenta Contable: ${c.cuenta}.\nNúmero Factura: ${c.factura}.\n` +
    `Fecha Factura:${c.fecha}.\nImporte: ${c.importe}.\n\n` +
    PIE
  );
}

const URL_FLUJO = "https://therefore.ejemplo.invalid/TWA/tdwv/#/workflows/instance/9998887/1";

function aprobacion(vencida: boolean): string {
  return (
    "Por favor apruebe la factura recibida:\n\n" +
    "Código Proveedor: 100999.\nRazón Social: SERVICIOS EJEMPLO, S.L.U..\n" +
    "Cuenta Contable: 4100000999.\nNúmero Factura: 0000007777.\n" +
    "Fecha Factura:01/08/2026.\nImporte: 321,45.\n\n" +
    `Haga clic en el siguiente enlace para acceder al documento y procesarlo:\n${URL_FLUJO}\n` +
    (vencida ? "\nHan pasado 7 días desde que recibio la primera notificación.\n" : "") +
    "\nUn saludo.\n"
  );
}

/* ── Importes ────────────────────────────────────────────────────────────── */

describe("leer importes", () => {
  /*
   * El total de la factura lo escribe la plantilla a la española y el importe
   * del albarán lo escribe una persona a la inglesa. Los dos en el mismo
   * correo, y el mismo carácter significando cosas distintas.
   */
  it("la coma decimal de la plantilla y el punto decimal de la persona", () => {
    expect(leerImporte("1.234,56").centimos).toBe(123456);
    expect(leerImporte("-45,63").centimos).toBe(-4563);
    expect(leerImporte("35.811,93").centimos).toBe(3581193);
    expect(leerImporte("199.95e").centimos).toBe(19995);
    expect(leerImporte("2020.50€").centimos).toBe(202050);
    expect(leerImporte("-31.94e").centimos).toBe(-3194);
  });

  /*
   * `2020.50 * 100` da 202049.99999999997 en coma flotante. Todo el cálculo va
   * sobre las cadenas de dígitos, así que esto no es una casualidad afortunada.
   */
  it("no pierde un céntimo por el camino", () => {
    for (const [raw, esperado] of [
      ["1010.07", 101007],
      ["2020.50", 202050],
      ["0.07", 7],
      ["8039.94", 803994],
      ["70.29", 7029],
    ] as const) {
      expect(leerImporte(raw).centimos, `falla con ${raw}`).toBe(esperado);
    }
  });

  it("con los dos separadores manda el último, venga de donde venga", () => {
    expect(leerImporte("1.234,56").centimos).toBe(123456);
    expect(leerImporte("1,234.56").centimos).toBe(123456);
  });

  it("varios separadores iguales sólo pueden ser millares", () => {
    expect(leerImporte("1.234.567").centimos).toBe(123456700);
  });

  /*
   * El caso que no se puede resolver: `1.234` es mil doscientos treinta y
   * cuatro o uno coma doscientos treinta y cuatro. Se aplica la convención
   * española y se BAJA la confianza, que es lo que hace que el expediente pida
   * revisión. Elegir en silencio es como se cuela un error de tres ceros.
   */
  it("tres dígitos detrás de un separador solo son ambiguos, y se dice", () => {
    const r = leerImporte("1.234");
    expect(r.centimos).toBe(123400);
    expect(r.confianza).toBeLessThan(0.5);
    expect(r.motivo).toMatch(/ambiguo/i);
  });

  it("lo que no es un número sale sin valor, no a cero", () => {
    for (const basura of ["", "   ", "pendiente", "—", null, undefined, 42]) {
      expect(leerImporte(basura as unknown).centimos).toBeNull();
    }
  });

  it("un importe sin decimales son euros enteros", () => {
    expect(leerImporte("500").centimos).toBe(50000);
    expect(leerImporte("500€").centimos).toBe(50000);
  });
});

describe("el signo detrás del número", () => {
  it("«192,80-» es negativo: lo escriben así los ERP alemanes", () => {
    expect(leerImporte("192,80-").centimos).toBe(-19280);
    expect(leerImporte("1.390,30-").centimos).toBe(-139030);
    // Y no se confunde con un guion de relleno ni cambia lo de siempre.
    expect(leerImporte("-192,80").centimos).toBe(-19280);
    expect(leerImporte("192,80").centimos).toBe(19280);
  });
});

describe("leer fechas", () => {
  it("la fecha de la plantilla se pasa a ISO", () => {
    expect(leerFecha("31/08/2026")).toBe("2026-08-31");
    expect(leerFecha("1/9/2026")).toBe("2026-09-01");
    expect(leerFecha("2026-08-31")).toBe("2026-08-31");
    // Con puntos, que es como la escriben los ERP alemanes.
    expect(leerFecha("15.09.2026")).toBe("2026-09-15");
  });

  /*
   * Un 31 de febrero que pasara de largo acabaría en la base como 3 de marzo, y
   * la antigüedad del expediente —de la que sale la prioridad— se contaría
   * desde un día que nadie escribió.
   */
  it("una fecha que no existe es null, no el día siguiente", () => {
    expect(leerFecha("31/02/2026")).toBeNull();
    expect(leerFecha("00/08/2026")).toBeNull();
    expect(leerFecha("15/13/2026")).toBeNull();
    expect(leerFecha("ayer")).toBeNull();
  });
});

/* ── La plantilla ────────────────────────────────────────────────────────── */

describe("clasificar el correo", () => {
  it("distingue incidencia, aprobación y tarea vencida", () => {
    expect(clasificar(ASUNTO_INCIDENCIA, incidencia("Grabar\n123456\n")).tipo).toBe(
      "INCIDENCIA_ALBARAN"
    );

    const ap = clasificar(ASUNTO_APROBACION, aprobacion(false));
    expect(ap.tipo).toBe("APROBACION_FACTURA");
    expect(ap.tareaVencida).toBe(false);

    const tv = clasificar(ASUNTO_VENCIDA, aprobacion(true));
    expect(tv.tipo).toBe("APROBACION_FACTURA");
    expect(tv.tareaVencida).toBe(true);
  });

  /*
   * La tarea vencida es una APROBACIÓN que se retrasa, no un tipo aparte. El
   * tipo dice de qué va el trabajo y la marca dice que va con retraso: son dos
   * ejes, y mezclarlos obligaría a elegir entre saber una cosa o la otra.
   */
  it("una tarea vencida sigue siendo del tipo del trabajo que pide", () => {
    expect(clasificar(ASUNTO_VENCIDA, aprobacion(true)).tipo).toBe("APROBACION_FACTURA");
  });

  it("lo que no se sabe qué es sale como OTRO, no forzado", () => {
    expect(clasificar("Re: comida del viernes", "¿a las dos?").tipo).toBe("OTRO");
  });
});

describe("la sociedad del ERP", () => {
  /*
   * Viene de dos maneras según el tipo de correo. No se fija una lista de
   * sociedades: una instalación con tres tiene que funcionar sin tocar código.
   */
  it("se lee con «Empresa 031 Nombre» y con «031-Nombre»", () => {
    expect(leerEmpresa(ASUNTO_INCIDENCIA, "")).toEqual({
      codigo: "031",
      nombre: "Comercial Ejemplo_New",
    });
    expect(leerEmpresa(ASUNTO_APROBACION, "")).toEqual({
      codigo: "031",
      nombre: "Comercial Ejemplo_New",
    });
    expect(leerEmpresa(ASUNTO_VENCIDA, "")).toEqual({
      codigo: "031",
      nombre: "Comercial Ejemplo_New",
    });
  });

  it("si no está en el asunto se busca en el cuerpo", () => {
    expect(leerEmpresa("Sin nada", incidencia("Grabar\n123456\n"))?.codigo).toBe("031");
  });

  it("dos sociedades distintas no se confunden", () => {
    const otra = "Incidencia en factura recibida. Empresa 032 Industrial Ejemplo_New";
    expect(leerEmpresa(otra, "")).toEqual({ codigo: "032", nombre: "Industrial Ejemplo_New" });
  });
});

describe("los campos con etiqueta", () => {
  it("se leen todos, con la fecha pegada a los dos puntos", () => {
    const c = leerCampos(incidencia("Grabar\n123456\n"));
    expect(c.proveedorCodigo).toBe("77");
    expect(c.cuentaContable).toBe("4040000077");
    expect(c.facturaNumero).toBe("0000555111");
    expect(c.facturaFecha).toBe("2026-08-31");
    expect(c.importe.centimos).toBe(123456);
  });

  /*
   * La plantilla cierra cada campo con un punto. En un número sobra siempre; en
   * una razón social, sólo se sabe que sobra cuando hay dos seguidos. Con uno
   * solo se deja, porque el ERP recorta el nombre por ancho y equivocarse ahí es
   * cambiarle el nombre a un proveedor.
   */
  it("el punto final de la plantilla se quita de los números y no del nombre", () => {
    expect(leerCampos(incidencia("", { razon: "PROVEEDOR EJEMPLO, S.L." })).proveedorNombre).toBe(
      "PROVEEDOR EJEMPLO, S.L."
    );
    expect(leerCampos(incidencia("", { razon: "PROVEEDOR EJEMPLO S.A" })).proveedorNombre).toBe(
      "PROVEEDOR EJEMPLO S.A."
    );
    expect(leerCampos(incidencia("", { factura: "R261099999" })).facturaNumero).toBe("R261099999");
  });

  it("del enlace del flujo se guarda el número de instancia", () => {
    const c = leerCampos(aprobacion(true));
    expect(c.casoReferencia).toBe("9998887");
    expect(c.enlace).toBe(URL_FLUJO);
  });

  it("un correo sin enlace no inventa referencia", () => {
    expect(leerCampos(incidencia("Grabar\n123456\n")).casoReferencia).toBeNull();
  });
});

describe("el bloque «Información Adicional»", () => {
  /*
   * Se conserva EXACTO. Es la instrucción de una persona y es lo que hay que
   * mirar cuando el parser se equivoque; reformatearlo sería perder la prueba.
   */
  it("se recorta entero y sin tocar por dentro", () => {
    const bloque = "URGENTE\n\n02/09/2026 Persona A\nBuenas por favor grabar\nGrabar\n9011223344";
    expect(recortarBloqueLibre(incidencia(bloque + "\n"))).toBe(bloque);
  });

  it("termina donde empieza la plantilla, no antes ni después", () => {
    const r = recortarBloqueLibre(incidencia("Grabar\n9011223344\n"));
    expect(r).not.toContain("Código Proveedor");
    expect(r).toContain("9011223344");
  });

  it("un correo sin bloque —una aprobación— devuelve vacío", () => {
    expect(recortarBloqueLibre(aprobacion(false))).toBe("");
  });
});

/* ── Una línea de albarán ────────────────────────────────────────────────── */

describe("una línea de albarán", () => {
  it("el número solo", () => {
    expect(leerLineaDeAlbaran("9011223344")).toMatchObject({
      albaran: "9011223344",
      importeCentimos: null,
      indicador: null,
      observaciones: "",
    });
  });

  it("número e importe, y el importe NO es el de la factura", () => {
    expect(leerLineaDeAlbaran("0501234 199.95e")).toMatchObject({
      albaran: "0501234",
      importeCentimos: 19995,
    });
  });

  it("número, importe e indicador que no se traduce", () => {
    expect(leerLineaDeAlbaran("0501234 199.95e T2")).toMatchObject({
      albaran: "0501234",
      importeCentimos: 19995,
      indicador: "T2",
      observaciones: "",
    });
  });

  it("número, importe y una observación escrita a mano", () => {
    expect(leerLineaDeAlbaran("9011229999 2020.50€ FALTAN PIEZAS SON 3")).toMatchObject({
      albaran: "9011229999",
      importeCentimos: 202050,
      indicador: null,
      observaciones: "FALTAN PIEZAS SON 3",
    });
  });

  it("el importe del albarán puede ser negativo aunque el de la factura no", () => {
    expect(leerLineaDeAlbaran("0500566 -31.94e")?.importeCentimos).toBe(-3194);
  });

  /*
   * La línea de fecha y persona empieza por dígitos igual que un albarán. Sin
   * esta comprobación, `02/09/2026 Persona A` se convertiría en una actuación
   * sobre el albarán «02».
   */
  it("una línea de fecha y persona no es un albarán", () => {
    expect(leerLineaDeAlbaran("02/09/2026 Persona A")).toBeNull();
  });

  it("una línea sin tirada de dígitos utilizable tampoco", () => {
    expect(leerLineaDeAlbaran("Gracias")).toBeNull();
    expect(leerLineaDeAlbaran("S/N")).toBeNull();
    expect(leerLineaDeAlbaran("199.95e")).toBeNull();
  });
});

/* ── El bloque entero ────────────────────────────────────────────────────── */

describe("leer el bloque", () => {
  it("una acción y un albarán", () => {
    const r = leerBloque("Grabar\n9011223344");
    expect(r.acciones).toHaveLength(1);
    expect(r.acciones[0]).toMatchObject({ accion: "GRABAR", albaran: "9011223344" });
  });

  it("una acción y tres albaranes son tres actuaciones", () => {
    const r = leerBloque("Grabar\n9011223344\n9011223355\n9011223366");
    expect(r.acciones).toHaveLength(3);
    expect(r.acciones.every((a) => a.accion === "GRABAR")).toBe(true);
  });

  /*
   * Dos instrucciones en el mismo correo. Los números van con la cabecera que
   * tienen encima, y mezclarlos sería grabar lo que había que modificar.
   */
  it("dos acciones en un correo no se mezclan", () => {
    const r = leerBloque("GRABAR\n9011223344\n\nMODIFICAR FECHA\n9011229901\n9011229902");
    expect(r.acciones.map((a) => [a.accion, a.albaran])).toEqual([
      ["GRABAR", "9011223344"],
      ["MODIFICAR", "9011229901"],
      ["MODIFICAR", "9011229902"],
    ]);
  });

  /*
   * `MODIFICAR` y `MODIFICAR FECHA` son la misma acción normalizada, y quien lo
   * grabe en el ERP necesita saber que lo que hay que cambiar es la fecha.
   */
  it("el matiz de la instrucción se conserva literal", () => {
    expect(leerBloque("MODIFICAR FECHA\n9011229901").acciones[0].accionTexto).toBe(
      "MODIFICAR FECHA"
    );
    expect(leerBloque("Costes (modificar):\n9011229901").acciones[0]).toMatchObject({
      accion: "MODIFICAR",
      accionTexto: "Costes (modificar)",
    });
  });

  it("una cabecera que sólo repite el verbo no deja matiz", () => {
    expect(leerBloque("MODIFICAR\n9011229901").acciones[0].accionTexto).toBeNull();
  });

  /*
   * «Necesitamos que gestionéis los siguientes albaranes:» seguido de `GRABAR`
   * es una petición de GRABAR: la primera frase es el saludo y la segunda la
   * instrucción. La prosa que no llegó a recoger nada desaparece.
   */
  it("una cabecera explícita manda sobre la prosa que la precede", () => {
    const r = leerBloque(
      "Buenas,\nNecesitamos que gestionéis los siguientes albaranes:\nGracias\nGRABAR\n9011223344"
    );
    expect(r.acciones).toHaveLength(1);
    expect(r.acciones[0].accion).toBe("GRABAR");
  });

  it("pero la prosa vale cuando es la única instrucción", () => {
    const r = leerBloque("Por favor, necesitamos que grabéis los siguientes albaranes.\n9011223344");
    expect(r.acciones[0]).toMatchObject({ accion: "GRABAR", albaran: "9011223344" });
  });

  it("y sigue valiendo para los números que ya había recogido", () => {
    const r = leerBloque(
      "Por favor, necesitamos que grabéis los siguientes albaranes.\n" +
        "9011223344\nCostes (modificar):\n9011229901"
    );
    expect(r.acciones.map((a) => [a.accion, a.albaran])).toEqual([
      ["GRABAR", "9011223344"],
      ["MODIFICAR", "9011229901"],
    ]);
  });

  /*
   * «grabéis y/o modifiquéis» es genuinamente ambiguo. No se elige: se dice. Si
   * después viene una cabecera, ella resuelve la duda.
   */
  it("una frase que pide dos cosas a la vez no se resuelve por su cuenta", () => {
    const r = leerBloque("Necesitamos que grabéis y/o modifiquéis los siguientes albaranes:");
    expect(r.acciones).toHaveLength(0);
    expect(r.avisos.join(" ")).toMatch(/GRABAR y MODIFICAR/);
  });

  it("y la cabecera que viene después sí la resuelve", () => {
    const r = leerBloque(
      "Necesitamos que grabéis y/o modifiquéis los siguientes albaranes:\nGRABAR\n9011223344"
    );
    expect(r.acciones.map((a) => a.accion)).toEqual(["GRABAR"]);
  });

  /*
   * Pidió algo y no dijo sobre qué. Se conserva la petición —el trabajo
   * existe— con el albarán a null y confianza baja. Rellenarla con un número de
   * otra línea sería inventar.
   */
  it("una acción sin número queda incompleta y con poca confianza", () => {
    const r = leerBloque("Buenas,\nNecesitamos que gestionéis los albaranes:\nGracias\nGRABAR");
    expect(r.acciones).toHaveLength(1);
    expect(r.acciones[0]).toMatchObject({ accion: "GRABAR", albaran: null });
    expect(r.acciones[0].confianza).toBeLessThan(0.5);
    expect(r.avisos.join(" ")).toMatch(/no se dice sobre qué albarán/);
  });

  it("un número sin acción no se convierte en actuación: se anota", () => {
    const r = leerBloque("9011223344\nGrabar\n9011229901");
    expect(r.albaranesAmbiguos).toEqual(["9011223344"]);
    expect(r.acciones.map((a) => a.albaran)).toEqual(["9011229901"]);
  });

  it("la urgencia se reconoce escriba quien la escriba", () => {
    expect(leerBloque("URGENTE\nGrabar\n9011223344").urgente).toBe(true);
    expect(leerBloque("urgente\nGrabar\n9011223344").urgente).toBe(true);
    expect(leerBloque("Grabar\n9011223344").urgente).toBe(false);
  });

  it("la fecha y la persona se guardan, y no estorban", () => {
    const r = leerBloque("02/09/2026 Persona A\nGrabar\n9011223344");
    expect(r.persona).toBe("Persona A");
    expect(r.fechaSolicitudTexto).toBe("02/09/2026");
    expect(r.acciones).toHaveLength(1);
  });

  it("el texto libre que no pide nada se conserva como observación", () => {
    const r = leerBloque("PTE. AVERIGUAR JUSTIFICANTE MERCANCIA\n\nGrabar\n9011223344");
    expect(r.observaciones).toBe("PTE. AVERIGUAR JUSTIFICANTE MERCANCIA");
    expect(r.acciones).toHaveLength(1);
  });

  it("las cortesías no se confunden con instrucciones", () => {
    const r = leerBloque("Buenas,\nGracias\nGracias de antemano.\nGrabar\n9011223344");
    expect(r.acciones).toHaveLength(1);
    expect(r.observaciones).toBe("");
  });

  /*
   * Las conjugaciones se reconocen por la raíz. Enumerarlas todas garantiza que
   * la séptima que alguien teclee no esté en la lista.
   */
  it("da igual cómo se conjugue el verbo", () => {
    for (const forma of ["Grabar", "GRABAR", "grabad", "Grabéis", "GRABARLOS"]) {
      expect(leerBloque(`${forma}\n9011223344`).acciones[0]?.accion, forma).toBe("GRABAR");
    }
    for (const forma of ["MODIFICAR", "modifiquéis", "Rectificar", "corregir"]) {
      expect(leerBloque(`${forma}\n9011223344`).acciones[0]?.accion, forma).toBe("MODIFICAR");
    }
    expect(leerBloque("gestionéis:\n9011223344").acciones[0].accion).toBe("GESTIONAR");
    expect(leerBloque("ANULAR\n9011223344").acciones[0].accion).toBe("ANULAR");
  });
});

/* ── El correo entero ────────────────────────────────────────────────────── */

describe("parsear el correo entero", () => {
  it("una incidencia con un albarán sale completa y con confianza alta", () => {
    const r = parsearCorreo(
      ASUNTO_INCIDENCIA,
      incidencia("URGENTE\n\n02/09/2026 Persona A\nGrabar\n9011223344\n", {
        importe: "-45,63",
      })
    );
    expect(r).toMatchObject({
      tipo: "INCIDENCIA_ALBARAN",
      tareaVencida: false,
      urgente: true,
      empresaCodigo: "031",
      proveedorCodigo: "77",
      facturaNumero: "0000555111",
      facturaFecha: "2026-08-31",
      importeCentimos: -4563,
      persona: "Persona A",
    });
    expect(r.acciones).toHaveLength(1);
    expect(r.confianza).toBe(1);
  });

  /*
   * El importe que va junto al albarán y el total de la factura son dos cifras
   * distintas y se guardan por separado. Darlas por equivalentes sería grabar
   * en el ERP el total de una factura de cinco albaranes.
   */
  it("el importe del albarán no se confunde con el de la factura", () => {
    const r = parsearCorreo(
      ASUNTO_INCIDENCIA,
      incidencia("Grabar\n0501234 199.95e\n", { importe: "1.234,56" })
    );
    expect(r.importeCentimos).toBe(123456);
    expect(r.acciones[0].importeCentimos).toBe(19995);
  });

  it("una acción sin albarán deja el correo con poca confianza", () => {
    const r = parsearCorreo(ASUNTO_INCIDENCIA, incidencia("GRABAR\n"));
    expect(r.acciones).toEqual([
      expect.objectContaining({ accion: "GRABAR", albaran: null }),
    ]);
    expect(r.confianza).toBeLessThan(0.5);
  });

  /*
   * Una aprobación no trae bloque libre: el trabajo es la propia aprobación, y
   * sin actuación sería el único tipo de expediente que se cierra sin haber
   * hecho nada.
   */
  it("una aprobación se lleva su actuación de aprobar", () => {
    const r = parsearCorreo(ASUNTO_APROBACION, aprobacion(false));
    expect(r.tipo).toBe("APROBACION_FACTURA");
    expect(r.acciones).toEqual([
      expect.objectContaining({ accion: "APROBAR", albaran: null }),
    ]);
    expect(r.casoReferencia).toBe("9998887");
  });

  /*
   * Y una tarea vencida NO. No pide nada nuevo: es el mismo trabajo, que sigue
   * sin hacerse. Darle su propia actuación llenaría el expediente de «aprobar»
   * repetidos, uno por recordatorio.
   */
  it("una tarea vencida no añade trabajo: sólo insiste", () => {
    const r = parsearCorreo(ASUNTO_VENCIDA, aprobacion(true));
    expect(r.tipo).toBe("APROBACION_FACTURA");
    expect(r.tareaVencida).toBe(true);
    expect(r.acciones).toEqual([]);
    expect(r.reclamacion).toBe(true);
  });

  it("la aprobación y sus tareas vencidas comparten la terna que las une", () => {
    const original = parsearCorreo(ASUNTO_APROBACION, aprobacion(false));
    const vencida = parsearCorreo(ASUNTO_VENCIDA, aprobacion(true));
    for (const campo of ["empresaCodigo", "proveedorCodigo", "facturaNumero", "casoReferencia"] as const) {
      expect(vencida[campo], campo).toBe(original[campo]);
    }
  });

  it("el bloque original viaja entero dentro de lo parseado", () => {
    const bloque = "PTE. AVERIGUAR JUSTIFICANTE MERCANCIA\n\nGrabar\n9011223344";
    const r = parsearCorreo(ASUNTO_INCIDENCIA, incidencia(bloque + "\n"));
    expect(r.informacionAdicional).toBe(bloque);
  });

  it("un correo que no es de Therefore no revienta: sale como OTRO", () => {
    const r = parsearCorreo("Re: comida", "¿a las dos?");
    expect(r.tipo).toBe("OTRO");
    expect(r.acciones).toEqual([]);
    expect(r.confianza).toBeLessThan(1);
    expect(r.avisos.length).toBeGreaterThan(0);
  });
});
