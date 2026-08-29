/**
 * Reglas de enrutado: lo que la central decide sin que nadie despliegue.
 *
 * ── Por qué reglas y no un modelo ───────────────────────────────────────────
 *
 * La puntuación de `dominio.ts` ordena bien el caso normal, pero el negocio
 * está lleno de excepciones que no son medias: «los camiones, siempre a Grúas
 * Pesadas»; «este cliente no quiere que le mandemos a aquel taller»; «de noche
 * en Teruel, solo los de guardia». Meter eso en los pesos es imposible y
 * meterlo en el código obliga a un despliegue por cada acuerdo comercial.
 *
 * Así que primero se aplican reglas, que son excepciones explícitas y
 * auditables, y lo que sobrevive se ordena por puntuación. El orden importa:
 * una regla puede quitar candidatos o forzar uno, y solo después se pondera.
 *
 * ── Por qué es un motor sencillo y no un lenguaje ───────────────────────────
 *
 * Las condiciones son cinco campos comparados con igualdad o pertenencia. No
 * hay expresiones ni anidamiento a propósito: en cuanto se admiten, alguien
 * escribe una regla que nadie sabe leer seis meses después, y depurarla exige
 * un intérprete. Cuando cinco campos se queden cortos se amplía la lista, que
 * es un cambio pequeño y visible.
 */

import type { Acuerdo } from "../acuerdos/dominio.ts";

export const ACCIONES = ["excluir", "forzar", "preferir", "penalizar", "exigir_presupuesto"] as const;
export type Accion = (typeof ACCIONES)[number];

export type Condicion = {
  servicios?: string[];
  provincias?: string[];
  codigosPostales?: string[];
  /** Tipos de vehículo, tal como los nombra el catálogo de Central. */
  tiposVehiculo?: string[];
  /** Empresa cliente que encarga: por id de la cartera. */
  clientes?: number[];
  prioridades?: string[];
  /** Franja horaria en minutos desde medianoche; admite cruzar la medianoche. */
  desdeMinuto?: number | null;
  hastaMinuto?: number | null;
  /** Importe estimado desde el que aplica. */
  importeDesde?: number | null;
};

export type Regla = {
  id: number;
  controlCenterId: number;
  nombre: string;
  orden: number;
  activa: boolean;
  condicion: Condicion;
  accion: Accion;
  /** Sobre qué partners actúa. Vacío = sobre todos los que encajen. */
  partners: number[];
  /** Cuánto suma o resta `preferir`/`penalizar`, en puntos sobre 100. */
  ajuste: number;
};

export type Contexto = {
  servicio?: string | null;
  provincia?: string | null;
  codigoPostal?: string | null;
  tipoVehiculo?: string | null;
  clienteId?: number | null;
  prioridad?: string | null;
  importeEstimado?: number | null;
  cuando?: Date;
};

function coincideLista(valores: string[] | undefined, v: unknown): boolean | null {
  if (!valores || valores.length === 0) return null;      // la regla no opina
  if (v == null || v === "") return false;                // opina y no hay dato
  return valores.map((x) => String(x).toLowerCase()).includes(String(v).toLowerCase());
}

function coincideCp(patrones: string[] | undefined, cp: unknown): boolean | null {
  if (!patrones || patrones.length === 0) return null;
  const limpio = String(cp ?? "").replace(/\s/g, "");
  if (limpio === "") return false;
  return patrones.some((p) => {
    const patron = String(p).replace(/[\s*]/g, "");
    return patron !== "" && limpio.startsWith(patron);
  });
}

function dentroDeFranja(r: Condicion, cuando: Date): boolean | null {
  if (r.desdeMinuto == null || r.hastaMinuto == null) return null;
  const m = cuando.getHours() * 60 + cuando.getMinutes();
  return r.hastaMinuto > r.desdeMinuto
    ? m >= r.desdeMinuto && m < r.hastaMinuto
    : m >= r.desdeMinuto || m < r.hastaMinuto;    // guardia que cruza medianoche
}

/**
 * ¿Aplica esta regla a este caso?
 *
 * Los campos que la regla no rellena no opinan; los que rellena tienen que
 * cumplirse todos. Es la lectura que espera quien la escribe: poner
 * «provincia: Teruel» y nada más significa «en Teruel», no «en Teruel o donde
 * sea».
 *
 * Una regla sin ninguna condición aplica siempre, y eso es deliberado: es como
 * se escribe «a este partner nunca» o «este siempre primero».
 */
export function aplica(r: Regla, c: Contexto): boolean {
  if (!r.activa) return false;
  const cuando = c.cuando ?? new Date();

  const pruebas = [
    coincideLista(r.condicion.servicios, c.servicio),
    coincideLista(r.condicion.provincias, c.provincia),
    coincideCp(r.condicion.codigosPostales, c.codigoPostal),
    coincideLista(r.condicion.tiposVehiculo, c.tipoVehiculo),
    coincideLista(r.condicion.prioridades, c.prioridad),
    dentroDeFranja(r.condicion, cuando),
    r.condicion.clientes && r.condicion.clientes.length > 0
      ? c.clienteId != null && r.condicion.clientes.includes(Number(c.clienteId))
      : null,
    r.condicion.importeDesde != null
      ? c.importeEstimado != null && Number(c.importeEstimado) >= r.condicion.importeDesde
      : null,
  ];

  return pruebas.every((p) => p === null || p === true);
}

export type EfectoRegla = {
  reglaId: number;
  nombre: string;
  accion: Accion;
  ajuste: number;
};

export type Decision = {
  /** Partners que quedan fuera por una regla, con la regla que los echó. */
  excluidos: Map<number, EfectoRegla>;
  /** Si alguna regla fuerza partners concretos, solo se consideran ésos. */
  forzados: number[];
  /** Ajustes de puntos por partner, ya sumados. */
  ajustes: Map<number, number>;
  /** Presupuesto obligatorio por regla, sea cual sea el acuerdo. */
  exigirPresupuesto: boolean;
  /** Todo lo que se aplicó, para poder contarlo. */
  aplicadas: { regla: EfectoRegla; partners: number[] }[];
};

/**
 * Evalúa las reglas en orden y devuelve lo que hay que hacer.
 *
 * No filtra ni ordena nada: devuelve la decisión y es el servicio quien la
 * aplica. Separarlo permite enseñar «esta regla habría excluido a X» sin tener
 * que ejecutar el enrutado de verdad, que es lo que hace útil el simulador.
 *
 * `forzar` es la única acción que se queda con la PRIMERA que dispara. Dos
 * reglas que fuerzan partners distintos se contradicen, y resolverlo sumando
 * las dos listas convertiría un «siempre a éste» en «a cualquiera de estos
 * dos», que es lo contrario de lo que se pidió. Gana la de menor orden, que es
 * la más prioritaria, y las demás se anotan como no aplicadas.
 */
export function decidir(reglas: Regla[], c: Contexto, todos: number[]): Decision {
  const d: Decision = {
    excluidos: new Map(), forzados: [], ajustes: new Map(),
    exigirPresupuesto: false, aplicadas: [],
  };
  let yaForzado = false;

  for (const r of [...reglas].sort((a, b) => a.orden - b.orden || a.id - b.id)) {
    if (!aplica(r, c)) continue;
    const objetivo = r.partners.length > 0 ? r.partners : todos;
    const efecto: EfectoRegla = { reglaId: r.id, nombre: r.nombre, accion: r.accion, ajuste: r.ajuste };

    switch (r.accion) {
      case "excluir":
        for (const p of objetivo) d.excluidos.set(p, efecto);
        break;
      case "forzar":
        if (yaForzado) continue;   // la primera manda: ver el comentario de arriba
        // Forzar «a todos» no significa nada: sin partners concretos se ignora.
        if (r.partners.length === 0) continue;
        d.forzados = [...r.partners];
        yaForzado = true;
        break;
      case "preferir":
        for (const p of objetivo) d.ajustes.set(p, (d.ajustes.get(p) ?? 0) + Math.abs(r.ajuste));
        break;
      case "penalizar":
        for (const p of objetivo) d.ajustes.set(p, (d.ajustes.get(p) ?? 0) - Math.abs(r.ajuste));
        break;
      case "exigir_presupuesto":
        d.exigirPresupuesto = true;
        break;
    }
    d.aplicadas.push({ regla: efecto, partners: objetivo });
  }

  return d;
}

/** Lectura tolerante de lo guardado: una regla corrupta no tumba el enrutado. */
export function leerRegla(f: any): Regla {
  let condicion: Condicion = {};
  try {
    const o = typeof f.condition === "string" ? JSON.parse(f.condition) : (f.condition ?? {});
    if (o && typeof o === "object") condicion = o;
  } catch { condicion = {}; }

  let partners: number[] = [];
  try {
    const o = typeof f.partners === "string" ? JSON.parse(f.partners) : (f.partners ?? []);
    if (Array.isArray(o)) partners = o.map((x: unknown) => Number(x)).filter(Number.isInteger);
  } catch { partners = []; }

  const accion = (ACCIONES as readonly string[]).includes(String(f.action))
    ? (String(f.action) as Accion)
    /*
     * Una acción desconocida se degrada a `penalizar` con ajuste 0, que es
     * inofensiva. Interpretarla como `excluir` dejaría a un partner fuera por
     * un error de datos, y eso es peor que no hacer nada.
     */
    : "penalizar";

  return {
    id: Number(f.id),
    controlCenterId: Number(f.controlCenterId),
    nombre: String(f.name ?? ""),
    orden: Number(f.sortOrder ?? 100),
    activa: f.active !== false,
    condicion,
    accion,
    partners,
    ajuste: Number.isFinite(Number(f.adjustment)) ? Number(f.adjustment) : 0,
  };
}

export type { Acuerdo };
