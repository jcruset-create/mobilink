/**
 * El bloque «Información Adicional»: lo que una persona pide, en sus palabras.
 *
 * Es la mitad del correo que no tiene plantilla. En veinte correos reales
 * aparecen `Grabar`, `GRABAR`, `MODIFICAR`, `MODIFICAR FECHA`,
 * `Costes (modificar):`, `grabéis y/o modifiquéis`, `gestionéis`, con y sin
 * acentos, con y sin dos puntos, a veces seguidas de números y a veces de nada.
 *
 * ── Las tres reglas que lo gobiernan ────────────────────────────────────────
 *
 * 1. **Una cabecera manda sobre la prosa.** «Necesitamos que gestionéis los
 *    siguientes albaranes:» seguido de `GRABAR` es una petición de GRABAR: la
 *    primera frase es el saludo y la segunda es la instrucción. Por eso una
 *    acción sacada de la prosa que todavía no ha recogido ningún albarán
 *    desaparece en cuanto llega una cabecera explícita.
 *
 * 2. **La acción se arrastra hasta la siguiente cabecera.** Los números que
 *    vienen debajo son suyos. Es lo que permite que un correo pida grabar uno y
 *    modificar la fecha de otros tres sin que se mezclen.
 *
 * 3. **Lo que no se sabe, no se inventa.** Un número sin acción no se convierte
 *    en actuación: se anota como ambiguo y lo mira una persona. Una acción sin
 *    número tampoco se rellena con el primero que haya: sale incompleta y pide
 *    revisión. Un albarán grabado con la acción equivocada cuesta más de
 *    arreglar que uno que se quedó esperando.
 */

import { claveAlbaran } from "../albaran.ts";
import type { TipoAccion } from "../estados.ts";
import { leerImporte } from "./importes.ts";
import { empiezaPorFecha, normalizar, palabras } from "./texto.ts";

/* ── Vocabulario ─────────────────────────────────────────────────────────── */

/**
 * Se buscan RAÍCES, no palabras completas.
 *
 * `grabar`, `grabéis`, `Grabad`, `grabarlos` son la misma petición, y
 * enumerarlas todas garantiza que la séptima variante que alguien teclee no
 * esté en la lista. La raíz `GRAB` las coge todas. El precio es algún falso
 * positivo teórico; a cambio, el parser no se rompe porque alguien conjugue
 * distinto un martes.
 */
export type VocabularioAcciones = Record<TipoAccion, string[]>;

export const RAICES_ACCION: VocabularioAcciones = {
  GRABAR: ["GRAB", "DAR ENTRADA", "DAR DE ALTA"],
  MODIFICAR: ["MODIF", "CORREG", "RECTIFIC"],
  GESTIONAR: ["GESTION", "TRAMIT"],
  ANULAR: ["ANUL"],
  REVISAR: ["REVIS", "COMPROB"],
  APROBAR: ["APROB", "APRUEB"],
  OTRO: [],
};

/** Cuántas palabras puede tener una línea para considerarse una CABECERA. */
const MAXIMO_PALABRAS_CABECERA = 4;

export const PALABRAS_URGENTE = ["URGENTE", "URGE", "MUY URGENTE"];

export const PALABRAS_RECLAMACION = [
  "RECLAMACI",
  "SEGUIMOS SIN",
  "SEGUNDA VEZ",
  "DE NUEVO",
  "TODAVIA NO",
  "SIN RESPUESTA",
  "INSISTIMOS",
];

/** Cortesías que no piden nada y no deben confundirse con una instrucción. */
const CORTESIA = ["BUENAS", "HOLA", "GRACIAS", "GRACIAS DE ANTEMANO", "UN SALUDO", "SALUDOS"];

/* ── Lo que sale ─────────────────────────────────────────────────────────── */

export type AccionLeida = {
  accion: TipoAccion;
  /**
   * El MATIZ de la instrucción, cuando lo hay: «MODIFICAR FECHA»,
   * «Costes (modificar)». `null` cuando la cabecera no dice más que el verbo.
   *
   * No es un adorno. `MODIFICAR` a secas y `MODIFICAR FECHA` acaban en la misma
   * acción normalizada, y quien lo grabe en el ERP necesita saber que lo que
   * hay que cambiar es la fecha. Normalizar y tirar el resto sería quedarse con
   * el verbo y perder el complemento directo.
   *
   * Sólo se conserva el de una CABECERA. De una frase de prosa no se guarda
   * nada: «Por favor, necesitamos que grabéis los siguientes albaranes» no
   * matiza la acción, y meterla aquí llenaría la pantalla de cortesías. El
   * texto entero sigue estando, sin tocar, en el bloque «Información
   * Adicional».
   */
  accionTexto: string | null;
  albaran: string | null;
  importeCentimos: number | null;
  indicador: string | null;
  observaciones: string;
  confianza: number;
};

export type BloqueLeido = {
  acciones: AccionLeida[];
  /** Números citados a los que no se ha sabido asignar acción. */
  albaranesAmbiguos: string[];
  urgente: boolean;
  reclamacion: boolean;
  persona: string | null;
  fechaSolicitudTexto: string | null;
  /** El texto libre que no era ni instrucción ni albarán. */
  observaciones: string;
  avisos: string[];
};

/* ── Reconocer una línea ─────────────────────────────────────────────────── */

type Verbo = { accion: TipoAccion; raiz: string };

function verbosDe(linea: string, vocabulario: VocabularioAcciones): Verbo[] {
  const n = normalizar(linea);
  const encontrados: Verbo[] = [];
  for (const [accion, raices] of Object.entries(vocabulario) as [TipoAccion, string[]][]) {
    for (const raiz of raices) {
      if (n.includes(raiz)) {
        encontrados.push({ accion, raiz });
        break;
      }
    }
  }
  return encontrados;
}

function esCortesia(linea: string): boolean {
  const n = normalizar(linea).replace(/[.,;:!¡?¿]/g, "").trim();
  return CORTESIA.includes(n);
}

export type AlbaranEnLinea = {
  albaran: string;
  importeCentimos: number | null;
  confianzaImporte: number;
  indicador: string | null;
  observaciones: string;
  avisos: string[];
};

/**
 * Descompone una línea de albarán.
 *
 * El primer trozo es el número; después puede venir un importe, un indicador
 * que no se interpreta y una observación escrita a mano. Los tres son
 * opcionales y aparecen en ese orden en los correos reales.
 *
 * La diferencia entre INDICADOR y OBSERVACIÓN es una conjetura: `T2` parece un
 * código y `FALTAN RUEDAS SON 2` no. Se distingue por la forma —letras y
 * dígitos pegados, muy corto— y da igual acertar: los dos se guardan tal cual y
 * ninguno se interpreta. Lo que no se puede es tirarlos.
 */
export function leerLineaDeAlbaran(linea: string): AlbaranEnLinea | null {
  if (!linea.trim() || empiezaPorFecha(linea)) return null;

  const trozos = linea.trim().split(/\s+/);
  const primero = trozos[0];

  // Sin una tirada de dígitos utilizable no es un número de albarán.
  if (!claveAlbaran(primero)) return null;
  // Y si el primer trozo ya lleva moneda, es un importe suelto, no un albarán.
  if (/[€]|(?<=\d)[eE]$/.test(primero)) return null;

  const resto = trozos.slice(1);
  const avisos: string[] = [];
  let importeCentimos: number | null = null;
  let confianzaImporte = 1;
  let indicador: string | null = null;

  const pareceImporte = (t: string) =>
    /[€]$|(?<=\d)[eE]$|^[+-]/.test(t) || /\d[.,]\d/.test(t);

  const i = resto.findIndex(pareceImporte);
  let cola = resto;
  if (i >= 0) {
    const leido = leerImporte(resto[i]);
    if (leido.centimos !== null) {
      importeCentimos = leido.centimos;
      confianzaImporte = leido.confianza;
      if (leido.motivo) avisos.push(leido.motivo);
      cola = [...resto.slice(0, i), ...resto.slice(i + 1)];
    }
  }

  // Un solo trozo corto que mezcla letras y dígitos: código, no frase.
  if (cola.length === 1 && /^(?:[A-Z]{1,3}\d{1,3}|\d{1,3}[A-Z]{1,3})$/.test(normalizar(cola[0]))) {
    indicador = cola[0];
    cola = [];
  }

  return {
    albaran: primero,
    importeCentimos,
    confianzaImporte,
    indicador,
    observaciones: cola.join(" ").trim(),
    avisos,
  };
}

/* ── El recorrido ────────────────────────────────────────────────────────── */

type EnCurso = {
  accion: TipoAccion;
  accionTexto: string | null;
  origen: "prosa" | "cabecera";
  albaranes: AlbaranEnLinea[];
};

/** El matiz que aporta una cabecera, o `null` si sólo repite el verbo. */
function matizDe(linea: string, accion: TipoAccion, origen: "prosa" | "cabecera"): string | null {
  if (origen !== "cabecera") return null;
  const limpia = linea.replace(/[:.]+\s*$/, "").trim();
  return normalizar(limpia) === accion ? null : limpia;
}

export function leerBloque(
  bloque: string,
  vocabulario: VocabularioAcciones = RAICES_ACCION
): BloqueLeido {
  const avisos: string[] = [];
  const sueltos: string[] = [];
  const libres: string[] = [];
  const hechas: EnCurso[] = [];
  let enCurso: EnCurso | null = null;
  let persona: string | null = null;
  let fechaSolicitudTexto: string | null = null;

  const cerrar = () => {
    if (!enCurso) return;
    hechas.push(enCurso);
    enCurso = null;
  };

  /**
   * Empieza una acción. Si la anterior venía de la PROSA y no llegó a recoger
   * ningún albarán, se descarta: era el saludo, no la instrucción.
   */
  const abrir = (accion: TipoAccion, accionTexto: string | null, origen: EnCurso["origen"]) => {
    if (enCurso && enCurso.albaranes.length === 0 && enCurso.origen === "prosa") {
      enCurso = null;
    } else {
      cerrar();
    }
    enCurso = { accion, accionTexto, origen, albaranes: [] };
  };

  for (const cruda of bloque.replace(/\r\n?/g, "\n").split("\n")) {
    const linea = cruda.trim();
    if (!linea) continue;

    if (empiezaPorFecha(linea)) {
      const m = linea.match(/^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(.*)$/);
      if (m) {
        fechaSolicitudTexto ??= m[1];
        if (m[2].trim() && !persona) persona = m[2].trim();
      }
      continue;
    }

    const soloUrgencia = PALABRAS_URGENTE.includes(normalizar(linea).replace(/[.!¡]/g, "").trim());
    if (soloUrgencia) continue;

    const enLinea = leerLineaDeAlbaran(linea);
    if (enLinea) {
      avisos.push(...enLinea.avisos);
      if (enCurso) enCurso.albaranes.push(enLinea);
      else sueltos.push(enLinea.albaran);
      continue;
    }

    const verbos = verbosDe(linea, vocabulario);
    const esCabecera = palabras(linea).length <= MAXIMO_PALABRAS_CABECERA;

    if (verbos.length === 1) {
      const origen = esCabecera ? "cabecera" : "prosa";
      abrir(verbos[0].accion, matizDe(linea, verbos[0].accion, origen), origen);
      continue;
    }

    if (verbos.length > 1) {
      /*
       * «grabéis y/o modifiquéis» en la misma frase. No se elige: se dice. Si
       * después viene una cabecera explícita, ella resuelve la duda y esto
       * queda en un aviso que nadie tiene que atender.
       */
      avisos.push(
        `«${linea}» pide ${verbos.map((v) => v.accion).join(" y ")} a la vez: no se ha ` +
          `elegido por su cuenta.`
      );
      continue;
    }

    if (esCortesia(linea)) continue;

    // Ni instrucción, ni albarán, ni cortesía: es una nota de la persona.
    libres.push(linea);
  }
  cerrar();

  const acciones: AccionLeida[] = [];
  for (const a of hechas) {
    if (a.albaranes.length === 0) {
      /*
       * Pidió algo y no dijo sobre qué. Se conserva la petición —el trabajo
       * existe— con el albarán a null y confianza baja, que es lo que hace que
       * el expediente pida revisión. Rellenarla con un número de otra línea
       * sería exactamente lo que este módulo no hace.
       */
      acciones.push({
        accion: a.accion,
        accionTexto: a.accionTexto,
        albaran: null,
        importeCentimos: null,
        indicador: null,
        observaciones: "",
        confianza: 0.3,
      });
      avisos.push(`Se pide ${a.accionTexto ?? a.accion} y no se dice sobre qué albarán.`);
      continue;
    }
    for (const al of a.albaranes) {
      acciones.push({
        accion: a.accion,
        accionTexto: a.accionTexto,
        albaran: al.albaran,
        importeCentimos: al.importeCentimos,
        indicador: al.indicador,
        observaciones: al.observaciones,
        confianza: Math.min(a.origen === "cabecera" ? 1 : 0.9, al.confianzaImporte),
      });
    }
  }

  for (const s of sueltos) {
    avisos.push(`«${s}» aparece sin decir qué hay que hacer con él.`);
  }

  const todo = normalizar(bloque);
  return {
    acciones,
    albaranesAmbiguos: sueltos,
    urgente: PALABRAS_URGENTE.some((p) => todo.includes(p)),
    reclamacion: PALABRAS_RECLAMACION.some((p) => todo.includes(p)),
    persona,
    fechaSolicitudTexto,
    observaciones: libres.join("\n"),
    avisos,
  };
}
