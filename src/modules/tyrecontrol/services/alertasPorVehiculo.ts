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
import type { RuedaAlerta } from "../types/informes";

/** Lo que le pasa a una rueda, de peor a mejor. */
export type EstadoRueda = "cambiar" | "presion" | "sin_medir" | "ok" | "vacia";

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
  marca: MarcaDelPlano | null;
}

export interface VehiculoConAlertas {
  vehiculoId: string;
  matricula: string;
  unidad: string | null;
  tipo: string | null;
  activo: boolean;
  foto: string | null;
  /** Las medidas distintas que lleva montadas: casi siempre una, a veces dos. */
  medidas: string[];
  /** El mínimo de cambio, si es el mismo para todas las gomas medidas. */
  minimo: number | null;
  ruedas: RuedaMarcada[];
  paraCambiar: number;
  conPresion: number;
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
  if (r.minimo_mm != null && r.profundidad_mm <= r.minimo_mm) return "cambiar";
  return "ok";
}

function tituloDeRueda(r: RuedaAlerta, estado: EstadoRueda): string {
  const partes: string[] = [r.codigo_posicion ?? ""];
  if (estado === "vacia") return `${partes[0]} · sin neumático montado`;
  if (r.profundidad_mm != null) partes.push(`${mm(r.profundidad_mm)} mm`);
  else partes.push("sin medición");
  if (estado === "cambiar" && r.minimo_mm != null) partes.push(`mínimo ${mm(r.minimo_mm)}`);
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
          marca: porCodigo.get(r.codigo_posicion as string) ?? null,
        };
      });

    const conAviso = ruedas.filter((r) => r.estado === "cambiar" || r.estado === "presion");
    const paraCambiar = ruedas.filter((r) => r.estado === "cambiar");
    const profundidades = paraCambiar.map((r) => r.profundidad).filter((p): p is number => p != null);
    // La fecha de la tarjeta es la más RECIENTE de las ruedas que avisan: es la
    // que contesta «¿de cuándo es este aviso?». Dentro de un vehículo puede
    // haber ruedas de días distintos, y cada recuadro lleva la suya.
    const fechas = conAviso.map((r) => r.fecha).filter((f): f is string => !!f).sort();
    const medidoEl = fechas.length > 0 ? fechas[fechas.length - 1] : null;

    const minimos = [...new Set(suyas.map((r) => r.minimo_mm).filter((m): m is number => m != null))];
    const medidas = [...new Set(suyas.map((r) => r.medida).filter((m): m is string => !!m))];

    vehiculos.push({
      vehiculoId,
      matricula: cabecera.matricula ?? "",
      unidad: cabecera.numero_unidad,
      tipo: cabecera.tipo_vehiculo,
      activo: cabecera.vehiculo_activo !== false,
      foto: cabecera.imagen_chasis_url,
      medidas,
      minimo: minimos.length === 1 ? minimos[0] : null,
      ruedas,
      paraCambiar: paraCambiar.length,
      conPresion: ruedas.filter((r) => r.estado === "presion").length,
      peor: profundidades.length > 0 ? Math.min(...profundidades) : null,
      medidoEl,
      diasDesdeMedicion: medidoEl ? diasAtras(medidoEl, hoy) : null,
    });
  }
  return vehiculos;
}

export type OrdenVehiculos = "peor" | "ruedas" | "antiguedad" | "matricula";

export function ordenarVehiculos(lista: VehiculoConAlertas[], orden: OrdenVehiculos): VehiculoConAlertas[] {
  const copia = [...lista];
  const porMatricula = (a: VehiculoConAlertas, b: VehiculoConAlertas) => a.matricula.localeCompare(b.matricula, "es");
  switch (orden) {
    case "peor":
      // Un vehículo sin ninguna goma gastada —el que solo tiene aviso de
      // presión— no tiene «peor»: va delante, que su aviso es de ahora.
      return copia.sort((a, b) => (a.peor ?? -1) - (b.peor ?? -1) || porMatricula(a, b));
    case "ruedas":
      return copia.sort((a, b) => b.paraCambiar + b.conPresion - (a.paraCambiar + a.conPresion) || porMatricula(a, b));
    case "antiguedad":
      return copia.sort((a, b) => (b.diasDesdeMedicion ?? -1) - (a.diasDesdeMedicion ?? -1) || porMatricula(a, b));
    default:
      return copia.sort(porMatricula);
  }
}

export type FiltroVehiculos = "todo" | "cambiar" | "presion" | "vieja";

export function filtrarVehiculos(lista: VehiculoConAlertas[], filtro: FiltroVehiculos): VehiculoConAlertas[] {
  switch (filtro) {
    case "cambiar": return lista.filter((v) => v.paraCambiar > 0);
    case "presion": return lista.filter((v) => v.conPresion > 0);
    case "vieja": return lista.filter((v) => (v.diasDesdeMedicion ?? 0) > DIAS_MEDICION_VIEJA);
    default: return lista;
  }
}

/** El resumen rojo o ámbar de la cabecera de la tarjeta. */
export function resumenDeTarjeta(v: VehiculoConAlertas): string {
  if (v.paraCambiar === 0 && v.conPresion > 0) return v.conPresion === 1 ? "Presión baja" : `${v.conPresion} avisos de presión`;
  const ruedas = `${v.paraCambiar} ${v.paraCambiar === 1 ? "rueda" : "ruedas"}`;
  const peor = v.peor != null ? ` · peor ${mm(v.peor)} mm` : "";
  const presion = v.conPresion > 0 ? " · y presión" : "";
  return `${ruedas}${peor}${presion}`;
}
