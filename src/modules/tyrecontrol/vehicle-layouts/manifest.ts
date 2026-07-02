import type { AxleSignature, LayoutKey, LayoutManifestEntry, VehicleCategory } from "./zones";
import { layoutKeyOf, signatureKey } from "./zones";
import type { PosicionVehiculo, TipoVehiculo } from "../types";

// Mapa nombre técnico (tc_tipos_vehiculo.nombre) → categoría del motor.
// Añadir un tipo de vehículo nuevo en BD que encaje en una categoría
// existente no requiere tocar el motor gráfico.
const CATEGORIA_POR_TIPO: Record<string, VehicleCategory> = {
  turismo: "turismo",
  furgoneta: "furgoneta",
  camion_2_ejes: "camion",
  camion_3_ejes: "camion",
  tractora: "tractora",
  remolque: "remolque",
  semirremolque: "semirremolque",
  autobus: "autobus",
  autocar: "autobus",
};

export function categoriaDeTipo(tipo?: TipoVehiculo | null): VehicleCategory | null {
  if (!tipo) return null;
  return CATEGORIA_POR_TIPO[tipo.nombre] ?? null;
}

// La firma de ejes se calcula SIEMPRE a partir de las posiciones reales
// del vehículo (tc_posiciones_vehiculo), nunca a mano: así el motor no
// depende de cómo se llame el modelo comercial, solo de su geometría.
export function firmaDePosiciones(posiciones: PosicionVehiculo[]): AxleSignature {
  const ejes = Array.from(new Set(posiciones.map((p) => p.eje).filter((e): e is number => e != null))).sort((a, b) => a - b);
  return ejes.map((eje) => {
    const enEje = posiciones.filter((p) => p.eje === eje);
    // eje doble = alguna posición tiene interior/exterior definido, o hay más de una posición por lado
    const tieneIO = enEje.some((p) => p.interior_exterior);
    const izq = enEje.filter((p) => p.lado === "izq").length;
    return tieneIO || izq > 1 ? "dual" : "single";
  });
}

// ── Registro de layouts disponibles ──────────────────────────
// Añadir una configuración nueva = añadir una entrada aquí + su SVG.
// Cero cambios en VehicleLayout.tsx ni en TirePosition.tsx.
const REGISTRY: LayoutManifestEntry[] = [
  {
    categoria: "tractora",
    signature: ["single", "dual", "dual"],
    viewBox: "0 0 1000 760",
    loader: () => import("./svgs/tractora-3ejes.svg?raw").then((m) => m.default),
  },
  {
    categoria: "semirremolque",
    signature: ["single", "single", "single"],
    viewBox: "0 0 1000 760",
    loader: () => import("./svgs/semirremolque-3ejes.svg?raw").then((m) => m.default),
  },
];

const REGISTRY_MAP: Map<LayoutKey, LayoutManifestEntry> = new Map(
  REGISTRY.map((e) => [layoutKeyOf(e.categoria, e.signature), e])
);

const cacheMarkup = new Map<LayoutKey, string>();

export interface LayoutResolution {
  key: LayoutKey;
  viewBox: string;
  markup: string;
}

export async function resolverLayout(categoria: VehicleCategory, signature: AxleSignature): Promise<LayoutResolution | null> {
  const key = layoutKeyOf(categoria, signature);
  const entry = REGISTRY_MAP.get(key);
  if (!entry) return null;
  if (!cacheMarkup.has(key)) cacheMarkup.set(key, await entry.loader());
  return { key, viewBox: entry.viewBox, markup: cacheMarkup.get(key)! };
}

export function layoutDisponible(categoria: VehicleCategory | null, signature: AxleSignature): boolean {
  if (!categoria) return false;
  return REGISTRY_MAP.has(layoutKeyOf(categoria, signature));
}

export { signatureKey };
