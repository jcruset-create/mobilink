/**
 * De un correo de Therefore a los campos con los que trabaja el módulo.
 *
 * Es la puerta del parser: `parsearCorreo(asunto, texto)` y sale todo lo que la
 * ingesta necesita, con una confianza por acción y una lista de avisos que
 * explican, en castellano, por qué algo quedó dudoso.
 *
 * Código PURO: ni base de datos, ni red, ni IA. Se prueba con un asunto y un
 * texto, que es como se puede probar de verdad un parser.
 *
 * ── Qué significa la confianza ──────────────────────────────────────────────
 *
 * No es una probabilidad: es «cuánto de esto he leído y cuánto he supuesto».
 * Por debajo del umbral, el expediente nace pidiendo revisión y alguien lo
 * mira. Es la diferencia entre un parser que se equivoca en silencio y uno que
 * levanta la mano.
 */

import type { TipoExpediente } from "../estados.ts";
import {
  RAICES_ACCION,
  leerBloque,
  type AccionLeida,
  type VocabularioAcciones,
} from "./acciones.ts";
import {
  VOCABULARIO_PLANTILLA,
  clasificar,
  leerCampos,
  leerEmpresa,
  recortarBloqueLibre,
  type VocabularioPlantilla,
} from "./plantilla.ts";

export type CorreoParseado = {
  tipo: TipoExpediente;
  tareaVencida: boolean;
  urgente: boolean;
  reclamacion: boolean;

  empresaCodigo: string | null;
  empresaNombre: string | null;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  cuentaContable: string | null;
  facturaNumero: string | null;
  facturaFecha: string | null;
  /** El total de la FACTURA. No es el importe del albarán. */
  importeCentimos: number | null;
  casoReferencia: string | null;

  persona: string | null;
  fechaSolicitudTexto: string | null;
  /** El bloque libre, exactamente como venía. */
  informacionAdicional: string;
  /** Lo que la persona escribió y no era ni instrucción ni albarán. */
  observaciones: string;

  acciones: AccionLeida[];
  albaranesAmbiguos: string[];

  avisos: string[];
  confianza: number;
};

export type OpcionesParser = {
  plantilla?: VocabularioPlantilla;
  acciones?: VocabularioAcciones;
};

export function parsearCorreo(
  asunto: string,
  texto: string,
  opciones: OpcionesParser = {}
): CorreoParseado {
  const vocPlantilla = opciones.plantilla ?? VOCABULARIO_PLANTILLA;
  const vocAcciones = opciones.acciones ?? RAICES_ACCION;

  const { tipo, tareaVencida } = clasificar(asunto, texto);
  const empresa = leerEmpresa(asunto, texto);
  const campos = leerCampos(texto, vocPlantilla);
  const informacionAdicional = recortarBloqueLibre(texto, vocPlantilla);
  const bloque = leerBloque(informacionAdicional, vocAcciones);

  const avisos = [...bloque.avisos];
  if (campos.importe.motivo) avisos.push(campos.importe.motivo);

  const acciones = [...bloque.acciones];

  /*
   * Una aprobación no trae bloque libre: el trabajo es la propia aprobación.
   * Se le da su actuación para que el expediente tenga algo que resolver; sin
   * ella sería el único tipo que se cierra sin haber hecho nada.
   *
   * Una TAREA VENCIDA no la lleva. No pide nada nuevo: es el mismo trabajo, que
   * sigue sin hacerse. Darle su propia actuación llenaría el expediente de
   * «aprobar» repetidos, uno por recordatorio.
   */
  if (tipo === "APROBACION_FACTURA" && !tareaVencida && acciones.length === 0) {
    acciones.push({
      accion: "APROBAR",
      accionTexto: "Aprobar la factura",
      albaran: null,
      importeCentimos: null,
      indicador: null,
      observaciones: "",
      confianza: 1,
    });
  }

  /* ── La confianza ─────────────────────────────────────────────────────── */

  const factores: number[] = [campos.importe.centimos === null ? 1 : campos.importe.confianza];

  if (tipo === "OTRO") {
    factores.push(0.5);
    avisos.push("No se ha sabido de qué va el correo: ni incidencia, ni aprobación.");
  }
  if (!empresa) {
    factores.push(0.5);
    avisos.push("No se ha encontrado la sociedad en el asunto ni en el cuerpo.");
  }
  if (!campos.facturaNumero) {
    factores.push(0.6);
    avisos.push("No se ha encontrado el número de factura.");
  }
  if (tipo === "INCIDENCIA_ALBARAN" && acciones.length === 0) {
    factores.push(0.3);
    avisos.push("Es una incidencia y no se ha entendido qué hay que hacer.");
  }
  for (const a of acciones) factores.push(a.confianza);
  if (bloque.albaranesAmbiguos.length > 0) factores.push(0.5);

  return {
    tipo,
    tareaVencida,
    urgente: bloque.urgente,
    reclamacion: bloque.reclamacion || tareaVencida,

    empresaCodigo: empresa?.codigo ?? null,
    empresaNombre: empresa?.nombre ?? null,
    proveedorCodigo: campos.proveedorCodigo,
    proveedorNombre: campos.proveedorNombre,
    cuentaContable: campos.cuentaContable,
    facturaNumero: campos.facturaNumero,
    facturaFecha: campos.facturaFecha,
    importeCentimos: campos.importe.centimos,
    casoReferencia: campos.casoReferencia,

    persona: bloque.persona,
    fechaSolicitudTexto: bloque.fechaSolicitudTexto,
    informacionAdicional,
    observaciones: bloque.observaciones,

    acciones,
    albaranesAmbiguos: bloque.albaranesAmbiguos,

    avisos,
    confianza: Math.min(1, ...factores),
  };
}

export { leerBloque, leerLineaDeAlbaran, RAICES_ACCION } from "./acciones.ts";
export type { AccionLeida, BloqueLeido, VocabularioAcciones } from "./acciones.ts";
export { leerImporte, leerFecha } from "./importes.ts";
export type { ImporteLeido } from "./importes.ts";
export {
  VOCABULARIO_PLANTILLA,
  clasificar,
  leerCampos,
  leerEmpresa,
  recortarBloqueLibre,
} from "./plantilla.ts";
export type { CamposPlantilla, Clasificacion, VocabularioPlantilla } from "./plantilla.ts";
