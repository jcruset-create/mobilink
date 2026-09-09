/**
 * Preparar una sustitución. En esta fase, NO ejecutarla.
 *
 * ── Dónde se para ───────────────────────────────────────────────────────────
 *
 * El handler recorre todas las fases —validar llaves, resolver empresa, leer el
 * estado actual, comprobar el saliente, el entrante, el destino y la medida— y
 * se detiene justo antes de llamar al RPC, devolviendo `READY_BUT_DISABLED`.
 *
 * El freno está DENTRO del handler, no en quien lo llama. Una protección que
 * depende de que cada sitio se acuerde de mirarla es una protección que un día
 * no se mira, y aquí lo que hay al otro lado mueve dos neumáticos y consume
 * stock.
 *
 * ── Y por qué eso no es un simulacro vacío ──────────────────────────────────
 *
 * Todo lo que se comprueba hasta ese punto es real: se lee TyreControl de
 * verdad, se compara con lo que Assist creía y se valida la medida. Lo único
 * que no ocurre es la escritura. Cuando se encienda la llave, lo único que
 * cambia es que la última línea deja de devolver y llama.
 */

import { clienteTyreControl } from "./sesion.ts";
import { estadoDeVehiculo } from "./estadoVehiculo.ts";
import {
  datosParaRpc, sincronizacionSustitucionActiva, tieneIdentidad,
  type Condicion, type DestinoRetirado, type IdentidadEntrante, type MotivoDesmontaje,
} from "./sustitucion.ts";

export type PlanSustitucion = {
  assistanceId: number;
  tcEmpresaId: string;
  tcVehicleId: string;
  codigoPosicion: string;
  /** Lo que Assist creía que había ahí. Si ya no es así, se para. */
  montajeEsperado?: string | null;
  neumaticoSalienteEsperado?: string | null;
  productoAlmacenId: string;
  condicion: Condicion;
  destinoRetirado: DestinoRetirado;
  motivoDesmontaje: MotivoDesmontaje;
  identidad: IdentidadEntrante;
  observaciones: string | null;
};

/** Lo que se le pasaría al RPC. Se calcula siempre, se envía solo si procede. */
export type LlamadaPrevista = {
  rpc: "tc_sustituir_neumatico";
  argumentos: Record<string, unknown>;
};

export type Preparacion =
  | {
      estado: "READY_BUT_DISABLED";
      llamada: LlamadaPrevista;
      situacion: SituacionSustitucion;
      avisos: string[];
    }
  | { estado: "CONFLICT"; motivo: string }
  | { estado: "BLOCKED"; codigo: string; motivo: string }
  | { estado: "RETRY"; codigo: string; motivo: string };

export type SituacionSustitucion = {
  posicionId: string;
  montajeActualId: string | null;
  neumaticoSalienteId: string | null;
  estadoSaliente: string | null;
  medidaSaliente: string | null;
  /** Del producto elegido, para poder comparar medidas antes del RPC. */
  medidaEntrante: string | null;
  disponibleEnAlmacen: number | null;
};

/**
 * Stock del almacén de la empresa, por producto.
 *
 * Sale de `tc_stock_almacen_empresa`, que ya comprueba permisos y devuelve las
 * cantidades de nuevo y usado. No se leen las tablas del almacén a mano: eso
 * sería reimplementar en Assist una cuenta que TC ya sabe hacer.
 */
export async function stockDeEmpresa(tcEmpresaId: string): Promise<{
  productoId: string; marca: string | null; modelo: string | null; medida: string | null;
  nuevo: number; usado: number;
}[]> {
  const cliente = await clienteTyreControl();
  const { data, error } = await cliente.rpc("tc_stock_almacen_empresa", { p_empresa: tcEmpresaId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((f: any) => ({
    productoId: String(f.producto_id),
    marca: f.marca ?? null, modelo: f.modelo ?? null, medida: f.medida ?? null,
    nuevo: Number(f.nuevo ?? 0), usado: Number(f.usado ?? 0),
  }));
}

/* ── Evidencia de que ya ocurrió ─────────────────────────────────────────── */

export type Evidencia =
  | { veredicto: "APLICADA"; montajeActualId: string; neumaticoId: string }
  | { veredicto: "NO_APLICADA" }
  | { veredicto: "PARCIAL"; motivo: string }
  | { veredicto: "AMBIGUA"; motivo: string };

/**
 * ¿Se llegó a hacer la sustitución?
 *
 * Se responde mirando la posición, que es donde tiene que haberse notado:
 *
 *   · el montaje cambió y el saliente ya no está montado → APLICADA
 *   · el montaje sigue siendo el de antes → NO_APLICADA, se puede reintentar
 *   · la posición está VACÍA → PARCIAL: se quitó y no se puso nada, que es el
 *     estado a medias que hay que mirar a mano
 *   · cualquier otra combinación → AMBIGUA
 *
 * Se pregunta a TC en vez de suponer, porque suponer aquí significa montar un
 * segundo neumático encima del que ya se puso.
 */
export async function detectarSustitucionYaAplicada(p: {
  tcVehicleId: string;
  codigoPosicion: string;
  montajeEsperado: string | null;
  neumaticoSalienteEsperado: string | null;
}): Promise<Evidencia> {
  const estado = await estadoDeVehiculo(p.tcVehicleId);
  if (!estado) return { veredicto: "AMBIGUA", motivo: "No se ha podido leer el vehículo en TyreControl." };

  const pos = estado.posiciones.find((x) => x.codigoPosicion === p.codigoPosicion);
  if (!pos) return { veredicto: "AMBIGUA", motivo: "La posición ya no existe en la configuración." };

  // Nada montado: se quitó el viejo y no se puso el nuevo. Es el peor caso y el
  // que nunca debe arreglarse solo.
  if (!pos.montajeActualId || !pos.neumatico) {
    return {
      veredicto: "PARCIAL",
      motivo: `La posición ${p.codigoPosicion} se ha quedado sin neumático: se retiró el saliente y no se montó ninguno.`,
    };
  }

  // Sigue exactamente como estaba: no llegó a ejecutarse.
  if (p.montajeEsperado && pos.montajeActualId === p.montajeEsperado) {
    return { veredicto: "NO_APLICADA" };
  }

  // Montaje distinto y el saliente ya no está: la sustitución ocurrió.
  if (p.montajeEsperado && pos.montajeActualId !== p.montajeEsperado) {
    const sigueElSaliente = p.neumaticoSalienteEsperado
      && pos.neumatico.neumaticoId === p.neumaticoSalienteEsperado;
    if (sigueElSaliente) {
      return {
        veredicto: "AMBIGUA",
        motivo: "El montaje ha cambiado pero sigue el mismo neumático: alguien ha hecho otra cosa por medio.",
      };
    }
    return {
      veredicto: "APLICADA",
      montajeActualId: pos.montajeActualId,
      neumaticoId: pos.neumatico.neumaticoId,
    };
  }

  return {
    veredicto: "AMBIGUA",
    motivo: "No se guardó el montaje esperado, así que no se puede saber si la sustitución llegó a hacerse.",
  };
}

/* ── Lectura previa ──────────────────────────────────────────────────────── */

async function leerSituacion(p: PlanSustitucion): Promise<SituacionSustitucion | null> {
  const estado = await estadoDeVehiculo(p.tcVehicleId);
  if (!estado) return null;
  const pos = estado.posiciones.find((x) => x.codigoPosicion === p.codigoPosicion);
  if (!pos) return null;

  let medidaEntrante: string | null = null;
  let disponible: number | null = null;
  try {
    const stock = await stockDeEmpresa(p.tcEmpresaId);
    const prod = stock.find((s) => s.productoId === p.productoAlmacenId);
    medidaEntrante = prod?.medida ?? null;
    disponible = prod ? (p.condicion === "nuevo" ? prod.nuevo : prod.usado) : null;
  } catch {
    // Sin stock legible se sigue: la autoridad final es el RPC, y no poder
    // consultarlo es un aviso, no un motivo para bloquear la preparación.
  }

  return {
    posicionId: pos.posicionId,
    montajeActualId: pos.montajeActualId,
    neumaticoSalienteId: pos.neumatico?.neumaticoId ?? null,
    estadoSaliente: pos.neumatico?.estado ?? null,
    medidaSaliente: pos.neumatico?.medida ?? null,
    medidaEntrante,
    disponibleEnAlmacen: disponible,
  };
}

/* ── El handler ──────────────────────────────────────────────────────────── */

/**
 * Prepara la sustitución y se detiene antes de escribir.
 *
 * Las fases van en este orden porque cada una hace inútil a la siguiente si
 * falla: no tiene sentido mirar el stock de un producto para una posición que
 * ya cambió de rueda.
 */
export async function prepararSustitucion(p: PlanSustitucion): Promise<Preparacion> {
  // 1 · Estado actual de TyreControl.
  let situacion: SituacionSustitucion | null;
  try {
    situacion = await leerSituacion(p);
  } catch (e: any) {
    return { estado: "RETRY", codigo: "tc_unavailable", motivo: e?.message ?? "TyreControl no responde" };
  }
  if (!situacion) {
    return {
      estado: "BLOCKED", codigo: "tc_invalid_operation",
      motivo: `La posición ${p.codigoPosicion} no existe en la configuración del vehículo.`,
    };
  }

  // 2 · El saliente: ¿sigue siendo el que Assist creía?
  if (!situacion.montajeActualId || !situacion.neumaticoSalienteId) {
    return {
      estado: "CONFLICT",
      motivo: `En la posición ${p.codigoPosicion} ya no hay ningún neumático montado.`,
    };
  }
  if (p.montajeEsperado && p.montajeEsperado !== situacion.montajeActualId) {
    return {
      estado: "CONFLICT",
      motivo: `Alguien ha cambiado la rueda de ${p.codigoPosicion} desde TyreControl.`,
    };
  }
  if (p.neumaticoSalienteEsperado && p.neumaticoSalienteEsperado !== situacion.neumaticoSalienteId) {
    return { estado: "CONFLICT", motivo: `En ${p.codigoPosicion} ya no está el mismo neumático.` };
  }

  const avisos: string[] = [];

  // 3 · El entrante. La autoridad final es el RPC; esto evita llamadas inútiles.
  if (situacion.medidaEntrante == null) {
    avisos.push("No se ha podido leer el stock del producto elegido: lo comprobará TyreControl al ejecutar.");
  } else if (situacion.disponibleEnAlmacen != null && situacion.disponibleEnAlmacen <= 0) {
    return {
      estado: "BLOCKED", codigo: "tc_no_stock",
      motivo: `No hay stock ${p.condicion} de ese producto en el almacén de la empresa.`,
    };
  }

  /*
   * Medida. TyreControl la valida con `tc_medida_compatible` y solo un
   * administrador puede forzarla — el usuario de integración es operador, así
   * que NO puede. Se avisa antes para no gastar una llamada que va a fallar.
   */
  if (situacion.medidaEntrante && situacion.medidaSaliente
      && situacion.medidaEntrante !== situacion.medidaSaliente) {
    avisos.push(
      `La medida cambia: sale ${situacion.medidaSaliente} y entra ${situacion.medidaEntrante}. ` +
      "TyreControl lo rechazará si esa medida no está homologada para el tipo de vehículo.",
    );
  }

  // 4 · La llamada que se haría. Se construye siempre: es lo que enseña el
  // simulacro y lo que se ejecutará sin cambiar nada cuando se encienda.
  const llamada: LlamadaPrevista = {
    rpc: "tc_sustituir_neumatico",
    argumentos: {
      p_montaje_actual: situacion.montajeActualId,
      p_producto_almacen: p.productoAlmacenId,
      // `null` deja decidir a la política de la empresa; si hay RFID o número
      // de serie, `true` para que reenganche la ficha en vez de crear otra.
      p_control_individual: tieneIdentidad(p.identidad) ? true : null,
      p_datos: datosParaRpc(p.identidad),
      p_motivo_desmontaje: p.motivoDesmontaje,
      p_destino_retirado: p.destinoRetirado,
      // Sin odómetro fiable no se manda: `serviceKm` son los km del
      // desplazamiento, no el cuentakilómetros del vehículo.
      p_km: null,
      p_obs: p.observaciones,
      // NUNCA se fuerza la medida. Solo un administrador puede, y el usuario de
      // integración no lo es a propósito.
      p_forzar_medida: false,
      p_condicion: p.condicion,
    },
  };

  // 5 · Aquí se para. La llave de sustitución está aparte de la general porque
  // encenderla para las reparaciones no puede encender esto de paso.
  if (!sincronizacionSustitucionActiva()) {
    return { estado: "READY_BUT_DISABLED", llamada, situacion, avisos };
  }

  /*
   * Con la llave puesta TAMPOCO se ejecuta en esta fase. El paso destructivo se
   * añade en 1D.1, cuando una sustitución real se haya probado en un entorno
   * seguro. Que la llave exista y no haga nada es deliberado: se prueba el
   * cerrojo antes de que haya algo detrás.
   */
  return {
    estado: "READY_BUT_DISABLED", llamada, situacion,
    avisos: [...avisos, "La llave está puesta, pero la ejecución real de sustituciones llega en 1D.1."],
  };
}
