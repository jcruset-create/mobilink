/**
 * Cotejar la caja del ERP contra la de Mobilink.
 *
 * Dominio puro: dos listas entran, un informe sale. Ni base de datos, ni IA, ni
 * pantalla. Quien lee la captura es otro —y puede leer mal—; lo que se decide
 * aquí es qué significa lo leído, y eso tiene que poder probarse sin depender
 * de un modelo que da respuestas distintas para la misma imagen.
 *
 * ## Lo que este módulo NO hace, y no es un olvido
 *
 * **No crea nada.** Un cotejo informa; los cobros los mete una persona por la
 * pantalla de siempre, con sus validaciones y su detalle de piezas. Crear
 * movimientos de dinero a partir de una captura es la automatización que sale
 * mal el día que el modelo lea 377,24 como 377,74 — y saldría mal en silencio,
 * porque el descuadre lo vería el arqueo tres horas después.
 *
 * **No adivina equivalencias de formas de pago.** «Datáfono Clearone» y «TPV
 * CAIXA» son etiquetas del ERP, y a qué forma de Mobilink corresponden lo dice
 * una tabla que alguien configura. Si eso lo dedujera el modelo, un día
 * decidiría distinto y el cotejo mentiría sin cambiar una línea de código.
 *
 * ## Por qué el emparejamiento manda la REFERENCIA y no el importe
 *
 * `B2_26/611` identifica una operación. «29,69 €» no: dos cobros de 50 € por
 * tarjeta el mismo día son indistinguibles por importe, y emparejarlos al azar
 * da un informe que dice «todo correcto» habiendo cruzado el de un cliente con
 * el de otro.
 *
 * Así que hay dos pasadas. Primero por referencia, que es exacta. Lo que queda
 * se intenta por importe y forma de pago, y **solo cuando no hay duda**: si dos
 * candidatos encajan igual de bien, no se elige — se declara ambiguo y lo mira
 * una persona. Un emparejamiento inventado es peor que un hueco señalado,
 * porque el hueco se ve y el invento no.
 */

import type { Centimos } from "./money.ts";

/** Una línea leída del ERP. Tal cual se leyó, sin interpretar. */
export type LineaErp = {
  /** El número de justificante del ERP, si lo hay. Solo para poder señalarla. */
  justificante?: string | null;
  /** La referencia del documento: «B2_26/611». Es la clave fuerte. */
  referencia?: string | null;
  /** La etiqueta de forma de pago TAL CUAL la escribe el ERP. */
  formaErp: string;
  /** Positivo siempre. El sentido lo da `tipo`. */
  importeCentimos: Centimos;
  tipo: "COBRO" | "PAGO";
  /** Lo que ponga el concepto, para poder enseñarlo al humano. */
  concepto?: string | null;
};

/** Una operación de Mobilink, reducida a lo que el cotejo necesita. */
export type LineaMobilink = {
  id: number;
  numero: string;
  referencia?: string | null;
  /** Código del catálogo de formas de cobro. */
  formaCodigo: string;
  importeCentimos: Centimos;
  tipo: "COBRO" | "PAGO";
  concepto?: string | null;
};

/**
 * Qué etiqueta del ERP es qué forma de Mobilink.
 *
 * Configuración, no deducción. Lo que no esté aquí no se empareja por forma de
 * pago: se dice que falta el equivalente, que es información útil —«tienes una
 * etiqueta del ERP sin configurar»— y no un fallo.
 */
export type Equivalencias = ReadonlyMap<string, string>;

/**
 * Cómo se GUARDA una etiqueta del ERP.
 *
 * Vive aquí y se exporta porque la usan los DOS extremos: quien guarda la
 * equivalencia en Configuración y quien la busca al cotejar. Si cada uno
 * normalizara a su manera, la misma etiqueta se guardaría de una forma y se
 * buscaría de otra, y el cotejo fallaría solo a ratos — que es la peor manera
 * de fallar, porque parece un problema de los datos.
 *
 * Mayúsculas y espacios colapsados. Nada más: lo que se guarda se parece a lo
 * que el usuario escribió, y los acentos y los puntos suspensivos siguen ahí
 * para que la pantalla de Configuración enseñe lo que él tecleó y no una
 * versión maltratada de su etiqueta.
 *
 * Lo tolerante viene aparte, en `claveDeCotejo`.
 */
export function etiquetaNormalizada(etiqueta: string): string {
  return etiqueta.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Cómo se COMPARA una etiqueta del ERP. Encima de la anterior, no en su lugar.
 *
 * El ERP corta la columna de forma de pago según la resolución de la pantalla.
 * La misma etiqueta se ve «Datáfono Clearon...» en un monitor y «Datáfono
 * Clearone ta...» en otro, y ninguna de las dos es la etiqueta entera. Comparar
 * eso letra a letra es hacer que el cotejo dependa de con qué PC se hizo la
 * captura, que no tiene nada que ver con la caja.
 *
 * Así que para comparar se quitan dos cosas que no distinguen nada:
 *
 * · **Los acentos.** El modelo lee «Datafono» tan a menudo como «Datáfono», y
 *   dos formas de pago que solo se diferencien en una tilde no existen.
 * · **Los puntos del recorte al final.** Son del ancho de la columna, no del
 *   nombre.
 *
 * Lo que NO se quita es nada de en medio: el recorte se resuelve comparando por
 * prefijo en `resolverFormaErp`, con su regla de no elegir cuando hay dudas.
 */
export function claveDeCotejo(etiqueta: string): string {
  return (
    etiquetaNormalizada(etiqueta)
      /* NFD separa la tilde de la letra; el rango borra las tildes sueltas. */
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.\u2026]+$/, "")
      .trimEnd()
  );
}

/**
 * Cuántas letras tiene que haber para fiarse de un prefijo.
 *
 * Con menos, «TP» emparejaría con cualquier cosa que empiece por ahí y el
 * emparejamiento diría más del azar que de la etiqueta. Una lectura tan corta
 * es además señal de que la captura vino mal, y ahí lo que toca es decirlo, no
 * adivinar.
 */
const MINIMO_PARA_PREFIJO = 4;

/** A qué forma de Mobilink corresponde una etiqueta del ERP, y con cuánta certeza. */
export type ResolucionDeForma =
  | { estado: "resuelta"; codigo: string; /** La etiqueta configurada con la que casó. */ configurada: string; /** Ha hecho falta comparar por prefijo. */ porRecorte: boolean }
  /** El recorte encaja con varias equivalencias configuradas. No se elige. */
  | { estado: "ambigua"; candidatas: string[] }
  | { estado: "sinConfigurar" };

/**
 * Buscar la equivalencia de una etiqueta del ERP, aguantando el recorte.
 *
 * Tres intentos, de más seguro a menos:
 *
 * 1. **Igual.** Comparando por `claveDeCotejo`, así que la tilde y los puntos
 *    finales ya no estorban.
 * 2. **Una es prefijo de la otra.** En los dos sentidos, y esto no es simetría
 *    gratuita: la etiqueta guardada también puede venir recortada, porque quien
 *    la configuró la copió de SU pantalla. Con una captura de un monitor más
 *    ancho, lo largo es lo leído y lo corto lo guardado.
 * 3. **Nada.** Se dice que falta configurarla.
 *
 * Y en el paso 2, **si encajan varias no se elige ninguna**. Es la misma regla
 * que gobierna el emparejamiento de líneas: un acierto inventado es peor que un
 * hueco señalado, porque el hueco se ve y el invento no. Con «Datáfono...»
 * recortado y dos datáfonos configurados, elegir uno sería mandar cobros de
 * tarjeta contra la forma equivocada sin que nada chirríe.
 */
export function resolverFormaErp(
  formaErp: string,
  equivalencias: Equivalencias
): ResolucionDeForma {
  const clave = claveDeCotejo(formaErp);
  if (!clave) return { estado: "sinConfigurar" };

  const exactas: { configurada: string; codigo: string }[] = [];
  const porPrefijo: { configurada: string; codigo: string }[] = [];

  for (const [configurada, codigo] of equivalencias) {
    const suya = claveDeCotejo(configurada);
    if (!suya) continue;

    if (suya === clave) {
      exactas.push({ configurada, codigo });
      continue;
    }
    const corta = suya.length < clave.length ? suya : clave;
    if (corta.length < MINIMO_PARA_PREFIJO) continue;
    if (suya.startsWith(clave) || clave.startsWith(suya)) {
      porPrefijo.push({ configurada, codigo });
    }
  }

  /*
   * Las exactas mandan sobre las de prefijo SIEMPRE, aunque haya diez prefijos
   * que también encajen. Si alguien ha configurado la etiqueta entera, eso es
   * lo que quería decir; ponerlas a competir convertiría una equivalencia bien
   * puesta en ambigua por culpa de otra que solo se le parece.
   */
  const candidatos = exactas.length > 0 ? exactas : porPrefijo;
  if (candidatos.length === 0) return { estado: "sinConfigurar" };

  /*
   * Varias que apuntan al MISMO código no son ninguna duda: da igual cuál se
   * coja, la respuesta es la misma. Pasa solo con configurarla acentuada y sin
   * acentuar, que es justo lo que `claveDeCotejo` viene a perdonar.
   */
  const codigos = new Set(candidatos.map((c) => c.codigo));
  if (codigos.size > 1) {
    return { estado: "ambigua", candidatas: candidatos.map((c) => c.configurada).sort() };
  }

  const elegida = candidatos[0]!;
  return {
    estado: "resuelta",
    codigo: elegida.codigo,
    configurada: elegida.configurada,
    porRecorte: exactas.length === 0,
  };
}

export type Emparejada = {
  erp: LineaErp;
  mobilink: LineaMobilink;
  /** Por qué se emparejaron. Se enseña: no es lo mismo una que otra. */
  por: "referencia" | "importe";
};

/**
 * Mismo importe, distinta forma de pago.
 *
 * Ni cuadra ni es un hueco: es LA MISMA operación con algo que no encaja, y
 * merece su propia categoría porque tiene dos causas muy distintas y las dos
 * hay que poder verlas:
 *
 * · **El cobro se metió con la forma equivocada.** El dinero está, pero el
 *   arqueo descuadrará por ese importe. Es un error de verdad.
 *
 * · **El modelo leyó mal la columna.** Pasó el primer día de uso: el ERP decía
 *   CONTADO y el modelo copió el «Datáfono Clearone ta...» de las filas de al
 *   lado. La comprobación contra el total impreso NO lo caza, porque los
 *   importes estaban bien.
 *
 * Antes esto salía como dos líneas sueltas —una en «falta» y otra en «sobra»—
 * sin decir en ningún sitio que fueran el mismo importe. Funcionaba: la
 * información estaba. Pero el trabajo de verlo se lo dejaba entero al que
 * miraba, que es justo lo que este cotejo venía a evitar.
 */
export type DiscrepanciaDeForma = {
  erp: LineaErp;
  mobilink: LineaMobilink;
  /** La forma que le corresponde a la etiqueta del ERP, si está configurada. */
  formaEsperada: string | null;
};

export type Ambigua = {
  erp: LineaErp;
  /** Los que encajaban igual de bien. Ninguno se ha elegido. */
  candidatos: LineaMobilink[];
};

export type Informe = {
  /** Cuadran: misma referencia o mismo importe y forma, sin duda. */
  emparejadas: Emparejada[];
  /** Está en el ERP y no en Mobilink. */
  soloEnErp: LineaErp[];
  /** Está en Mobilink y no en el ERP. */
  soloEnMobilink: LineaMobilink[];
  /** Encajaba con varios. No se elige por su cuenta. */
  ambiguas: Ambigua[];
  /** Mismo importe a los dos lados, pero la forma de pago no coincide. */
  discrepanciasDeForma: DiscrepanciaDeForma[];
  /** Etiquetas del ERP que no están en la tabla de equivalencias. */
  formasSinEquivalencia: string[];
  /**
   * Etiquetas recortadas que encajan con VARIAS equivalencias configuradas.
   *
   * No es lo mismo que no tenerla: la equivalencia está, lo que falta es saber
   * cuál. Decir «sin configurar» mandaría a alguien a crear una que ya existe.
   */
  formasAmbiguas: { etiqueta: string; candidatas: string[] }[];
  /**
   * Las que han hecho falta resolver por prefijo, y contra qué.
   *
   * Se enseña porque es una deducción, no un dato: la equivalencia se ha
   * decidido comparando un trozo de etiqueta. Con esto delante, el día que
   * empareje mal se ve; sin esto, el cotejo daría por bueno algo que nadie
   * llegó a configurar del todo.
   */
  formasPorRecorte: { etiqueta: string; configurada: string }[];
  totales: {
    erpCobros: Centimos;
    erpPagos: Centimos;
    mobilinkCobros: Centimos;
    mobilinkPagos: Centimos;
    /** ERP menos Mobilink. Cero en las dos = los totales cuadran. */
    diferenciaCobros: Centimos;
    diferenciaPagos: Centimos;
  };
  /**
   * Todo cuadra: nada suelto por ningún lado, nada ambiguo y los totales a cero.
   *
   * Se exige lo uno Y lo otro a propósito. Con solo los totales, un cobro de
   * más y uno de menos por el mismo importe darían «correcto» habiendo dos
   * errores; con solo las líneas, un céntimo de diferencia en un importe
   * emparejado por referencia pasaría desapercibido.
   */
  cuadra: boolean;
};

/** La referencia, normalizada: es lo único que se compara entre dos sistemas. */
function normalizarReferencia(r: string | null | undefined): string | null {
  if (!r) return null;
  /*
   * Fuera espacios, guiones, barras y puntos, y todo a mayúsculas. El mismo
   * documento se escribe «B2_26/611», «B2 26/611» y «b2-26-611» según quién lo
   * teclee o cómo lo lea el modelo, y sin esto el cotejo cae a emparejar por
   * importe justo cuando tenía la clave buena delante.
   */
  const limpia = r.trim().toUpperCase().replace(/[\s\-/._]/g, "");
  return limpia || null;
}

export function cotejar(
  erp: readonly LineaErp[],
  mobilink: readonly LineaMobilink[],
  equivalencias: Equivalencias
): Informe {
  const emparejadas: Emparejada[] = [];
  const ambiguas: Ambigua[] = [];
  const discrepanciasDeForma: DiscrepanciaDeForma[] = [];
  const sinEquivalencia = new Set<string>();
  const ambiguasDeForma = new Map<string, string[]>();
  const porRecorte = new Map<string, string>();

  /*
   * La resolución se cachea por etiqueta. No es por velocidad —el mapa tiene
   * cuatro filas— sino porque la misma etiqueta se resuelve en la segunda
   * pasada y otra vez en la tercera, y que las dos vean lo mismo es lo que
   * hace que `formaEsperada` concuerde con lo que se intentó emparejar.
   */
  const cache = new Map<string, ResolucionDeForma>();
  const resolver = (formaErp: string): ResolucionDeForma => {
    const guardada = cache.get(formaErp);
    if (guardada) return guardada;
    const r = resolverFormaErp(formaErp, equivalencias);
    cache.set(formaErp, r);
    if (r.estado === "resuelta" && r.porRecorte) {
      porRecorte.set(formaErp.trim(), r.configurada);
    } else if (r.estado === "ambigua") {
      ambiguasDeForma.set(formaErp.trim(), r.candidatas);
    }
    return r;
  };

  /* Lo que queda por emparejar de cada lado. Se va vaciando. */
  const pendientesErp = [...erp];
  const pendientesMob = [...mobilink];

  const sacar = (lista: LineaMobilink[], l: LineaMobilink) => {
    const i = lista.indexOf(l);
    if (i >= 0) lista.splice(i, 1);
  };

  // ── Primera pasada: por referencia, que es exacta ──────────────────────────
  for (const e of [...pendientesErp]) {
    const ref = normalizarReferencia(e.referencia);
    if (!ref) continue;

    const iguales = pendientesMob.filter(
      (m) => m.tipo === e.tipo && normalizarReferencia(m.referencia) === ref
    );
    /*
     * Con más de uno tampoco se elige. Dos operaciones de Mobilink con la misma
     * referencia y el mismo tipo es en sí un problema —un cobro duplicado— y
     * taparlo emparejando una al azar es justo lo contrario de lo que se pide.
     */
    if (iguales.length === 1) {
      emparejadas.push({ erp: e, mobilink: iguales[0]!, por: "referencia" });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
      sacar(pendientesMob, iguales[0]!);
    } else if (iguales.length > 1) {
      ambiguas.push({ erp: e, candidatos: iguales });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
    }
  }

  // ── Segunda pasada: por importe y forma, y solo sin dudas ──────────────────
  for (const e of [...pendientesErp]) {
    const resolucion = resolver(e.formaErp);
    if (resolucion.estado !== "resuelta") {
      /*
       * Sin equivalencia NO se empareja por importe a secas. Sería colar un
       * cobro por tarjeta contra uno en efectivo del mismo importe, que es
       * precisamente el error que este cotejo tiene que encontrar. Y con la
       * equivalencia ambigua, tampoco: saber que es UNA de dos no es saber cuál.
       */
      if (resolucion.estado === "sinConfigurar") sinEquivalencia.add(e.formaErp.trim());
      continue;
    }
    const codigo = resolucion.codigo;

    const encajan = pendientesMob.filter(
      (m) =>
        m.tipo === e.tipo &&
        m.importeCentimos === e.importeCentimos &&
        m.formaCodigo === codigo
    );
    if (encajan.length === 1) {
      emparejadas.push({ erp: e, mobilink: encajan[0]!, por: "importe" });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
      sacar(pendientesMob, encajan[0]!);
    } else if (encajan.length > 1) {
      ambiguas.push({ erp: e, candidatos: encajan });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
    }
  }

  // ── Tercera pasada: mismo importe, forma distinta ─────────────────────────
  //
  // Va LA ÚLTIMA a propósito. Solo llegan aquí las líneas que no encontraron
  // pareja ni por referencia ni por importe+forma, así que emparejar por
  // importe a secas ya no puede robarle la pareja buena a nadie.
  //
  // Y sigue exigiendo que no haya dudas: con dos candidatos del mismo importe
  // no se elige, se declara ambigua. La regla de no inventar emparejamientos
  // no se relaja aquí; lo que se relaja es la forma de pago, y por eso el
  // resultado se cuenta aparte y NO como cuadrado.
  for (const e of [...pendientesErp]) {
    const encajan = pendientesMob.filter(
      (m) => m.tipo === e.tipo && m.importeCentimos === e.importeCentimos
    );
    if (encajan.length === 1) {
      discrepanciasDeForma.push({
        erp: e,
        mobilink: encajan[0]!,
        formaEsperada: (() => {
          const r = resolver(e.formaErp);
          return r.estado === "resuelta" ? r.codigo : null;
        })(),
      });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
      sacar(pendientesMob, encajan[0]!);
    } else if (encajan.length > 1) {
      ambiguas.push({ erp: e, candidatos: encajan });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
    }
  }

  const suma = (ls: readonly { importeCentimos: Centimos; tipo: string }[], t: string) =>
    ls.filter((l) => l.tipo === t).reduce((a, l) => a + l.importeCentimos, 0);

  const erpCobros = suma(erp, "COBRO");
  const erpPagos = suma(erp, "PAGO");
  const mobilinkCobros = suma(mobilink, "COBRO");
  const mobilinkPagos = suma(mobilink, "PAGO");

  const totales = {
    erpCobros,
    erpPagos,
    mobilinkCobros,
    mobilinkPagos,
    diferenciaCobros: erpCobros - mobilinkCobros,
    diferenciaPagos: erpPagos - mobilinkPagos,
  };

  return {
    emparejadas,
    soloEnErp: pendientesErp,
    soloEnMobilink: pendientesMob,
    ambiguas,
    discrepanciasDeForma,
    formasSinEquivalencia: [...sinEquivalencia].sort(),
    formasAmbiguas: [...ambiguasDeForma]
      .map(([etiqueta, candidatas]) => ({ etiqueta, candidatas }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)),
    formasPorRecorte: [...porRecorte]
      .map(([etiqueta, configurada]) => ({ etiqueta, configurada }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)),
    totales,
    cuadra:
      pendientesErp.length === 0 &&
      pendientesMob.length === 0 &&
      ambiguas.length === 0 &&
      discrepanciasDeForma.length === 0 &&
      totales.diferenciaCobros === 0 &&
      totales.diferenciaPagos === 0,
  };
}
