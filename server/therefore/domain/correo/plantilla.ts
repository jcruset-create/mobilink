/**
 * La parte del correo que escribe Therefore siempre igual.
 *
 * Un correo de Therefore tiene dos mitades muy distintas. Ésta es la de la
 * PLANTILLA: el asunto, los campos con su etiqueta —proveedor, factura, fecha,
 * importe— y, en las aprobaciones, el enlace al flujo de trabajo. Es regular,
 * la genera una máquina y se puede leer con confianza alta.
 *
 * La otra mitad —el bloque «Información Adicional»— la escribe una persona y no
 * se parece a sí misma dos veces. Vive en `acciones.ts`.
 *
 * ── Lo que aquí NO se hace ──────────────────────────────────────────────────
 *
 * No se fijan proveedores, ni números de factura, ni sociedades. Lo único que
 * este fichero sabe es cómo se llaman las ETIQUETAS y qué forma tiene el asunto,
 * que es el formato y no los datos. Un proveedor nuevo no toca una línea de
 * aquí, y una etiqueta nueva se añade a su lista sin desplegar.
 */

import type { TipoExpediente } from "../estados.ts";
import { leerFecha, leerImporte, type ImporteLeido } from "./importes.ts";
import { normalizar, sinPuntoFinal } from "./texto.ts";

/* ── El vocabulario de la plantilla ──────────────────────────────────────── */

/**
 * Los nombres con los que puede venir cada campo.
 *
 * Están en una lista y no en una expresión regular escrita a mano para que
 * añadir una variante —otra instalación de Therefore, otro idioma— sea añadir
 * una cadena. Se comparan sin acentos y sin mayúsculas.
 */
export type VocabularioPlantilla = {
  proveedorCodigo: string[];
  proveedorNombre: string[];
  cuentaContable: string[];
  facturaNumero: string[];
  facturaFecha: string[];
  importe: string[];
  bloqueLibre: string[];
};

export const VOCABULARIO_PLANTILLA: VocabularioPlantilla = {
  proveedorCodigo: ["codigo proveedor", "cod. proveedor", "cod proveedor"],
  proveedorNombre: ["razon social", "proveedor", "nombre proveedor"],
  cuentaContable: ["cuenta contable", "cuenta"],
  facturaNumero: ["numero factura", "n factura", "nº factura", "num. factura", "factura"],
  facturaFecha: ["fecha factura", "fecha de factura"],
  importe: ["importe", "importe factura", "total factura"],
  bloqueLibre: ["informacion adicional", "observaciones"],
};

/* ── Qué clase de correo es ──────────────────────────────────────────────── */

export type Clasificacion = {
  tipo: TipoExpediente;
  /** Ortogonal al tipo: una tarea vencida ES una aprobación que se retrasa. */
  tareaVencida: boolean;
  /** Frases que lo decidieron, para poder explicarlo en la pantalla. */
  porque: string[];
};

const PISTAS_APROBACION = ["apruebe la factura", "aprobacion de factura"];
const PISTAS_INCIDENCIA = ["incidencia en factura", "incidencia de la factura"];
const PISTAS_VENCIDA = ["tarea vencida", "han pasado"];

export function clasificar(asunto: string, texto: string): Clasificacion {
  const todo = normalizar(`${asunto}\n${texto}`).toLowerCase();
  const porque: string[] = [];

  const tareaVencida = PISTAS_VENCIDA.some((p) => {
    if (!todo.includes(p)) return false;
    porque.push(`dice «${p}»`);
    return true;
  });

  for (const p of PISTAS_APROBACION) {
    if (todo.includes(p)) {
      porque.push(`dice «${p}»`);
      return { tipo: "APROBACION_FACTURA", tareaVencida, porque };
    }
  }
  for (const p of PISTAS_INCIDENCIA) {
    if (todo.includes(p)) {
      porque.push(`dice «${p}»`);
      return { tipo: "INCIDENCIA_ALBARAN", tareaVencida, porque };
    }
  }

  /*
   * Ni una cosa ni la otra. OTRO no es un fallo: es el cajón honesto. El
   * expediente se abre igual y alguien lo mira, que es mejor que forzarlo a
   * INCIDENCIA_ALBARAN y que aparezca en la cola equivocada.
   */
  return { tipo: "OTRO", tareaVencida, porque: [...porque, "no dice de qué va"] };
}

/* ── La sociedad de la que habla el correo ───────────────────────────────── */

export type EmpresaLeida = { codigo: string; nombre: string } | null;

/**
 * La sociedad del ERP, que NO es el tenant de Mobilink.
 *
 * Viene de dos maneras según el tipo de correo —`Empresa 007 Comercial X` en
 * las incidencias y `007-Comercial X` en las aprobaciones— y las dos se
 * admiten. Lo que no se hace es fijar una lista de sociedades: una instalación
 * con tres sociedades tiene que funcionar sin tocar código.
 */
export function leerEmpresa(asunto: string, texto: string): EmpresaLeida {
  const limpio = (s: string) => s.replace(/[:\s]+$/, "").trim();

  for (const fuente of [asunto, texto]) {
    const conEtiqueta = fuente.match(/\bEmpresa\s+(\d+)[\s-]+([^\n:]+)/i);
    if (conEtiqueta) {
      return { codigo: conEtiqueta[1], nombre: limpio(conEtiqueta[2]) };
    }
  }

  // `Tarea vencida. Aprobación de Factura recibida. 007-Comercial Ejemplo_New`
  const cola = asunto.split(".").pop() ?? "";
  const guion = cola.trim().match(/^(\d+)\s*-\s*(.+)$/);
  if (guion) return { codigo: guion[1], nombre: limpio(guion[2]) };

  return null;
}

/* ── Los campos con etiqueta ─────────────────────────────────────────────── */

export type CamposPlantilla = {
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  cuentaContable: string | null;
  facturaNumero: string | null;
  facturaFecha: string | null;
  importe: ImporteLeido;
  /** El número de instancia del flujo de Therefore, si el correo trae enlace. */
  casoReferencia: string | null;
  enlace: string | null;
};

/** Devuelve el valor del primer campo cuya etiqueta coincida. */
function valorDe(texto: string, etiquetas: readonly string[]): string | null {
  for (const linea of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const dosPuntos = linea.indexOf(":");
    if (dosPuntos < 0) continue;

    const etiqueta = normalizar(linea.slice(0, dosPuntos)).toLowerCase().trim();
    if (!etiquetas.includes(etiqueta)) continue;

    const valor = linea.slice(dosPuntos + 1).trim();
    if (valor) return valor;
  }
  return null;
}

export function leerCampos(
  texto: string,
  vocabulario: VocabularioPlantilla = VOCABULARIO_PLANTILLA
): CamposPlantilla {
  const crudo = (etiquetas: readonly string[]) => valorDe(texto, etiquetas);

  const nombre = crudo(vocabulario.proveedorNombre);
  const enlace = texto.match(/https?:\/\/\S+/)?.[0] ?? null;

  /*
   * De la URL del flujo interesa el número de instancia, que es lo que
   * identifica el expediente EN THEREFORE. Se guarda como referencia del caso:
   * cuando alguien pregunte por un expediente citando ese número, se encuentra.
   */
  const instancia = enlace?.match(/\/instance\/(\d+)/)?.[1] ?? null;

  return {
    proveedorCodigo: crudo(vocabulario.proveedorCodigo)
      ? sinPuntoFinal(crudo(vocabulario.proveedorCodigo)!, "numero")
      : null,
    proveedorNombre: nombre ? sinPuntoFinal(nombre, "texto") : null,
    cuentaContable: crudo(vocabulario.cuentaContable)
      ? sinPuntoFinal(crudo(vocabulario.cuentaContable)!, "numero")
      : null,
    facturaNumero: crudo(vocabulario.facturaNumero)
      ? sinPuntoFinal(crudo(vocabulario.facturaNumero)!, "numero")
      : null,
    facturaFecha: leerFecha(
      crudo(vocabulario.facturaFecha)
        ? sinPuntoFinal(crudo(vocabulario.facturaFecha)!, "numero")
        : null
    ),
    importe: leerImporte(
      crudo(vocabulario.importe) ? sinPuntoFinal(crudo(vocabulario.importe)!, "numero") : null
    ),
    casoReferencia: instancia,
    enlace,
  };
}

/* ── El bloque que escribe la persona ────────────────────────────────────── */

/**
 * Recorta el bloque libre, **tal y como está escrito**.
 *
 * Empieza detrás de su etiqueta y termina donde empieza el primer campo de la
 * plantilla. No se normaliza nada por dentro: ni espacios, ni saltos, ni
 * mayúsculas. Es la instrucción de una persona y es lo que hay que mirar cuando
 * el parser se equivoque; reformatearlo sería perder la prueba.
 *
 * Sólo se quitan los saltos de línea de los extremos, que son del recorte y no
 * del texto.
 */
export function recortarBloqueLibre(
  texto: string,
  vocabulario: VocabularioPlantilla = VOCABULARIO_PLANTILLA
): string {
  const plano = texto.replace(/\r\n?/g, "\n");
  const filas = plano.split("\n");

  const esEtiquetaDe = (linea: string, etiquetas: readonly string[]) => {
    const dosPuntos = linea.indexOf(":");
    if (dosPuntos < 0) return false;
    return etiquetas.includes(normalizar(linea.slice(0, dosPuntos)).toLowerCase().trim());
  };

  const inicio = filas.findIndex((l) => esEtiquetaDe(l, vocabulario.bloqueLibre));
  if (inicio < 0) return "";

  // Lo que venga en la misma línea de la etiqueta cuenta: `Información
  // Adicional: URGENTE` es tan válido como ponerlo debajo.
  const primeraLinea = filas[inicio].slice(filas[inicio].indexOf(":") + 1);

  const resto: string[] = [];
  const camposPlantilla = [
    ...vocabulario.proveedorCodigo,
    ...vocabulario.proveedorNombre,
    ...vocabulario.cuentaContable,
    ...vocabulario.facturaNumero,
    ...vocabulario.facturaFecha,
    ...vocabulario.importe,
  ];

  for (let i = inicio + 1; i < filas.length; i++) {
    if (esEtiquetaDe(filas[i], camposPlantilla)) break;
    resto.push(filas[i]);
  }

  return [primeraLinea, ...resto].join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
}
