/**
 * Cargar y comprobar los casos de calibración.
 *
 * Un caso es una carpeta con `caso.json` y sus adjuntos. Esto lo lee, lo
 * valida y dice qué le falta. Nada más: no ejecuta el parser ni sabe de él.
 *
 * ── Por qué hay un validador y no un simple `JSON.parse` ────────────────────
 *
 * Porque el fallo caro no es un caso mal formado: es un caso INCOMPLETO que
 * parece bueno. Un albarán esperado sin líneas, o con líneas cuya suma no es
 * la que dice `sumaLineasCentimos`, hace pasar al parser una prueba que no
 * comprueba nada. Aquí se caza antes de escribir una línea de parser.
 *
 * La comprobación de la suma es la que más vale: si quien escribe el ground
 * truth se equivoca sumando, el caso mentiría sobre el descuadre, que es justo
 * lo que varios casos existen para probar.
 */

import fs from "node:fs";
import path from "node:path";
import type { CasoCalibracion, LineaEsperada } from "./tipos.ts";

/** Dónde viven los casos reales (no versionados) y los sintéticos. */
export const DIR_REALES = path.join(process.cwd(), "server", "therefore", "fixtures", "reales");
export const DIR_SINTETICOS = path.join(
  process.cwd(),
  "server",
  "therefore",
  "fixtures",
  "sinteticos"
);

export type Problema = { caso: string; donde: string; mensaje: string };

/** Suma de las líneas, en céntimos. `null` si alguna no tiene importe. */
export function sumaDeLineas(lineas: readonly LineaEsperada[]): number | null {
  let total = 0;
  for (const l of lineas) {
    if (l.importeCentimos === null || l.importeCentimos === undefined) return null;
    total += l.importeCentimos;
  }
  return total;
}

/**
 * Comprueba la aritmética de una línea: cantidad × precio × (1−d₁) × (1−d₂)…
 *
 * Devuelve la diferencia en céntimos contra el importe impreso, o `null` si
 * faltan datos para calcularla. No es un fallo que no cuadre —hay documentos
 * que redondean raro—, pero tiene que poder verse.
 */
export function descuadreDeLinea(l: LineaEsperada): number | null {
  if (l.cantidad == null || l.precioUnitarioCentimos == null || l.importeCentimos == null) {
    return null;
  }
  let bruto = l.cantidad * l.precioUnitarioCentimos;
  for (const d of l.descuentos ?? []) bruto *= 1 - d.porcentaje / 100;
  return Math.round(bruto) - l.importeCentimos;
}

const ESTADOS = new Set(["OK", "REVISAR", "ERROR"]);
const MATCHES = new Set(["MATCH", "UNCERTAIN", "NO_MATCH"]);

/**
 * Valida un caso. Devuelve la lista de problemas: vacía = está bien.
 *
 * `dir` es la carpeta del caso, para poder comprobar que los adjuntos que
 * declara existen de verdad.
 */
export function validarCaso(caso: CasoCalibracion, dir?: string): Problema[] {
  const p: Problema[] = [];
  const id = caso.id || "(sin id)";
  const mal = (donde: string, mensaje: string) => p.push({ caso: id, donde, mensaje });

  if (!caso.id) mal("id", "El caso no tiene id.");
  if (!caso.descripcion) mal("descripcion", "Sin descripción no se sabe qué prueba este caso.");
  if (caso.origen !== "real-anonimizado" && caso.origen !== "sintetico") {
    mal("origen", "El origen debe ser 'real-anonimizado' o 'sintetico'.");
  }

  // El correo
  if (!caso.correo?.texto?.trim()) mal("correo.texto", "Falta el cuerpo del correo.");
  if (!caso.correo?.informacionAdicional?.trim()) {
    mal(
      "correo.informacionAdicional",
      "Falta el bloque de Información Adicional, que es donde está la petición."
    );
  }
  if (!caso.correo?.messageId) {
    mal("correo.messageId", "Sin Message-ID no se puede probar la idempotencia.");
  }

  // Los adjuntos declarados tienen que existir
  for (const a of caso.adjuntos ?? []) {
    if (dir && !fs.existsSync(path.join(dir, a.fichero))) {
      mal(`adjuntos.${a.fichero}`, "El adjunto está declarado pero el fichero no está.");
    }
  }

  // Lo esperado del correo
  const e = caso.esperado;
  if (!e) {
    mal("esperado", "El caso no trae resultado esperado: sin eso no prueba nada.");
    return p;
  }
  if (!Array.isArray(e.correo?.actuaciones)) {
    mal("esperado.correo.actuaciones", "Falta la lista de actuaciones esperadas.");
  }

  // Lo esperado del documento
  for (const [i, alb] of (e.albaranes ?? []).entries()) {
    const donde = `esperado.albaranes[${i}]`;
    if (!alb.albaranSolicitado) mal(donde, "Falta el albarán solicitado.");
    if (!MATCHES.has(alb.resultadoMatch)) {
      mal(`${donde}.resultadoMatch`, `Resultado de match desconocido: ${alb.resultadoMatch}.`);
    }
    if (!ESTADOS.has(alb.estadoAnalisis)) {
      mal(`${donde}.estadoAnalisis`, `Estado de análisis desconocido: ${alb.estadoAnalisis}.`);
    }

    /*
     * Un albarán que se espera encontrar tiene que traer líneas. Sin ellas el
     * caso pasaría aunque el parser no extrajera ninguna, que es exactamente
     * el fallo que este lote existe para detectar.
     */
    if (alb.estadoAnalisis !== "ERROR" && (alb.lineas ?? []).length === 0) {
      mal(`${donde}.lineas`, "Se espera encontrar el albarán pero no se declara ninguna línea.");
    }

    // La suma declarada tiene que ser la suma de verdad.
    const suma = sumaDeLineas(alb.lineas ?? []);
    if (suma !== null && alb.sumaLineasCentimos != null && suma !== alb.sumaLineasCentimos) {
      mal(
        `${donde}.sumaLineasCentimos`,
        `Dice ${alb.sumaLineasCentimos} pero las líneas suman ${suma}. Una de las dos cosas está mal escrita.`
      );
    }

    // Y la diferencia declarada, la diferencia de verdad.
    const importeIncidencia = e.correo?.actuaciones?.find(
      (a) => a.albaran === alb.albaranSolicitado
    )?.importeCentimos;
    if (
      suma !== null &&
      importeIncidencia != null &&
      alb.diferenciaCentimos != null &&
      suma - importeIncidencia !== alb.diferenciaCentimos
    ) {
      mal(
        `${donde}.diferenciaCentimos`,
        `Dice ${alb.diferenciaCentimos} pero suma (${suma}) − incidencia (${importeIncidencia}) = ${suma - importeIncidencia}.`
      );
    }

    /*
     * «REVISAR» sin motivo es un comodín: haría pasar el caso por el motivo
     * equivocado. Si se espera revisión, hay que decir qué validación falla.
     */
    if (alb.estadoAnalisis !== "OK" && (alb.validacionesNoConformes ?? []).length === 0) {
      mal(
        `${donde}.validacionesNoConformes`,
        `Se espera ${alb.estadoAnalisis} pero no se dice qué validación falla: el caso pasaría por el motivo equivocado.`
      );
    }

    // Descuentos: el orden es parte del dato, no un detalle.
    for (const [j, l] of (alb.lineas ?? []).entries()) {
      const ordenes = (l.descuentos ?? []).map((d) => d.orden);
      const esperados = ordenes.map((_, k) => k + 1);
      if (ordenes.join(",") !== esperados.join(",")) {
        mal(
          `${donde}.lineas[${j}].descuentos`,
          `Los descuentos tienen que ir numerados 1, 2, 3… y vienen ${ordenes.join(", ") || "(vacío)"}.`
        );
      }
    }
  }

  return p;
}

export type CasoCargado = { caso: CasoCalibracion; dir: string; problemas: Problema[] };

/** Lee un caso de su carpeta. */
export function cargarCaso(dir: string): CasoCargado {
  const fichero = path.join(dir, "caso.json");
  const caso = JSON.parse(fs.readFileSync(fichero, "utf8")) as CasoCalibracion;
  return { caso, dir, problemas: validarCaso(caso, dir) };
}

/** Lee todos los casos de una carpeta. Si no existe, devuelve lista vacía. */
export function cargarCasos(raiz: string): CasoCargado[] {
  if (!fs.existsSync(raiz)) return [];
  return fs
    .readdirSync(raiz, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(raiz, d.name))
    .filter((dir) => fs.existsSync(path.join(dir, "caso.json")))
    .sort()
    .map(cargarCaso);
}

/** Una línea por caso, para mirar el lote de un vistazo. */
export function resumen(cargados: readonly CasoCargado[]): string {
  if (cargados.length === 0) return "No hay ningún caso.";
  return cargados
    .map(({ caso, problemas }) => {
      const albaranes = caso.esperado?.albaranes ?? [];
      const lineas = albaranes.reduce((n, a) => n + (a.lineas ?? []).length, 0);
      const estados = albaranes.map((a) => a.estadoAnalisis).join("/") || "—";
      const marca = problemas.length === 0 ? "ok" : `${problemas.length} problemas`;
      return `${caso.id.padEnd(34)} ${caso.origen.padEnd(18)} ${String(albaranes.length).padStart(2)} alb  ${String(lineas).padStart(3)} líneas  ${estados.padEnd(22)} ${marca}`;
    })
    .join("\n");
}
