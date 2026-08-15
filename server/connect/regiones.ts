/**
 * Provincia → comunidad autónoma.
 *
 * Hace falta para saber qué festivos autonómicos le tocan a cada taller. Los
 * talleres guardan la provincia como texto libre —viene de importaciones, de
 * WhatsApp y de altas a mano— así que la búsqueda normaliza acentos, artículos
 * y las dos formas oficiales de los nombres gallegos y vascos.
 *
 * Es geografía, no configuración de ningún cliente: no cambia y no depende de
 * la central. Por eso está en código y no en la base.
 */

export interface Region {
  code: string;
  name: string;
}

export const REGIONES: Region[] = [
  { code: "AN", name: "Andalucía" },
  { code: "AR", name: "Aragón" },
  { code: "AS", name: "Principado de Asturias" },
  { code: "IB", name: "Illes Balears" },
  { code: "CN", name: "Canarias" },
  { code: "CB", name: "Cantabria" },
  { code: "CM", name: "Castilla-La Mancha" },
  { code: "CL", name: "Castilla y León" },
  { code: "CT", name: "Cataluña" },
  { code: "EX", name: "Extremadura" },
  { code: "GA", name: "Galicia" },
  { code: "MD", name: "Comunidad de Madrid" },
  { code: "MC", name: "Región de Murcia" },
  { code: "NC", name: "Comunidad Foral de Navarra" },
  { code: "PV", name: "País Vasco" },
  { code: "RI", name: "La Rioja" },
  { code: "VC", name: "Comunitat Valenciana" },
  { code: "CE", name: "Ceuta" },
  { code: "ML", name: "Melilla" },
];

/** Provincia normalizada → código de comunidad autónoma. */
const PROVINCIAS: Record<string, string> = {
  almeria: "AN", cadiz: "AN", cordoba: "AN", granada: "AN", huelva: "AN",
  jaen: "AN", malaga: "AN", sevilla: "AN",

  huesca: "AR", teruel: "AR", zaragoza: "AR",

  asturias: "AS", oviedo: "AS",

  baleares: "IB", "illes balears": "IB", "islas baleares": "IB", mallorca: "IB",

  "las palmas": "CN", "santa cruz de tenerife": "CN", tenerife: "CN",

  cantabria: "CB", santander: "CB",

  albacete: "CM", "ciudad real": "CM", cuenca: "CM", guadalajara: "CM", toledo: "CM",

  avila: "CL", burgos: "CL", leon: "CL", palencia: "CL", salamanca: "CL",
  segovia: "CL", soria: "CL", valladolid: "CL", zamora: "CL",

  barcelona: "CT", girona: "CT", gerona: "CT", lleida: "CT", lerida: "CT",
  tarragona: "CT",

  badajoz: "EX", caceres: "EX",

  "a coruna": "GA", "la coruna": "GA", coruna: "GA", lugo: "GA",
  ourense: "GA", orense: "GA", pontevedra: "GA",

  madrid: "MD",
  murcia: "MC",
  navarra: "NC", pamplona: "NC",

  alava: "PV", araba: "PV", "vitoria": "PV",
  guipuzcoa: "PV", gipuzkoa: "PV", "san sebastian": "PV",
  vizcaya: "PV", bizkaia: "PV", bilbao: "PV",

  "la rioja": "RI", logrono: "RI", rioja: "RI",

  alicante: "VC", alacant: "VC", castellon: "VC", castello: "VC",
  valencia: "VC",

  ceuta: "CE", melilla: "ML",
};

/** Quita acentos, artículos y sobrantes para poder comparar nombres escritos a mano. */
export function normalizarProvincia(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // fuera acentos
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(provincia de |prov\s+)/, "")
    .trim();
}

/**
 * Comunidad autónoma de una provincia, o null si no se reconoce.
 *
 * Devuelve null en lugar de adivinar: un taller asignado a la comunidad
 * equivocada tendría los festivos de otro sitio, y eso es peor que no tener
 * ninguno —al menos la ausencia se ve—.
 */
export function regionDeProvincia(provincia: string | null | undefined): string | null {
  const p = normalizarProvincia(provincia);
  if (!p) return null;
  if (PROVINCIAS[p]) return PROVINCIAS[p];

  // "Barcelona (Cataluña)", "Valencia/València" y demás formas compuestas
  for (const parte of p.split(/[/()-]/).map((x) => x.trim())) {
    if (parte && PROVINCIAS[parte]) return PROVINCIAS[parte];
  }
  return null;
}

export function nombreRegion(code: string | null | undefined): string | null {
  return REGIONES.find((r) => r.code === code)?.name ?? null;
}
