import type { MovimientoFila } from "./armarParte.ts";

/**
 * Las filas del parte, sacadas de las OPERACIONES.
 *
 * ── Por qué existe esto ─────────────────────────────────────────────────────
 *
 * El PDF se armaba leyendo `tc_operacion_movimientos`, y salía en blanco: ese
 * desglose lo escriben `tc_cambiar_posicion`, `tc_intercambiar_posiciones`,
 * las correcciones, `tc_registrar_reparacion` y los planes de trabajo… pero NO
 * `tc_desmontar_neumatico` ni `tc_montar_desde_catalogo`/`_almacen`, que son
 * justo las dos que usa el parte guiado. Resultado: el técnico desmontaba dos
 * gomas, el parte quedaba bien guardado, y el papel salía sin una sola línea.
 *
 * La tabla que SIEMPRE se escribe —la escriben todas las RPC, sin excepción— es
 * `operaciones_neumaticos`. Es de la que tira la ficha de la intervención en el
 * panel, que sí enseñaba los neumáticos retirados. El papel pasa a leer de la
 * misma, así que los dos cuentan lo mismo por construcción y no por casualidad.
 *
 * No se toca ninguna RPC para que rellene el desglose: son piezas centrales que
 * usan el panel y las demás pantallas, y hay lógica (deshacer un cambio) que
 * cuenta filas de esa tabla.
 *
 * ── Sin base de datos, a propósito ──────────────────────────────────────────
 *
 * Recibe filas y devuelve filas, igual que armarParte: así el mapeo entero se
 * prueba sin levantar nada, que es donde estaba el fallo.
 */

/** Una operación tal y como sale de la consulta, con sus relaciones unidas. */
export interface OperacionFila {
  tipo_operacion?: string | null;
  motivo?: string | null;
  destino?: string | null;
  estado_anterior?: string | null;
  estado_nuevo?: string | null;
  observaciones?: string | null;
  is_anulada?: boolean | null;
  status?: string | null;
  neumatico?: {
    marca?: string | null; modelo?: string | null; medida?: string | null;
    numero_serie?: string | null; dot?: string | null; numero_interno?: string | null;
  } | null;
  posicion_origen?: { codigo_posicion?: string | null } | null;
  posicion_destino?: { codigo_posicion?: string | null } | null;
}

/** Lo medido en la revisión del parte, por código de posición. */
export interface MedicionPos {
  profundidad_mm?: number | null;
  presion_bar?: number | null;
}

/**
 * Qué es cada operación en el papel.
 *
 * Una SUSTITUCIÓN es las dos cosas según de dónde venía la goma: si estaba
 * montada, es la que sale; si venía del almacén, la que entra. Es exactamente
 * la regla que ya usa la ficha de la intervención en el panel, y se copia a
 * posta para que las dos pantallas no puedan discrepar.
 */
export function tipoEnElPapel(o: OperacionFila): string | null {
  switch (o.tipo_operacion) {
    case "desmontaje": return "desmontaje";
    case "montaje": return "montaje";
    case "cambio_posicion":
    case "rotacion":
    case "intercambio": return "cambio_posicion";
    case "sustitucion": return o.estado_anterior === "montado" ? "desmontaje" : "montaje";
    // Reparaciones, descartes y movimientos de almacén no son ni un montaje ni
    // un desmontaje: no van en esas dos tablas del papel.
    default: return null;
  }
}

/**
 * El número que identifica la unidad, para la columna «Nº Serie / DOT».
 *
 * Se prefiere el número de serie —identifica ESA goma—, luego el DOT, que solo
 * dice cuándo se fabricó, y en último lugar el número interno de Mobilink
 * (NT-2026-000063), que al menos permite encontrarla en el sistema. Antes se
 * quedaba en blanco cuando no había serie ni DOT, que es el caso normal de una
 * goma que entró por importación.
 */
export function serieDe(n: OperacionFila["neumatico"]): string | null {
  if (!n) return null;
  const v = [n.numero_serie, n.dot, n.numero_interno]
    .map((x) => (x ?? "").trim()).find(Boolean);
  return v || null;
}

/** Una goma montada es NUEVA salvo que la RPC la marcara como usada. */
export function esNuevo(o: OperacionFila): boolean {
  return !(o.observaciones ?? "").includes("[USADO]");
}

export function filasDeOperaciones(
  ops: OperacionFila[],
  medicionPorPosicion: Record<string, MedicionPos> = {},
): MovimientoFila[] {
  const filas: MovimientoFila[] = [];
  for (const o of ops) {
    // Anuladas y no completadas fuera: el papel dice lo que se hizo, no lo que
    // se pensó hacer ni lo que se deshizo.
    if (o.is_anulada) continue;
    if (o.status != null && o.status !== "completada") continue;

    const tipo = tipoEnElPapel(o);
    if (tipo == null) continue;

    const origen = o.posicion_origen?.codigo_posicion ?? null;
    const destinoPos = o.posicion_destino?.codigo_posicion ?? null;

    /** Una fila del papel, con lo medido en la posición de la que habla. */
    const fila = (
      movimiento_tipo: "desmontaje" | "montaje",
      posicion: string | null,
      nuevo: boolean,
    ): MovimientoFila => {
      // La profundidad la mide el técnico en la revisión del propio parte, por
      // posición. Es la única que hay: las RPC de montaje y desmontaje no
      // guardan un desglose con milímetros.
      const med = posicion ? medicionPorPosicion[posicion] : undefined;
      return {
        movimiento_tipo,
        posicion,
        marca: o.neumatico?.marca ?? null,
        modelo: o.neumatico?.modelo ?? null,
        medida: o.neumatico?.medida ?? null,
        serie: serieDe(o.neumatico),
        // Lo medido es el estado ANTES de tocar la rueda: es la profundidad
        // con la que la goma SALE. Para la que entra no dice nada, así que no
        // se le inventa una.
        profundidad_anterior: movimiento_tipo === "desmontaje" ? (med?.profundidad_mm ?? null) : null,
        profundidad_final: null,
        presion_bar: movimiento_tipo === "desmontaje" ? (med?.presion_bar ?? null) : null,
        motivo: o.motivo ?? null,
        destino: o.destino ?? null,
        origen: o.estado_anterior ?? null,
        es_nuevo: nuevo,
      };
    };

    if (tipo === "cambio_posicion") {
      // En el papel un cambio de posición son DOS líneas: la rueda sale de un
      // sitio y entra en otro. Con una sola fila, las dos tablas enseñaban la
      // misma posición y el parte no decía a dónde había ido a parar.
      // Y no es una goma nueva: no cuenta en «neumáticos nuevos montados».
      filas.push(fila("desmontaje", origen ?? destinoPos, false));
      filas.push(fila("montaje", destinoPos ?? origen, false));
      continue;
    }

    // El desmontaje habla de DE DÓNDE salió; el montaje, de DÓNDE quedó.
    filas.push(tipo === "desmontaje"
      ? fila("desmontaje", origen ?? destinoPos, false)
      : fila("montaje", destinoPos ?? origen, esNuevo(o)));
  }
  return filas;
}
