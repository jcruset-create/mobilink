/**
 * Reglas de importación de talleres (WhatsApp → Central Pro).
 *
 * Puras y sin base de datos, como `liteRules.ts`: se prueban con Vitest y
 * documentan el contrato que aplica tanto el endpoint como el panel.
 *
 * El formato de salida es el de `connect_workshops`, no un esquema propio: lo
 * que la IA propone es literalmente el cuerpo de POST /workshops, de modo que
 * entre la propuesta y el alta no haya ninguna traducción que pueda mentir.
 */

/** Códigos válidos de `connect_service_types`. */
export const SERVICE_CODES = [
  "tow_truck", "mechanical", "tyres", "battery", "fuel", "lockout",
  "electric_vehicle", "heavy_vehicle", "machinery", "other",
] as const;

/** Campos de un taller que la importación sabe rellenar. */
export interface WorkshopImportFields {
  name: string | null;
  companyName: string | null;
  commercialNetwork: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  openingHours: string | null;
  services: string[];
}

export interface WorkshopDuplicate {
  id: number;
  name: string;
  /** Por qué se parece: nombre, dirección, teléfono o cercanía. */
  motivos: string[];
}

/**
 * Ruido comercial que no forma parte del nombre del taller. Se aplica DESPUÉS
 * de quitar la puntuación, así que las formas jurídicas llegan aquí ya
 * separadas ("S.L." → "s l").
 */
const RUIDO = /\b(s\s?l\s?u?|s\s?a\s?u?|c\s?b|sociedad limitada|talleres?|neumaticos?|automocion|oficial)\b/g;

/**
 * Nombre comparable: sin acentos, mayúsculas, emojis, puntuación ni el ruido
 * habitual ("Talleres X, S.L." y "X" son el mismo taller).
 */
export function normalizarNombre(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(RUIDO, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Teléfono comparable: solo dígitos y, si es un número español con prefijo,
 * los nueve últimos. Así "+34 937 133 317" y "937133317" son el mismo.
 */
export function normalizarTelefono(valor: string | null | undefined): string {
  if (!valor) return "";
  const digitos = valor.replace(/\D/g, "");
  if (!digitos) return "";
  return digitos.length > 9 ? digitos.slice(-9) : digitos;
}

/** Dirección comparable: sin acentos, abreviaturas de vía ni puntuación. */
export function normalizarDireccion(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(c|c\/|calle|avda|avenida|ctra|carretera|pol|poligono|pg|nave|km)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Metros entre dos coordenadas (haversine). */
export function metrosEntre(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Dos talleres a menos de esto son, casi seguro, el mismo. */
const CERCA_M = 150;

/**
 * Talleres ya existentes que se parecen al que se quiere importar. Basta con
 * que coincida UNA señal fuerte: el operador decide, pero no se le deja crear
 * un duplicado sin avisarle.
 */
export function buscarDuplicados(
  candidato: Partial<WorkshopImportFields>,
  existentes: Array<{
    id: number; name: string; phone: string | null; address: string | null;
    latitude: number | null; longitude: number | null;
  }>,
): WorkshopDuplicate[] {
  const nombre = normalizarNombre(candidato.name);
  const telefono = normalizarTelefono(candidato.phone);
  const direccion = normalizarDireccion(candidato.address);
  const tieneCoords = typeof candidato.latitude === "number" && typeof candidato.longitude === "number";

  const encontrados: WorkshopDuplicate[] = [];
  for (const w of existentes) {
    const motivos: string[] = [];

    if (nombre && normalizarNombre(w.name) === nombre) motivos.push("mismo nombre");
    if (telefono && normalizarTelefono(w.phone) === telefono) motivos.push("mismo teléfono");
    if (direccion && normalizarDireccion(w.address) === direccion) motivos.push("misma dirección");
    if (tieneCoords && typeof w.latitude === "number" && typeof w.longitude === "number") {
      const m = metrosEntre(candidato.latitude!, candidato.longitude!, w.latitude, w.longitude);
      if (m <= CERCA_M) motivos.push(`a ${Math.round(m)} m`);
    }

    if (motivos.length) encontrados.push({ id: w.id, name: w.name, motivos });
  }
  // Primero los que coinciden en más cosas
  return encontrados.sort((a, b) => b.motivos.length - a.motivos.length);
}

/**
 * Deja la propuesta de la IA en el formato exacto de `connect_workshops`:
 * descarta códigos de servicio inventados, normaliza el teléfono a formato
 * internacional español y convierte a null lo que venga vacío.
 */
export function normalizarPropuesta(bruto: Record<string, any>): WorkshopImportFields {
  const texto = (v: any): string | null => {
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    return s.length ? s : null;
  };
  const numero = (v: any): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v ?? "").trim().replace(",", ".");
    if (!s) return null;               // ojo: Number("") es 0, no NaN
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  let phone = texto(bruto.phone);
  if (phone) {
    const digitos = phone.replace(/\D/g, "");
    // Nueve dígitos y sin prefijo: es un número español
    if (!phone.startsWith("+") && digitos.length === 9) phone = `+34${digitos}`;
  }

  const services = Array.isArray(bruto.services)
    ? bruto.services.filter((s: any): s is string => (SERVICE_CODES as readonly string[]).includes(s))
    : [];

  return {
    name: texto(bruto.name),
    companyName: texto(bruto.companyName),
    commercialNetwork: texto(bruto.commercialNetwork),
    address: texto(bruto.address),
    postalCode: texto(bruto.postalCode),
    city: texto(bruto.city),
    province: texto(bruto.province),
    latitude: numero(bruto.latitude),
    longitude: numero(bruto.longitude),
    phone,
    email: texto(bruto.email),
    openingHours: texto(bruto.openingHours),
    services,
  };
}
