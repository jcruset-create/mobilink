/**
 * Cambio de neumáticos en un trabajo de OTF: qué ruedas, qué neumático del
 * catálogo de TyreControl y cómo se registra el montaje allí.
 *
 * Aquí solo lo que no habla con nadie: validar lo que manda el panel, poner
 * nombre a las posiciones, el texto del trabajo y el plan de montaje. Las
 * consultas y las llamadas a TyreControl están en `neumaticosTcServicio.ts`.
 *
 * Las posiciones se guardan COPIADAS en el trabajo (código, nombre y
 * coordenadas del plano), no solo su id: la tablet y el informe las pintan sin
 * preguntar a TyreControl, y si alguien recalibra el plano mañana, el trabajo
 * de hoy sigue enseñando lo que se pidió.
 */

export const CONDICIONES = ["nuevo", "usado"] as const;
export type Condicion = (typeof CONDICIONES)[number];

/**
 * Dónde va el neumático que se quita. Son valores del CHECK de
 * `tc_neumaticos.estado`: el RPC los escribe tal cual en esa columna.
 * Por defecto «de baja»: en una base de cliente, lo que se quita se lo lleva la
 * furgoneta para reciclar, no entra en el almacén del cliente.
 */
export const DESTINOS = ["descartado", "almacen", "reparacion"] as const;
export type Destino = (typeof DESTINOS)[number];

export type PosicionPlano = {
  /** id de `tc_posiciones_vehiculo`. */
  id: string;
  codigo: string;
  nombre: string;
  eje: number | null;
  lado: string | null;
  interiorExterior: string | null;
  /** Coordenadas calibradas del plano de TyreControl, en %. */
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  /** Lo que llevaba montado cuando se pidió el trabajo. */
  montado: string | null;
};

export type NeumaticosTrabajo = {
  tcEmpresaId: string | null;
  /** null si el vehículo no estaba en TyreControl: se da de alta al montar. */
  tcVehiculoId: string | null;
  tcTipoVehiculoId: string;
  tipoNombre: string | null;
  config: string | null;
  imagenUrl: string | null;
  posiciones: PosicionPlano[];
  /** Códigos de las posiciones marcadas. */
  seleccion: string[];
  /** Referencia del catálogo de TyreControl. Sin ella no se puede montar. */
  referenciaId: string | null;
  marca: string | null;
  modelo: string | null;
  medida: string;
  condicion: Condicion;
  destinoRetirado: Destino;
};

export class ErrorNeumaticos extends Error {}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};
const txt = (v: unknown, max = 120): string | null => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

/** Lo que manda el panel, validado. Lanza ErrorNeumaticos si no vale. */
export function limpiarNeumaticos(b: any): NeumaticosTrabajo {
  if (!b || typeof b !== "object") throw new ErrorNeumaticos("Faltan los datos de los neumáticos");
  const tipo = txt(b.tcTipoVehiculoId, 64);
  if (!tipo) throw new ErrorNeumaticos("Elige el tipo de vehículo de TyreControl");

  const posiciones: PosicionPlano[] = (Array.isArray(b.posiciones) ? b.posiciones : [])
    .slice(0, 40)
    .map((p: any) => ({
      id: String(p?.id ?? ""),
      codigo: String(p?.codigo ?? "").trim(),
      nombre: txt(p?.nombre, 60) ?? String(p?.codigo ?? ""),
      eje: num(p?.eje),
      lado: txt(p?.lado, 10),
      interiorExterior: txt(p?.interiorExterior, 10),
      x: num(p?.x), y: num(p?.y), w: num(p?.w), h: num(p?.h),
      montado: txt(p?.montado, 120),
    }))
    .filter((p: PosicionPlano) => p.id && p.codigo);
  if (posiciones.length === 0) throw new ErrorNeumaticos("El plano no tiene posiciones");

  const codigos = new Set(posiciones.map((p) => p.codigo));
  const pedidas: string[] = (Array.isArray(b.seleccion) ? b.seleccion : []).map((c: any) => String(c));
  const seleccion = [...new Set(pedidas)].filter((c) => codigos.has(c));
  if (seleccion.length === 0) throw new ErrorNeumaticos("Marca al menos una rueda en el plano");

  const medida = txt(b.medida, 40);
  if (!medida) throw new ErrorNeumaticos("Indica la medida del neumático");
  const condicion: Condicion = b.condicion === "usado" ? "usado" : "nuevo";
  const destinoRetirado: Destino = (DESTINOS as readonly string[]).includes(b.destinoRetirado)
    ? b.destinoRetirado : "descartado";

  return {
    tcEmpresaId: txt(b.tcEmpresaId, 64),
    tcVehiculoId: txt(b.tcVehiculoId, 64),
    tcTipoVehiculoId: tipo,
    tipoNombre: txt(b.tipoNombre, 60),
    config: txt(b.config, 20),
    imagenUrl: txt(b.imagenUrl, 500),
    posiciones,
    seleccion,
    referenciaId: txt(b.referenciaId, 64),
    marca: txt(b.marca, 60),
    modelo: txt(b.modelo, 80),
    medida: medida.toUpperCase(),
    condicion,
    destinoRetirado,
  };
}

/** «Eje 2 izq. ext.» */
export function nombreCorto(p: Pick<PosicionPlano, "eje" | "lado" | "interiorExterior" | "codigo">): string {
  if (p.eje == null) return p.codigo;
  const lado = /^d/i.test(p.lado ?? "") ? "der." : /^i/i.test(p.lado ?? "") ? "izq." : (p.lado ?? "");
  const ie = /^int/i.test(p.interiorExterior ?? "") ? " int." : /^ext/i.test(p.interiorExterior ?? "") ? " ext." : "";
  return `Eje ${p.eje} ${lado}${ie}`.trim();
}

/** «Eje 1: izq., der. · Eje 2: izq. ext., izq. int.» */
export function resumenPosiciones(n: Pick<NeumaticosTrabajo, "posiciones" | "seleccion">): string {
  const marcadas = n.posiciones.filter((p) => n.seleccion.includes(p.codigo));
  const porEje = new Map<string, string[]>();
  for (const p of marcadas) {
    const clave = p.eje == null ? "" : `Eje ${p.eje}`;
    const resto = nombreCorto(p).replace(clave, "").trim() || p.codigo;
    porEje.set(clave, [...(porEje.get(clave) ?? []), resto]);
  }
  return [...porEje.entries()].map(([eje, r]) => (eje ? `${eje}: ${r.join(", ")}` : r.join(", "))).join(" · ");
}

/** «4 × Continental Conti Hybrid HD3 315/70R22.5 (nuevo)» */
export function textoNeumaticos(n: Pick<NeumaticosTrabajo, "seleccion" | "marca" | "modelo" | "medida" | "condicion">): string {
  const nombre = [n.marca, n.modelo, n.medida].filter(Boolean).join(" ");
  return `${n.seleccion.length} × ${nombre} (${n.condicion})`;
}

/**
 * La marca que deja el montaje en las observaciones de TyreControl. Sirve
 * para saber, al reintentar, que esa rueda ya se montó desde este trabajo y no
 * montar otra encima.
 */
export function etiquetaOtf(otfId: number, trabajoId: number): string {
  return `[OTF-${otfId} T-${trabajoId}]`;
}

export type MontajeActual = { id: string; observaciones: string | null };

export type PasoMontaje = {
  posicionId: string;
  codigo: string;
  /** Si la rueda está ocupada: se sustituye. */
  montajeActualId: string | null;
  /** Ya montada desde este trabajo en un intento anterior. */
  hecho: boolean;
};

/** Qué hay que hacer en cada rueda marcada, mirando lo que hay HOY en TyreControl. */
export function planMontaje(
  n: Pick<NeumaticosTrabajo, "posiciones" | "seleccion">,
  actuales: Map<string, MontajeActual>,
  etiqueta: string,
): PasoMontaje[] {
  return n.posiciones
    .filter((p) => n.seleccion.includes(p.codigo))
    .map((p) => {
      const m = actuales.get(p.id) ?? null;
      const hecho = !!m && String(m.observaciones ?? "").includes(etiqueta);
      return { posicionId: p.id, codigo: p.codigo, montajeActualId: hecho ? null : m?.id ?? null, hecho };
    });
}

/**
 * ¿Se puede escribir en TyreControl desde las OTF? Dos llaves: la general de
 * escritura y la propia, que por defecto está apagada. Encender la general
 * para otras cosas no puede ponerse a montar ruedas desde las OTF de paso.
 */
export function montajeOtfActivo(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.TYRE_CONTROL_WRITE_ENABLED ?? "").toLowerCase() === "true"
    && String(env.TYRE_CONTROL_OTF_MOUNT_ENABLED ?? "").toLowerCase() === "true";
}
