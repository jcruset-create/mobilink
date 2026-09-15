/**
 * Los vocabularios del módulo y cómo se DERIVAN los estados.
 *
 * Código puro. Ningún estado de pedido o albarán lo fija una pantalla: sale de
 * las cantidades, y se recalcula dentro de la misma transacción que las cambia.
 * Un estado que se pudiera escribir a mano acabaría diciendo «recibido» con
 * dos unidades pendientes.
 *
 * ── La regla que gobierna todo ──────────────────────────────────────────────
 *
 *   pedida ≠ expedida  → pendiente de suministro. NO es incidencia: es el
 *                        proveedor que aún no ha mandado el resto.
 *   expedida ≠ recibida → incidencia de recepción: el albarán dice una cosa y
 *                        en el muelle se ha contado otra.
 *
 * Los estados se guardan en TEXT con CHECK, como en Therefore: un ENUM de
 * PostgreSQL obliga a un `ALTER TYPE` por cada estado nuevo y no cabe en el
 * `CREATE TABLE IF NOT EXISTS` con el que arranca el servidor.
 */

export const ESTADOS_PEDIDO = [
  "PENDIENTE_EXPEDICION",
  "PARCIALMENTE_EXPEDIDO",
  "EXPEDIDO",
  "COMPLETADO",
  "CANCELADO",
] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export const ESTADOS_ALBARAN = [
  "EMITIDO",
  "EN_TRANSITO",
  "PARCIALMENTE_RECIBIDO",
  "RECIBIDO",
  "RECIBIDO_CON_INCIDENCIA",
] as const;
export type EstadoAlbaran = (typeof ESTADOS_ALBARAN)[number];

export const ESTADOS_INCIDENCIA = ["ABIERTA", "EN_GESTION", "RESUELTA", "CANCELADA"] as const;
export type EstadoIncidencia = (typeof ESTADOS_INCIDENCIA)[number];

export const TIPOS_INCIDENCIA = [
  "FALTA_MERCANCIA",
  "SOBRA_MERCANCIA",
  "PRODUCTO_INCORRECTO",
  "MERCANCIA_DANADA",
  "EMBALAJE_DANADO",
  "OTRO",
] as const;
export type TipoIncidencia = (typeof TIPOS_INCIDENCIA)[number];

export const RESULTADOS_RECEPCION = ["OK", "CON_INCIDENCIA"] as const;
export type ResultadoRecepcion = (typeof RESULTADOS_RECEPCION)[number];

export const ORIGENES = ["MANUAL", "CORREO"] as const;
export type Origen = (typeof ORIGENES)[number];

/** Estados de albarán en los que todavía se puede recepcionar. */
export const ALBARAN_RECIBIBLE: readonly EstadoAlbaran[] = ["EN_TRANSITO", "PARCIALMENTE_RECIBIDO"];

export const esEstadoPedido = (v: unknown): v is EstadoPedido =>
  ESTADOS_PEDIDO.includes(v as EstadoPedido);
export const esEstadoAlbaran = (v: unknown): v is EstadoAlbaran =>
  ESTADOS_ALBARAN.includes(v as EstadoAlbaran);
export const esEstadoIncidencia = (v: unknown): v is EstadoIncidencia =>
  ESTADOS_INCIDENCIA.includes(v as EstadoIncidencia);
export const esTipoIncidencia = (v: unknown): v is TipoIncidencia =>
  TIPOS_INCIDENCIA.includes(v as TipoIncidencia);

/** Lo que hace falta de una línea de pedido para derivar el estado. */
export type CantidadesLineaPedido = {
  pedida: number;
  expedida: number;
  recibida: number;
};

/**
 * Estado de un pedido a partir de sus líneas.
 *
 * · Cancelado se respeta: es una decisión, no una cantidad.
 * · Nada expedido → pendiente de expedición.
 * · Algo expedido pero no todo → parcialmente expedido, AUNQUE lo expedido ya
 *   se haya recibido: quedan unidades por suministrar y eso es lo que importa.
 * · Todo expedido y no todo recibido → expedido (en tránsito, al menos parte).
 * · Todo recibido → completado. Que haya habido incidencias por el camino se
 *   ve en las incidencias; el pedido, en cuanto a cantidades, está cerrado.
 *
 * Un pedido sin líneas está pendiente de expedición: no se puede dar por
 * completado lo que no se ha pedido.
 */
export function estadoPedido(
  lineas: readonly CantidadesLineaPedido[],
  cancelado = false
): EstadoPedido {
  if (cancelado) return "CANCELADO";
  if (lineas.length === 0) return "PENDIENTE_EXPEDICION";
  const totalPedida = lineas.reduce((s, l) => s + l.pedida, 0);
  const totalExpedida = lineas.reduce((s, l) => s + l.expedida, 0);
  if (totalExpedida <= 0) return "PENDIENTE_EXPEDICION";
  const faltaPorExpedir = lineas.some((l) => l.expedida < l.pedida);
  if (faltaPorExpedir) return "PARCIALMENTE_EXPEDIDO";
  const faltaPorRecibir = lineas.some((l) => l.recibida < l.expedida);
  if (faltaPorRecibir) return "EXPEDIDO";
  return totalPedida > 0 ? "COMPLETADO" : "PENDIENTE_EXPEDICION";
}

export type CantidadesLineaAlbaran = {
  expedida: number;
  recibida: number;
};

/**
 * Estado de un albarán a partir de sus líneas.
 *
 * · `cerrado` es la decisión de un gestor de dar el albarán por terminado
 *   aunque falten unidades (diferencia aceptada por el proveedor). Sin esa
 *   decisión, un albarán con dos unidades de menos sigue PARCIALMENTE
 *   RECIBIDO, que es la verdad: siguen pendientes de llegar.
 * · `conIncidencia` es «tiene alguna incidencia registrada»: un albarán
 *   recibido entero pero con un neumático dañado no está simplemente
 *   «recibido».
 */
export function estadoAlbaran(
  lineas: readonly CantidadesLineaAlbaran[],
  opciones: { conIncidencia?: boolean; cerrado?: boolean } = {}
): EstadoAlbaran {
  const totalRecibida = lineas.reduce((s, l) => s + l.recibida, 0);
  const faltaPorRecibir = lineas.some((l) => l.recibida < l.expedida);
  if (totalRecibida <= 0 && !opciones.cerrado) return "EN_TRANSITO";
  if (faltaPorRecibir && !opciones.cerrado) return "PARCIALMENTE_RECIBIDO";
  return opciones.conIncidencia ? "RECIBIDO_CON_INCIDENCIA" : "RECIBIDO";
}

/* ── Etiquetas para los documentos y los eventos ─────────────────────────── */

export const ETIQUETA_TIPO_INCIDENCIA: Record<TipoIncidencia, string> = {
  FALTA_MERCANCIA: "FALTA DE MERCANCÍA",
  SOBRA_MERCANCIA: "SOBRA MERCANCÍA",
  PRODUCTO_INCORRECTO: "PRODUCTO INCORRECTO",
  MERCANCIA_DANADA: "MERCANCÍA DAÑADA",
  EMBALAJE_DANADO: "EMBALAJE DAÑADO",
  OTRO: "OTRO",
};

export const ETIQUETA_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  PENDIENTE_EXPEDICION: "Pendiente de expedición",
  PARCIALMENTE_EXPEDIDO: "Parcialmente expedido",
  EXPEDIDO: "Expedido",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
};

export const ETIQUETA_ESTADO_ALBARAN: Record<EstadoAlbaran, string> = {
  EMITIDO: "Emitido",
  EN_TRANSITO: "En tránsito",
  PARCIALMENTE_RECIBIDO: "Parcialmente recibido",
  RECIBIDO: "Recibido",
  RECIBIDO_CON_INCIDENCIA: "Recibido con incidencia",
};
