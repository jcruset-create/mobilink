/**
 * Quién puede ver y tocar el dinero.
 *
 * Hasta ahora el control de acceso del motor era el de siempre: un rango de
 * rol por endpoint. Eso vale para "quién entra", pero no para las dos
 * preguntas que plantea un motor con dos lados:
 *
 *  1. **Quién puede ver el precio de venta y el margen.** El taller ve lo que
 *     le paga la central y nada más. Enseñarle el margen es enseñarle cuánto
 *     gana la central por encima de él, y eso no se arregla luego.
 *
 *  2. **Quién puede cambiar un importe a mano, y hasta cuánto.** Un operador
 *     no toca dinero: opera. Un supervisor ajusta lo razonable de un turno.
 *     Por encima de ahí hace falta el administrador de la central.
 *
 * El módulo es puro y no sabe de Express ni de la base: recibe el rol y
 * devuelve qué se puede. Así se puede probar entero y, sobre todo, se puede
 * leer de una vez cuál es la política, en vez de reconstruirla juntando quince
 * `requireConnectRole` repartidos por el router.
 */

import type { ConnectRole } from "../rbac.ts";
import { aDinero, type Dinero } from "./money.ts";

export type CapacidadEconomica =
  | "ver_venta"          // el precio que se le cobra al cliente
  | "ver_compra"         // lo que factura el taller
  | "ver_margen"
  | "ajustar_importe"    // cambiar un importe a mano
  | "publicar_tarifa"    // convertir un borrador en tarifa que factura
  | "exportar_facturacion";

/**
 * La tabla entera de un vistazo.
 *
 * `provider_user` es el taller: ve lo suyo —lo que le pagan— y nada más. No
 * está aquí por omisión sino a propósito, y por eso las tres capacidades de
 * venta y margen le faltan explícitamente.
 */
const CAPACIDADES: Record<ConnectRole, CapacidadEconomica[]> = {
  superadmin: ["ver_venta", "ver_compra", "ver_margen", "ajustar_importe", "publicar_tarifa", "exportar_facturacion"],
  cc_admin:   ["ver_venta", "ver_compra", "ver_margen", "ajustar_importe", "publicar_tarifa", "exportar_facturacion"],
  supervisor: ["ver_venta", "ver_compra", "ver_margen", "ajustar_importe"],
  operator:   ["ver_venta", "ver_compra"],
  analyst:    ["ver_venta", "ver_compra", "ver_margen"],
  provider_user: ["ver_compra"],
};

export function puede(role: ConnectRole | null | undefined, capacidad: CapacidadEconomica): boolean {
  if (!role) return false;
  return (CAPACIDADES[role] ?? []).includes(capacidad);
}

/**
 * Límite de ajuste manual por línea, en valor absoluto de la diferencia.
 *
 * `null` significa sin límite, no cero: son cosas muy distintas y confundirlas
 * dejaría al administrador sin poder tocar nada.
 *
 * El del supervisor se puede subir o bajar por centro de control desde
 * `settings`, porque lo que es "razonable en un turno" depende del tamaño de
 * los servicios de cada central: 150 € es mucho en asistencia a turismos y
 * poco en camión. El valor de aquí es solo el de partida.
 */
export const LIMITE_SUPERVISOR_POR_DEFECTO = "150";

export function limiteAjuste(
  role: ConnectRole | null | undefined,
  ajustes?: { limiteSupervisor?: string | number | null } | null,
): Dinero | null | undefined {
  if (!puede(role, "ajustar_importe")) return undefined;   // no puede: ni límite hay
  if (role === "supervisor") {
    return aDinero(ajustes?.limiteSupervisor ?? LIMITE_SUPERVISOR_POR_DEFECTO);
  }
  return null;                                             // sin límite
}

export interface VeredictoAjuste {
  permitido: boolean;
  codigo: "ok" | "sin_permiso" | "sobre_limite";
  mensaje?: string;
  /** El límite que se ha aplicado, para poder decirlo en el mensaje. */
  limite?: Dinero | null;
}

/**
 * ¿Puede este rol mover un importe en `diferencia`?
 *
 * Se mira el VALOR ABSOLUTO: bajar 400 € es tan delicado como subirlos. Un
 * límite que solo controlara las subidas dejaría pasar los descuentos, que es
 * justo por donde se escapa el margen.
 */
export function autorizarAjuste(
  role: ConnectRole | null | undefined,
  diferencia: Dinero,
  ajustes?: { limiteSupervisor?: string | number | null } | null,
): VeredictoAjuste {
  const limite = limiteAjuste(role, ajustes);

  if (limite === undefined) {
    return {
      permitido: false, codigo: "sin_permiso",
      mensaje: "Tu rol no puede cambiar importes. Pídeselo a un supervisor o al administrador de la central.",
    };
  }
  if (limite == null) return { permitido: true, codigo: "ok", limite: null };

  const absoluta = diferencia < 0n ? -diferencia : diferencia;
  if (absoluta > limite) {
    return {
      permitido: false, codigo: "sobre_limite", limite,
      mensaje: `El ajuste supera lo que tu rol puede autorizar. Tiene que aprobarlo el administrador de la central.`,
    };
  }
  return { permitido: true, codigo: "ok", limite };
}

/**
 * Lo que hay que quitar de una respuesta antes de mandársela a alguien que no
 * puede verlo. Se recorta al SALIR y no al consultar: el motor necesita las
 * dos patas para calcular el margen aunque quien pregunte no vaya a verlo.
 */
export function recortarSegunRol<T extends Record<string, any>>(
  datos: T,
  role: ConnectRole | null | undefined,
  campos: { venta?: (keyof T)[]; compra?: (keyof T)[]; margen?: (keyof T)[] } = {},
): T {
  const copia = { ...datos };
  const borrar = (llaves?: (keyof T)[]) => {
    for (const k of llaves ?? []) if (k in copia) (copia as any)[k] = null;
  };
  if (!puede(role, "ver_venta")) borrar(campos.venta);
  if (!puede(role, "ver_compra")) borrar(campos.compra);
  if (!puede(role, "ver_margen")) borrar(campos.margen);
  return copia;
}

/** Los ajustes económicos guardados en `settings` del centro de control. */
export function leerAjustes(settings: unknown): { limiteSupervisor: string | null } {
  const s = (() => {
    if (settings == null) return {} as Record<string, any>;
    if (typeof settings !== "string") return settings as Record<string, any>;
    try { return JSON.parse(settings) ?? {}; } catch { return {}; }
  })();
  const v = s?.pricing?.limiteAjusteSupervisor;
  return { limiteSupervisor: v == null ? null : String(v) };
}
