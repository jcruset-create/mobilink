/**
 * Qué SECCIÓN propone Mobilink Cash para un cobro escaneado: taller o
 * gasolinera.
 *
 * Hermana de `classifier.ts` y con las mismas reglas del juego: entra la
 * evidencia leída del papel, entran las reglas de la empresa y entra su
 * catálogo de secciones, y sale una propuesta. Sin base de datos, sin red, sin
 * IA. Por eso se puede probar entera.
 *
 * ## Por qué hace falta
 *
 * Este taller lleva dos negocios en un solo cajón, y la pantalla de Cobros
 * RECUERDA la última sección usada. Esa memoria es cómoda y es justo lo que
 * crea el fallo: se registra un cobro de taller, el chip se queda en Taller, y
 * el siguiente ticket de gasoil entra en Taller por inercia. El descuadre por
 * sección aparece en el cierre sin nada que lo explique.
 *
 * ## La regla que manda sobre las demás
 *
 *     NO LO RECONOZCO  ≠  ES DEL TALLER
 *
 * Es la misma forma del «no hay TPV ≠ es efectivo» de la forma de cobro, y por
 * el mismo motivo. Un ticket de gasolinera fotografiado torcido, arrugado y con
 * la luz de un fluorescente tampoco se reconoce, y tratar eso como prueba de
 * que es del taller mandaría ventas de gasoil reales al negocio equivocado cada
 * vez que saliera mal la foto.
 *
 * Así que hay tres salidas y no dos: **gasolinera**, **taller** y **no lo sé**.
 * La tercera deja la sección que hubiera puesta y lo dice.
 *
 * ## Y la que sostiene todo lo demás
 *
 * Antes de proponer nada se rehace una cuenta que el ticket trae hecha:
 * `base + cuota = total`, al céntimo. Si no cuadra, algo se ha leído mal y no
 * se propone sección. No hace falta saber QUÉ se leyó mal; hace falta no
 * seguir. Es la misma red que el «Sum = 887,40» del cotejo con el ERP.
 */

import type { Centimos } from "../domain/money.ts";

/**
 * En qué dato del papel mira una regla de sección.
 *
 * Los cuatro salen de lo que el extractor YA lee, y no es casualidad que sean
 * estos: son los que identifican quién emitió el papel. La sección la dice
 * quién cobra, no cómo se pagó —eso es de la otra clasificación— y por eso
 * estas reglas viven en su propia tabla y no mezcladas con las de forma de
 * cobro. Si compartieran tabla, una edición movería las dos cosas.
 */
export type CampoSeccion = "CIF_EMISOR" | "NOMBRE_EMISOR" | "SERIE" | "CONCEPTO";

/** Una regla del maestro de la empresa. */
export type ReglaSeccion = {
  id: number;
  campo: CampoSeccion;
  /** Lo que se busca. Se compara sin acentos y sin mayúsculas. */
  patron: string;
  /** Sección del catálogo DE ESA EMPRESA. */
  sectionId: number;
  /** Cuánta fe merece esta regla, de 0 a 1. */
  confianza: number;
  /** Si además puede cambiar el chip sola en la pantalla. */
  autoSeleccionar: boolean;
  /** Primero las de número más bajo. Empates, por id. */
  prioridad: number;
};

/** Lo que se ha leído del papel y sirve para decidir la sección. */
export type EvidenciaSeccion = {
  /** NIF de quien EMITE el papel. La señal más fuerte que hay. */
  cifEmisor: string | null;
  nombreEmisor: string | null;
  /** El número del documento entero: de aquí sale la serie («T5-155»). */
  numeroFactura: string | null;
  concepto: string | null;
  /** Para la comprobación aritmética. */
  baseCentimos: Centimos | null;
  ivaCentimos: Centimos | null;
  totalCentimos: Centimos | null;
  /** Lo que el modelo dice que le merece haber leído al emisor. */
  confianzaEmisor: number;
};

export type PropuestaSeccion = {
  /** Sección del catálogo, o null. null es NO LO SÉ, nunca «la de siempre». */
  sectionId: number | null;
  confianza: number;
  /** En castellano y para una persona: es lo que se enseña y lo que se audita. */
  motivo: string;
  /** Si la pantalla puede cambiar el chip sola. */
  autoSeleccionar: boolean;
  /** Regla que ha decidido, para poder rehacer el camino meses después. */
  reglaId: number | null;
};

/**
 * Umbral para cambiar el chip solo.
 *
 * Más bajo que el de la forma de cobro (0,9) a propósito, y conviene decir por
 * qué no es una relajación: **el cambio de sección se ve sin mirar**. El panel
 * entero de Cobros se pone rojo con la gasolinera puesta, así que un cambio
 * automático equivocado lo caza quien esté delante antes de teclear el importe.
 * La forma de cobro no tiene ese aviso de color, y por eso exige más.
 */
export const UMBRAL_SECCION = 0.8;

/** Sin acentos, sin mayúsculas y sin espacios de más: como se compara todo. */
function llano(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * El NIF, sin la puntuación con la que cada papel lo escribe.
 *
 * «A-43044379», «A43044379» y «a 43044379» son el mismo. Sin esto, la regla
 * fallaría según cómo lo imprimiera el TPV ese día, que es la peor manera de
 * fallar: a ratos.
 */
function nifLlano(texto: string | null | undefined): string {
  return llano(texto).replace(/[\s.\-/]/g, "");
}

function valorDelCampo(campo: CampoSeccion, e: EvidenciaSeccion): string | null {
  switch (campo) {
    case "CIF_EMISOR":
      return e.cifEmisor;
    case "NOMBRE_EMISOR":
      return e.nombreEmisor;
    case "SERIE":
      return e.numeroFactura;
    case "CONCEPTO":
      return e.concepto;
  }
}

/**
 * Cómo se compara el patrón con el valor del campo.
 *
 * El NIF se compara ENTERO y sin puntuación: identifica a una empresa, y
 * «A43044379» no puede casar con otro que lo contenga. Los demás son
 * descriptivos y se comparan por trozos, porque lo que se imprime alrededor
 * cambia de un papel a otro: la serie «T5-» tiene que casar con «T5-155», y el
 * concepto «gas-oil» con «GAS-OIL A DIESEL».
 *
 * Es el mismo criterio que `classifier.ts` aplica a comercio y terminal frente
 * a adquirente y red, y por el mismo motivo.
 */
function casa(campo: CampoSeccion, patron: string, valor: string): boolean {
  if (campo === "CIF_EMISOR") {
    const p = nifLlano(patron);
    const v = nifLlano(valor);
    return Boolean(p) && p === v;
  }
  const p = llano(patron);
  const v = llano(valor);
  if (!p || !v) return false;
  return v.includes(p);
}

/**
 * ¿Cuadra el IVA del papel consigo mismo?
 *
 * `null` cuando no hay las tres cifras: no es que no cuadre, es que no se ha
 * podido comprobar, y las dos cosas NO son lo mismo —la lección del `bloqueante`
 * frente al `fiable` en la lectura del ERP—. Un ticket recortado del que no se
 * ve la base puede estar perfectamente bien leído.
 *
 * Al céntimo, sin tolerancia: esta suma la hace el TPV, no un redondeo. Si no
 * da, hay una cifra mal leída.
 */
export function ivaCuadra(e: EvidenciaSeccion): boolean | null {
  if (e.baseCentimos === null || e.ivaCentimos === null || e.totalCentimos === null) return null;
  return e.baseCentimos + e.ivaCentimos === e.totalCentimos;
}

/**
 * La propuesta de sección.
 *
 * `catalogo` son las secciones que la empresa tiene activas AHORA. Se pasa
 * entero a propósito: una regla que apunta a una sección dada de baja no puede
 * proponer algo que la pantalla no sabe dibujar, así que se salta y se dice por
 * qué. Mismo criterio que con las formas de cobro.
 *
 * `seccionPorDefecto` es la que se propone cuando NADA reconoce el papel y la
 * lectura es buena: el caso normal del taller. Va como parámetro y no se busca
 * aquí dentro porque quien sabe cuál es es el catálogo, y esta función no
 * consulta nada.
 */
export function clasificarSeccion(
  evidencia: EvidenciaSeccion,
  reglas: readonly ReglaSeccion[],
  catalogo: ReadonlySet<number>,
  seccionPorDefecto: number | null
): PropuestaSeccion {
  /*
   * Puerta 1: si la aritmética del papel no cuadra, no se propone nada.
   *
   * Ni se miran las reglas. Con una cifra mal leída, lo que se haya entendido
   * del emisor tampoco es de fiar, y una propuesta de sección apoyada en una
   * lectura que YA SE SABE mala es peor que no proponer: se acepta sin mirar.
   */
  if (ivaCuadra(evidencia) === false) {
    return {
      sectionId: null,
      confianza: 0,
      motivo:
        "Las cifras del documento no cuadran entre ellas (base + IVA no da el total), " +
        "así que la lectura no es de fiar. Elige tú la sección.",
      autoSeleccionar: false,
      reglaId: null,
    };
  }

  const ordenadas = [...reglas].sort((a, b) => a.prioridad - b.prioridad || a.id - b.id);

  const descartadas: number[] = [];
  for (const regla of ordenadas) {
    const valor = valorDelCampo(regla.campo, evidencia);
    if (!valor || !casa(regla.campo, regla.patron, valor)) continue;

    if (!catalogo.has(regla.sectionId)) {
      // Se apunta y se sigue: puede haber otra regla buena detrás, y callarse
      // esto dejaría a alguien sin entender por qué no se propone nada.
      descartadas.push(regla.sectionId);
      continue;
    }

    /*
     * La confianza es la MENOR entre la de la regla y la que el modelo le da a
     * haber leído bien al emisor. Una regla infalible sobre un nombre que el
     * modelo apenas ha podido leer no es una certeza.
     */
    const confianza = Math.min(regla.confianza, evidencia.confianzaEmisor);
    return {
      sectionId: regla.sectionId,
      confianza,
      motivo: `Regla «${regla.patron}» sobre ${etiquetaCampo(regla.campo)}: ${valor}`,
      autoSeleccionar: regla.autoSeleccionar && confianza >= UMBRAL_SECCION,
      reglaId: regla.id,
    };
  }

  if (descartadas.length > 0) {
    return {
      sectionId: null,
      confianza: 0,
      motivo:
        "Una regla reconoce este documento, pero apunta a una sección que ya no está activa. " +
        "Revísala en Configuración → Secciones.",
      autoSeleccionar: false,
      reglaId: null,
    };
  }

  /*
   * Puerta 2: nadie lo reconoce.
   *
   * Aquí es donde se juega la honestidad de todo esto. Que ninguna regla case
   * es la señal de «no es de ninguno de los negocios con reglas», y en este
   * taller eso quiere decir taller. Pero es evidencia NEGATIVA, así que:
   *
   * · Se propone la sección por defecto —que es lo útil, y lo que pidió quien
   *   usa esto— pero con confianza BAJA y sin cambiar el chip solo.
   * · Y el motivo dice de qué va: que no se ha reconocido, no que se haya
   *   identificado el taller. Quien lo lea tiene que poder distinguirlo.
   *
   * Sin este freno, una foto ilegible de un ticket de gasoil se iría al taller
   * con el chip cambiado y sin que nada chirriara.
   */
  if (seccionPorDefecto !== null && catalogo.has(seccionPorDefecto)) {
    return {
      sectionId: seccionPorDefecto,
      confianza: 0.5,
      motivo:
        "Ninguna regla reconoce este documento, así que se propone la sección habitual. " +
        "Compruébalo: no se ha identificado el negocio, solo se ha descartado el resto.",
      autoSeleccionar: false,
      reglaId: null,
    };
  }

  return {
    sectionId: null,
    confianza: 0,
    motivo: "Ninguna regla reconoce este documento y no hay sección por defecto activa.",
    autoSeleccionar: false,
    reglaId: null,
  };
}

function etiquetaCampo(campo: CampoSeccion): string {
  switch (campo) {
    case "CIF_EMISOR":
      return "el NIF del emisor";
    case "NOMBRE_EMISOR":
      return "el nombre del emisor";
    case "SERIE":
      return "el número de documento";
    case "CONCEPTO":
      return "el concepto";
  }
}
