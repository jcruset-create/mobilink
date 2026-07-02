// Motor gráfico de vehículos — tipos base.
// La geometría vive SOLO en los SVG (vehicle-layouts/svgs/*.svg).
// Aquí solo se describen los metadatos que el motor necesita para
// resolver qué SVG cargar y cómo interpretar cada zona.

export type AxleType = "single" | "dual";

// Firma geométrica de un vehículo: para cada eje, si es simple (2 ruedas)
// o doble/gemelo (4 ruedas). Se calcula a partir de tc_posiciones_vehiculo,
// nunca a mano — así cualquier tipo de vehículo nuevo con la misma
// geometría reutiliza el mismo SVG sin tocar código.
export type AxleSignature = AxleType[]; // ej. ["single","dual","dual"] = tractora 3 ejes

export function signatureKey(sig: AxleSignature): string {
  return sig.map((a) => (a === "dual" ? "d" : "s")).join("-");
}

// Categoría amplia del vehículo (independiente de marca/modelo).
export type VehicleCategory =
  | "tractora" | "camion" | "semirremolque" | "remolque" | "autobus" | "furgoneta" | "turismo";

export type LayoutKey = `${VehicleCategory}:${string}`; // string = signatureKey

export function layoutKeyOf(categoria: VehicleCategory, sig: AxleSignature): LayoutKey {
  return `${categoria}:${signatureKey(sig)}`;
}

// Rectángulo de una zona, en coordenadas del viewBox del SVG (se calcula
// en runtime leyendo getBBox() del <g data-position> correspondiente).
export interface ZoneRect {
  id: string;          // debe coincidir con PosicionVehiculo.codigo_posicion
  x: number;
  y: number;
  width: number;
  height: number;
  axle: number | null;
  side: "izq" | "der" | null;
  io: "int" | "ext" | null;
}

export interface LayoutManifestEntry {
  categoria: VehicleCategory;
  signature: AxleSignature;
  viewBox: string;
  loader: () => Promise<string>;
}
