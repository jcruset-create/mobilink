/**
 * Por qué un análisis está en revisión.
 *
 * Un estado sin motivo es un estado que nadie sabe resolver. «REVISAR» a secas
 * obliga a quien lo recibe a volver a abrir el PDF y repetir el trabajo del
 * parser a mano; con la validación delante —qué se esperaba, qué se obtuvo y en
 * qué línea— la revisión es mirar una celda.
 *
 * ── El estado general es el PEOR, no la media ───────────────────────────────
 *
 * Nueve validaciones en OK y una en ERROR es un análisis en ERROR. Promediar
 * escondería justo lo que hay que ver, y un albarán que no se ha encontrado no
 * mejora porque sus descuentos se hayan leído bien.
 *
 * ── Lo que NO se hace ───────────────────────────────────────────────────────
 *
 * No se intenta EXPLICAR un descuadre (§31–32). Si las líneas suman 63,35 € más
 * que la incidencia y el documento trae unos portes de 63,35 €, la tentación es
 * decir «cuadra con los portes» y cerrar. Pero el albarán no los incluye, quien
 * escribió la incidencia puede haberlos contado o no, y la diferencia sigue
 * siendo una diferencia. Los conceptos globales se enseñan al lado, como
 * información, y la decisión la toma una persona.
 */

import type { AnalisisAlbaran } from "./documento/index.ts";

export type TipoValidacion =
  | "DOCUMENTO"
  | "ALBARAN_MATCH"
  | "SEPARACION_ALBARANES"
  | "LINEAS"
  | "DESCUENTOS"
  | "CAMPOS_CRITICOS"
  | "IMPORTE"
  | "CORREO_VS_DOCUMENTO";

export type EstadoValidacion = "OK" | "REVISAR" | "ERROR";

export type Validacion = {
  tipo: TipoValidacion;
  estado: EstadoValidacion;
  /** Escrito para la pantalla, no para el log. */
  mensaje: string;
  valorEsperado: string | null;
  valorObtenido: string | null;
  metadata: Record<string, unknown>;
};

/**
 * El mensaje del descuadre de importe es LITERAL y viene del encargo.
 *
 * Está aquí como constante porque hay una prueba de integración que lo compara
 * palabra por palabra: es el texto que ve quien tiene que decidir, y cambiarlo
 * sin querer al reescribir una frase sería cambiar lo que se le dice.
 */
export const MENSAJE_DESCUADRE =
  "Existe un descuadre entre el importe indicado en la incidencia y las líneas del albarán. Requiere revisión.";

export const UMBRAL_CONFIANZA_CAMPO_POR_DEFECTO = 0.85;

export type EntradaValidacion = {
  analisis: AnalisisAlbaran;
  /** El de la actuación, en céntimos con signo. `null` si el correo no lo decía. */
  importeIncidenciaCentimos: number | null;
  toleranciaCentimos?: number;
  umbralConfianzaCampo?: number;
  /** De dónde salieron las líneas. `PDF_IA` nunca llega a OK por sí solo. */
  origen?: "PDF_TEXTO" | "PDF_IA" | "XML";
  /** Para `CORREO_VS_DOCUMENTO`: lo que decía el correo y lo que dice el papel. */
  correo?: { facturaNumero: string | null; importeCentimos: number | null };
  documento?: { facturaNumero: string | null; totalCentimos: number | null };
};

function eur(centimos: number | null): string {
  if (centimos === null) return "—";
  const signo = centimos < 0 ? "−" : "";
  const abs = Math.abs(centimos);
  return `${signo}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")} €`;
}

const val = (
  tipo: TipoValidacion,
  estado: EstadoValidacion,
  mensaje: string,
  esperado: string | null = null,
  obtenido: string | null = null,
  metadata: Record<string, unknown> = {}
): Validacion => ({ tipo, estado, mensaje, valorEsperado: esperado, valorObtenido: obtenido, metadata });

/** La validación DOCUMENTO cuando el fichero ni siquiera se pudo leer. */
export function validacionDocumentoIlegible(motivo: string): Validacion {
  return val("DOCUMENTO", "ERROR", motivo, "Un PDF legible", "No se ha podido leer");
}

/** Todas las validaciones de un análisis ya hecho. */
export function validarAnalisis(entrada: EntradaValidacion): Validacion[] {
  const { analisis: a } = entrada;
  const tolerancia = entrada.toleranciaCentimos ?? 2;
  const umbralCampo = entrada.umbralConfianzaCampo ?? UMBRAL_CONFIANZA_CAMPO_POR_DEFECTO;
  const origen = entrada.origen ?? "PDF_TEXTO";
  const salida: Validacion[] = [];

  salida.push(val("DOCUMENTO", "OK", "El documento se ha abierto y tiene texto.", null, `${a.parserUsado} · ${origen}`));

  /* ── ¿Es este el albarán que se pedía? ─────────────────────────────────── */
  if (a.resultadoMatch === "MATCH") {
    salida.push(
      val("ALBARAN_MATCH", "OK", a.motivoMatch, a.numeroSolicitado, a.numeroDocumento, {
        confianza: a.confianzaMatch,
      })
    );
  } else if (a.resultadoMatch === "UNCERTAIN") {
    salida.push(
      val("ALBARAN_MATCH", "REVISAR", a.motivoMatch, a.numeroSolicitado, a.numeroDocumento, {
        confianza: a.confianzaMatch,
      })
    );
  } else {
    const parecidos = a.parecidos.length
      ? ` El documento trae ${a.parecidos.join(", ")}, que se le parece.`
      : "";
    salida.push(
      val(
        "ALBARAN_MATCH",
        "ERROR",
        `Albarán no encontrado en el documento.${parecidos}`,
        a.numeroSolicitado,
        a.numeroDocumento,
        { confianza: a.confianzaMatch, parecidos: a.parecidos }
      )
    );
    // Sin albarán localizado, lo demás no tiene sujeto: se para aquí en vez de
    // acumular validaciones sobre unas líneas que no son de nadie.
    return salida;
  }

  /* ── ¿Está bien separado de sus vecinos? ───────────────────────────────── */
  const s = a.seccion;
  if (!s) {
    salida.push(val("SEPARACION_ALBARANES", "REVISAR", "No se ha delimitado ninguna sección."));
  } else if (s.documentoEntero) {
    salida.push(
      val(
        "SEPARACION_ALBARANES",
        "REVISAR",
        "El documento no separa albaranes: se ha tratado entero como uno solo.",
        "Una marca de albarán",
        "Ninguna"
      )
    );
  } else if (s.huerfanas > 0) {
    salida.push(
      val(
        "SEPARACION_ALBARANES",
        "REVISAR",
        `Quedan ${s.huerfanas} líneas entre el final de este albarán y el siguiente que no se han podido asignar a ninguno.`,
        "0 líneas sueltas",
        `${s.huerfanas}`,
        { vecinaSiguiente: s.vecinaSiguiente }
      )
    );
  } else if (s.finPor === "FIN_DOCUMENTO" && s.vecinaSiguiente) {
    salida.push(
      val(
        "SEPARACION_ALBARANES",
        "REVISAR",
        "El albarán se ha cerrado al acabar el documento aunque hay otra marca después.",
        "Un cierre claro",
        "Fin de documento",
        { vecinaSiguiente: s.vecinaSiguiente }
      )
    );
  } else {
    salida.push(
      val(
        "SEPARACION_ALBARANES",
        "OK",
        `Delimitado de la página ${s.paginaInicio} a la ${s.paginaFin}.`,
        null,
        s.finPor === "TOTALES" ? "Cierra en los totales" : s.finPor === "SIGUIENTE_MARCA" ? "Cierra en el siguiente albarán" : "Cierra al final del documento",
        { vecinaAnterior: s.vecinaAnterior, vecinaSiguiente: s.vecinaSiguiente }
      )
    );
  }

  /* ── Las líneas ────────────────────────────────────────────────────────── */
  const conTexto = (s?.lineas.length ?? 0) > 0;
  const noCuadran = a.lineas.filter((l) => l.cuadraAritmetica === false);
  const sinComprobar = a.lineas.filter((l) => l.cuadraAritmetica === null);

  if (a.lineas.length === 0) {
    salida.push(
      conTexto
        ? val("LINEAS", "REVISAR", "La sección tiene texto pero no se ha reconocido ninguna línea de artículo.", "≥ 1 línea", "0")
        : val("LINEAS", "ERROR", "La sección del albarán está vacía.", "≥ 1 línea", "0")
    );
  } else if (noCuadran.length > 0) {
    salida.push(
      val(
        "LINEAS",
        "REVISAR",
        `${noCuadran.length} de ${a.lineas.length} líneas no cuadran: cantidad × precio con sus descuentos no da el importe impreso.`,
        "cantidad × precio × descuentos = importe",
        `No cuadra en ${noCuadran.map((l) => `la línea ${l.numeroLinea}`).join(", ")}`,
        { lineas: noCuadran.map((l) => l.numeroLinea) }
      )
    );
  } else if (sinComprobar.length > 0) {
    salida.push(
      val(
        "LINEAS",
        "REVISAR",
        `${sinComprobar.length} de ${a.lineas.length} líneas no se han podido comprobar porque les falta algún dato.`,
        "cantidad, precio e importe en todas",
        `Faltan datos en ${sinComprobar.map((l) => `la línea ${l.numeroLinea}`).join(", ")}`,
        { lineas: sinComprobar.map((l) => l.numeroLinea) }
      )
    );
  } else if (origen === "PDF_IA") {
    salida.push(
      val(
        "LINEAS",
        "REVISAR",
        `Las ${a.lineas.length} líneas cuadran, pero se han leído con ayuda de la IA y no se dan por buenas sin mirarlas.`,
        null,
        "Leídas por IA"
      )
    );
  } else if (a.modoTabla === "POSICIONAL") {
    salida.push(
      val(
        "LINEAS",
        "REVISAR",
        `Las ${a.lineas.length} líneas cuadran, pero el documento no trae cabecera de columnas y se han leído por su posición.`,
        "Una cabecera de columnas",
        "Ninguna"
      )
    );
  } else {
    salida.push(val("LINEAS", "OK", `${a.lineas.length} líneas, y todas cuadran.`, null, `${a.lineas.length}`));
  }

  /* ── Descuentos ────────────────────────────────────────────────────────── */
  const dtoDudoso = a.lineas.filter((l) => l.confianza.descuentos > 0 && l.confianza.descuentos < 0.5);
  salida.push(
    dtoDudoso.length > 0
      ? val(
          "DESCUENTOS",
          "REVISAR",
          `La celda de descuento de ${dtoDudoso.length} línea(s) trae texto que no se ha entendido.`,
          "Porcentajes",
          dtoDudoso.map((l) => l.descuentosRaw).join(" · "),
          { lineas: dtoDudoso.map((l) => l.numeroLinea) }
        )
      : val("DESCUENTOS", "OK", "Los descuentos se han leído tal y como están impresos.")
  );

  /* ── Campos críticos ───────────────────────────────────────────────────── */
  const flojos: string[] = [];
  for (const l of a.lineas) {
    for (const campo of ["referencia", "cantidad", "precio", "importe"] as const) {
      if (l.confianza[campo] < umbralCampo) flojos.push(`línea ${l.numeroLinea}: ${campo}`);
    }
  }
  salida.push(
    flojos.length > 0
      ? val(
          "CAMPOS_CRITICOS",
          "REVISAR",
          `${flojos.length} campo(s) se han leído con poca confianza o no se han leído.`,
          `Confianza ≥ ${umbralCampo}`,
          flojos.join(" · "),
          { campos: flojos }
        )
      : val("CAMPOS_CRITICOS", "OK", "Referencia, cantidad, precio e importe se han leído con confianza en todas las líneas.")
  );

  /* ── El descuadre ──────────────────────────────────────────────────────── */
  const suma = a.sumaLineasCentimos;
  const incidencia = entrada.importeIncidenciaCentimos;
  if (incidencia === null || suma === null) {
    salida.push(
      val(
        "IMPORTE",
        "OK",
        incidencia === null
          ? "La incidencia no indicaba importe, así que no hay nada que comparar."
          : "No se ha podido sumar el albarán, así que no hay nada que comparar.",
        eur(incidencia),
        eur(suma)
      )
    );
  } else {
    const diferencia = suma - incidencia;
    salida.push(
      Math.abs(diferencia) <= tolerancia
        ? val("IMPORTE", "OK", "El albarán suma lo que decía la incidencia.", eur(incidencia), eur(suma), { diferencia })
        : val("IMPORTE", "REVISAR", MENSAJE_DESCUADRE, eur(incidencia), eur(suma), { diferencia })
    );
  }

  /* ── El correo contra el papel ─────────────────────────────────────────── */
  if (entrada.correo && entrada.documento) {
    const mismaFactura =
      !entrada.correo.facturaNumero ||
      !entrada.documento.facturaNumero ||
      mismoNumeroDeFactura(entrada.correo.facturaNumero, entrada.documento.facturaNumero);
    salida.push(
      mismaFactura
        ? val("CORREO_VS_DOCUMENTO", "OK", "El documento es de la factura que decía el correo.", entrada.correo.facturaNumero, entrada.documento.facturaNumero)
        : val(
            "CORREO_VS_DOCUMENTO",
            "REVISAR",
            "El número de factura del correo y el del documento no coinciden. Se guardan los dos.",
            entrada.correo.facturaNumero,
            entrada.documento.facturaNumero
          )
    );
  }

  return salida;
}

/**
 * «N-123456» y «N0000123456» son la misma factura: el papel rellena con ceros
 * y el correo no. Se comparan sin separadores y sin ceros de relleno, y vale
 * también que uno termine en el otro («FAC-1-N-123456» frente a «N123456»),
 * siempre que el corto tenga entidad.
 */
function mismoNumeroDeFactura(a: string, b: string): boolean {
  const limpio = (v: string) =>
    v
      .replace(/\W/g, "")
      .toUpperCase()
      .replace(/(^|[A-Z])0+(?=\d)/g, "$1");
  const x = limpio(a);
  const y = limpio(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  return corto.length >= 5 && largo.endsWith(corto);
}

const ORDEN: Record<EstadoValidacion, number> = { OK: 0, REVISAR: 1, ERROR: 2 };

/** El peor estado de la lista. Vacía significa que no se ha analizado nada. */
export function peorEstado(validaciones: Validacion[]): EstadoValidacion {
  let peor: EstadoValidacion = "OK";
  for (const v of validaciones) if (ORDEN[v.estado] > ORDEN[peor]) peor = v.estado;
  return peor;
}
