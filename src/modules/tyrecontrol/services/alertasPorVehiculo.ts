/**
 * Las alertas, agrupadas por vehículo.
 *
 * La función `tc_informes_alertas_vehiculos` devuelve UNA FILA POR RUEDA de
 * los vehículos que tienen alguna incidencia —todas sus ruedas, no solo las
 * que avisan—. Aquí se juntan en una tarjeta por vehículo: el estado de cada
 * goma, lo que va dentro de su recuadro y el resumen que va en la cabecera.
 *
 * Todo lo que decide la pantalla está aquí y no en el componente, para poder
 * probarlo sin montar un navegador: el estado de una rueda, cuántas hay que
 * cambiar, cuál es la peor, de cuándo es la medición y en qué orden salen.
 */

import { diasAtras, hoyISO } from "./revisionEnPapel";
import { marcasDelPlano, type MarcaDelPlano } from "./planoAlertas";
import { veredicto } from "./protocoloProfundidad";
import type { RuedaAlerta } from "../types/informes";

/**
 * Lo que le pasa a una rueda, de peor a mejor.
 *
 * `por_confirmar` es del protocolo contra los falsos desgastes: hay una lectura
 * en el mínimo o por debajo que nadie ha respaldado todavía. No es rojo, pero
 * hay que ir a medirla con la sonda.
 *
 * `dato` no es un estado de la goma: es un número que se enseña sin juzgarlo.
 * Solo sale en la vista de presión (ver `ruedasEnPresion`), para las ruedas
 * que no tienen aviso abierto.
 */
export type EstadoRueda = "cambiar" | "presion" | "por_confirmar" | "sin_medir" | "ok" | "vacia" | "dato";

export interface RuedaMarcada {
  codigo: string;
  estado: EstadoRueda;
  /** Lo que va escrito dentro del recuadro: «1,7», «—» o nada. */
  texto: string;
  /** La línea que sale al pasar el ratón. */
  titulo: string;
  profundidad: number | null;
  minimo: number | null;
  fecha: string | null;
  /** La última lectura, cuando no es la que se ha dado por buena. */
  pendiente: number | null;
  fechaPendiente: string | null;
  /** La goma montada, para pedir su última presión medida. */
  neumaticoId: string | null;
  /** Si tiene un aviso de presión abierto, y lo que leyó el sensor al darlo. */
  conAviso: boolean;
  presionAviso: number | null;
  presionRecomendada: number | null;
  marca: MarcaDelPlano | null;
}

export interface VehiculoConAlertas {
  vehiculoId: string;
  matricula: string;
  unidad: string | null;
  tipo: string | null;
  foto: string | null;
  /** Las medidas distintas que lleva montadas: casi siempre una, a veces dos. */
  medidas: string[];
  /** El mínimo de cambio, si es el mismo para todas las gomas medidas. */
  minimo: number | null;
  ruedas: RuedaMarcada[];
  paraCambiar: number;
  conPresion: number;
  /** Ruedas con una lectura baja sin confirmar: van a medirse con sonda. */
  porConfirmar: number;
  /** La goma más gastada de las que hay que cambiar. */
  peor: number | null;
  /** La medición más reciente de las ruedas con aviso. */
  medidoEl: string | null;
  diasDesdeMedicion: number | null;
}

/** Con cuántos días una medición ya no dice cómo está el vehículo HOY. */
export const DIAS_MEDICION_VIEJA = 90;

/** Un número de milímetros como se escribe aquí: con coma y un decimal. */
export function mm(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return "—";
  return valor.toFixed(1).replace(".", ",");
}

export function estadoDeRueda(r: RuedaAlerta): EstadoRueda {
  if (!r.neumatico_id) return "vacia";
  if (r.presion_aviso_at) return "presion";
  if (r.profundidad_mm == null) return "sin_medir";
  // El rojo y el «por confirmar» los decide el protocolo, el mismo que en la
  // ficha. Si la base aún no manda `confirmada`, se da por confirmada.
  const v = veredicto({
    mm: r.profundidad_mm,
    fecha: r.fecha_revision,
    confirmada: r.confirmada ?? true,
    pendiente: r.pendiente_mm != null ? { mm: r.pendiente_mm, fecha: r.pendiente_fecha ?? null } : null,
  }, r.minimo_mm);
  return v === "ok" ? "ok" : v;
}

function tituloDeRueda(r: RuedaAlerta, estado: EstadoRueda): string {
  const partes: string[] = [r.codigo_posicion ?? ""];
  if (estado === "vacia") return `${partes[0]} · sin neumático montado`;
  if (r.profundidad_mm != null) partes.push(`${mm(r.profundidad_mm)} mm`);
  else partes.push("sin medición");
  if ((estado === "cambiar" || estado === "por_confirmar") && r.minimo_mm != null) partes.push(`mínimo ${mm(r.minimo_mm)}`);
  if (estado === "por_confirmar") {
    partes.push(r.pendiente_mm != null
      ? `última lectura ${mm(r.pendiente_mm)} mm${r.pendiente_fecha ? ` el ${fechaCorta(r.pendiente_fecha)}` : ""}, sin confirmar`
      : "una sola lectura, sin confirmar");
  }
  if (estado === "presion") {
    const bar = r.presion_bar != null ? `${mm(r.presion_bar)} bar` : "sin lectura";
    const de = r.presion_recomendada_bar != null ? ` de ${mm(r.presion_recomendada_bar)}` : "";
    partes.push(`presión ${bar}${de}`);
  }
  if (r.medida) partes.push(r.medida);
  if (r.fecha_revision) partes.push(`medido el ${fechaCorta(r.fecha_revision)}`);
  return partes.filter(Boolean).join(" · ");
}

/** Una fecha ISO como se lee aquí: 2026-11-11 → 11/11/2026. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : "";
}

/** «hace 2 días», «ayer», «hoy». Null si no hay fecha. */
export function edadEnTexto(dias: number | null): string | null {
  if (dias == null) return null;
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

/**
 * Las filas, en una tarjeta por vehículo.
 *
 * Las filas de un vehículo tienen repetidos sus datos de cabecera (matrícula,
 * foto, tipo): se toma la primera, que es lo que devuelve la función para
 * todas.
 */
export function agruparPorVehiculo(filas: RuedaAlerta[], hoy: string = hoyISO()): VehiculoConAlertas[] {
  const porVehiculo = new Map<string, RuedaAlerta[]>();
  for (const f of filas) {
    if (!f.vehiculo_id) continue;
    const ya = porVehiculo.get(f.vehiculo_id);
    if (ya) ya.push(f);
    else porVehiculo.set(f.vehiculo_id, [f]);
  }

  const vehiculos: VehiculoConAlertas[] = [];
  for (const [vehiculoId, suyas] of porVehiculo) {
    const cabecera = suyas[0];
    const marcas = marcasDelPlano(suyas, cabecera.imagen_chasis_url);
    const porCodigo = new Map(marcas.map((m) => [m.codigo, m]));

    const ruedas: RuedaMarcada[] = suyas
      .filter((r) => r.codigo_posicion)
      .map((r) => {
        const estado = estadoDeRueda(r);
        return {
          codigo: r.codigo_posicion as string,
          estado,
          texto: estado === "vacia" ? "" : r.profundidad_mm == null ? "—" : mm(r.profundidad_mm),
          titulo: tituloDeRueda(r, estado),
          profundidad: r.profundidad_mm,
          minimo: r.minimo_mm,
          fecha: r.fecha_revision,
          pendiente: r.pendiente_mm ?? null,
          fechaPendiente: r.pendiente_fecha ?? null,
          neumaticoId: r.neumatico_id,
          conAviso: !!r.presion_aviso_at,
          presionAviso: r.presion_bar,
          presionRecomendada: r.presion_recomendada_bar,
          marca: porCodigo.get(r.codigo_posicion as string) ?? null,
        };
      });

    const conAviso = ruedas.filter((r) => r.estado === "cambiar" || r.estado === "presion" || r.estado === "por_confirmar");
    const paraCambiar = ruedas.filter((r) => r.estado === "cambiar");
    const profundidades = paraCambiar.map((r) => r.profundidad).filter((p): p is number => p != null);
    // La fecha de la tarjeta es la más RECIENTE de las ruedas que avisan: es la
    // que contesta «¿de cuándo es este aviso?». Dentro de un vehículo puede
    // haber ruedas de días distintos, y cada recuadro lleva la suya.
    // En una rueda por confirmar la fecha que importa es la de la lectura que
    // está en duda, no la del valor que se mantiene.
    const fechas = conAviso.map((r) => (r.estado === "por_confirmar" ? r.fechaPendiente ?? r.fecha : r.fecha))
      .filter((f): f is string => !!f).sort();
    const medidoEl = fechas.length > 0 ? fechas[fechas.length - 1] : null;

    const minimos = [...new Set(suyas.map((r) => r.minimo_mm).filter((m): m is number => m != null))];
    const medidas = [...new Set(suyas.map((r) => r.medida).filter((m): m is string => !!m))];

    vehiculos.push({
      vehiculoId,
      matricula: cabecera.matricula ?? "",
      unidad: cabecera.numero_unidad,
      tipo: cabecera.tipo_vehiculo,
      foto: cabecera.imagen_chasis_url,
      medidas,
      minimo: minimos.length === 1 ? minimos[0] : null,
      ruedas,
      paraCambiar: paraCambiar.length,
      conPresion: ruedas.filter((r) => r.estado === "presion").length,
      porConfirmar: ruedas.filter((r) => r.estado === "por_confirmar").length,
      peor: profundidades.length > 0 ? Math.min(...profundidades) : null,
      medidoEl,
      diasDesdeMedicion: medidoEl ? diasAtras(medidoEl, hoy) : null,
    });
  }
  return vehiculos;
}

export type OrdenVehiculos = "peor" | "ruedas" | "antiguedad" | "matricula";

const clavePeor = (v: VehiculoConAlertas) => v.peor ?? (v.conPresion > 0 ? -1 : 99);
const afectadas = (v: VehiculoConAlertas) => v.paraCambiar + v.conPresion + v.porConfirmar;

export function ordenarVehiculos(lista: VehiculoConAlertas[], orden: OrdenVehiculos): VehiculoConAlertas[] {
  const copia = [...lista];
  const porMatricula = (a: VehiculoConAlertas, b: VehiculoConAlertas) => a.matricula.localeCompare(b.matricula, "es");
  switch (orden) {
    case "peor":
      // Sin goma gastada confirmada no hay «peor». El que solo tiene aviso de
      // presión va delante, que su aviso es de ahora; el que solo tiene ruedas
      // por confirmar va detrás de todos los confirmados.
      return copia.sort((a, b) => clavePeor(a) - clavePeor(b) || porMatricula(a, b));
    case "ruedas":
      return copia.sort((a, b) => afectadas(b) - afectadas(a) || porMatricula(a, b));
    case "antiguedad":
      return copia.sort((a, b) => (b.diasDesdeMedicion ?? -1) - (a.diasDesdeMedicion ?? -1) || porMatricula(a, b));
    default:
      return copia.sort(porMatricula);
  }
}

export type FiltroVehiculos = "todo" | "cambiar" | "presion" | "confirmar" | "vieja";

export function filtrarVehiculos(lista: VehiculoConAlertas[], filtro: FiltroVehiculos): VehiculoConAlertas[] {
  switch (filtro) {
    case "cambiar": return lista.filter((v) => v.paraCambiar > 0);
    case "presion": return lista.filter((v) => v.conPresion > 0);
    case "confirmar": return lista.filter((v) => v.porConfirmar > 0);
    case "vieja": return lista.filter((v) => (v.diasDesdeMedicion ?? 0) > DIAS_MEDICION_VIEJA);
    default: return lista;
  }
}

/** El resumen de la cabecera de la tarjeta. */
export function resumenDeTarjeta(v: VehiculoConAlertas): string {
  const partes: string[] = [];
  if (v.paraCambiar > 0) {
    partes.push(`${v.paraCambiar} ${v.paraCambiar === 1 ? "rueda" : "ruedas"}${v.peor != null ? ` · peor ${mm(v.peor)} mm` : ""}`);
  }
  if (v.conPresion > 0) {
    partes.push(v.paraCambiar > 0 ? "y presión" : v.conPresion === 1 ? "Presión baja" : `${v.conPresion} avisos de presión`);
  }
  if (v.porConfirmar > 0) partes.push(`${v.porConfirmar} por confirmar`);
  return partes.join(" · ");
}

/** Una rueda de la lista «para medir con sonda». */
export interface RuedaPorConfirmar {
  vehiculoId: string;
  matricula: string;
  unidad: string | null;
  codigo: string;
  /** Lo que se mantiene como valor. */
  valor: number | null;
  /** La lectura en duda: la pendiente, o el propio valor si solo hay una. */
  enDuda: number | null;
  minimo: number | null;
  fecha: string | null;
  /** Por qué no está confirmada, en una frase. */
  motivo: string;
}

/**
 * La «E» del protocolo: lo que no está confirmado se mide a mano.
 *
 * Una fila por rueda con una lectura baja sin respaldo. La más baja primero:
 * si resulta ser verdad, es la que más prisa corre.
 */
export function ruedasParaMedirConSonda(vehiculos: VehiculoConAlertas[]): RuedaPorConfirmar[] {
  const filas: RuedaPorConfirmar[] = [];
  for (const v of vehiculos) {
    for (const r of v.ruedas) {
      if (r.estado !== "por_confirmar") continue;
      const hayPendiente = r.pendiente != null;
      filas.push({
        vehiculoId: v.vehiculoId,
        matricula: v.matricula,
        unidad: v.unidad,
        codigo: r.codigo,
        valor: r.profundidad,
        enDuda: hayPendiente ? r.pendiente : r.profundidad,
        minimo: r.minimo,
        fecha: hayPendiente ? r.fechaPendiente ?? r.fecha : r.fecha,
        motivo: hayPendiente
          ? `el arco ha leído ${mm(r.pendiente)} mm y las anteriores decían ${mm(r.profundidad)}`
          : "solo tiene una lectura",
      });
    }
  }
  return filas.sort((a, b) => (a.enDuda ?? 99) - (b.enDuda ?? 99) || a.matricula.localeCompare(b.matricula, "es"));
}

/**
 * Las mismas ruedas con la PRESIÓN dentro del recuadro en vez de los milímetros.
 *
 * Es lo que enseña la tarjeta al pulsar «bar» en un vehículo con aviso de
 * presión: quien va a hinchar una rueda quiere ver los bares de las cuatro, no
 * la profundidad.
 *
 * De dónde sale cada número:
 *
 *   · la rueda CON aviso abierto, lo que leyó el sensor al darlo —es el motivo
 *     del aviso, y el aviso se cierra solo cuando una lectura posterior da
 *     bien, así que mientras siga abierto no hay otra mejor—;
 *   · las demás, su última presión medida en una revisión (`ultimas`, por
 *     neumático). Sin dato, raya.
 *
 * Solo se pinta de ámbar la que tiene aviso. Las demás van en un color neutro:
 * aquí no se sabe su presión recomendada, y pintar de verde un número que no
 * se ha comparado con nada sería afirmar que está bien.
 *
 * `ultimas` es `null` mientras se están pidiendo: las ruedas con aviso ya
 * tienen su número y las otras esperan con puntos suspensivos.
 */
export function ruedasEnPresion(
  ruedas: RuedaMarcada[],
  ultimas: Record<string, number | null | undefined> | null,
): RuedaMarcada[] {
  return ruedas.map((r) => {
    if (r.estado === "vacia") return r;

    if (r.conAviso) {
      const de = r.presionRecomendada != null ? ` de ${mm(r.presionRecomendada)}` : "";
      return {
        ...r,
        estado: "presion" as const,
        texto: r.presionAviso != null ? mm(r.presionAviso) : "—",
        titulo: `${r.codigo} · ${r.presionAviso != null ? `${mm(r.presionAviso)} bar${de}` : "sin lectura"} · aviso de presión abierto`,
      };
    }

    if (ultimas === null) {
      return { ...r, estado: "sin_medir" as const, texto: "…", titulo: `${r.codigo} · leyendo la presión` };
    }
    const bar = r.neumaticoId ? ultimas[r.neumaticoId] ?? null : null;
    if (bar == null) {
      return { ...r, estado: "sin_medir" as const, texto: "—", titulo: `${r.codigo} · sin presión medida` };
    }
    return { ...r, estado: "dato" as const, texto: mm(bar), titulo: `${r.codigo} · ${mm(bar)} bar · última presión medida` };
  });
}
