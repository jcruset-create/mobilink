/**
 * Interpretación de la búsqueda de ubicación del mapa operativo.
 *
 * En una central de asistencia el sitio llega dicho de cualquier manera: un
 * municipio, un código postal, un punto kilométrico de autopista, unas
 * coordenadas pegadas de WhatsApp o un enlace de Google Maps. Aquí se decide
 * qué es cada cosa y cómo preguntárselo al geocodificador.
 *
 * Puro y sin red, como `liteRules.ts` y `workshopImport.ts`: se prueba con
 * Vitest y el endpoint se limita a ejecutar lo que esto decide.
 */

export type TipoBusqueda = "coordenadas" | "enlace" | "codigo_postal" | "punto_kilometrico" | "texto";

export interface Interpretacion {
  tipo: TipoBusqueda;
  /** Resuelto sin geocodificar (coordenadas y enlaces). */
  punto?: { lat: number; lng: number };
  /**
   * Consultas a probar en orden contra el geocodificador. La primera que
   * responda gana; las siguientes son repliegues cada vez menos precisos.
   */
  consultas: string[];
  /** Filtro `components` de Google (código postal exacto, país). */
  componentes?: string;
  /** Cómo llamar a lo buscado en la respuesta. */
  etiqueta: string;
  /** Lo que el operador debe saber sobre la precisión de lo que va a ver. */
  avisos: string[];
}

/** Carreteras españolas: AP-7, A-2, N-340, N-II, C-31, B-30, CV-35, T-11… */
const CARRETERA = /\b([A-Z]{1,3})[-\s]?((?:\d{1,4})|(?:[IVX]{1,5}))\b/i;
/** Punto kilométrico: pk 234, p.k. 234,5, km 1170. */
const KILOMETRO = /\b(?:p\.?\s?k\.?|km|kil[oó]metro)\s*\.?\s*(\d{1,4}(?:[.,]\d{1,3})?)/i;
/** Coordenadas decimales sueltas: "41.5569, 2.1528" o "41,5569 2,1528". */
const COORDENADAS = /^\s*(-?\d{1,3}[.,]\d+)\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)\s*$/;

/** Coordenadas dentro de un enlace de Google Maps. */
function puntoDeEnlace(url: string): { lat: number; lng: number } | null {
  for (const p of [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]query=(-?\d+\.\d+),(-?\d+\.\d+)/]) {
    const m = url.match(p);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

export function interpretarBusqueda(entrada: string): Interpretacion | null {
  const q = (entrada ?? "").trim();
  if (!q) return null;

  const coords = q.match(COORDENADAS);
  if (coords) {
    const lat = Number(coords[1].replace(",", "."));
    const lng = Number(coords[2].replace(",", "."));
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return {
        tipo: "coordenadas", punto: { lat, lng }, consultas: [],
        etiqueta: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, avisos: [],
      };
    }
  }

  if (/^https?:\/\//i.test(q)) {
    const punto = puntoDeEnlace(q);
    if (punto) {
      return { tipo: "enlace", punto, consultas: [], etiqueta: `${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}`, avisos: [] };
    }
    return {
      tipo: "enlace", consultas: [], etiqueta: q,
      avisos: ["El enlace no lleva coordenadas dentro. Ábrelo y pega la dirección o las coordenadas que muestre."],
    };
  }

  if (/^\d{5}$/.test(q)) {
    return {
      tipo: "codigo_postal", consultas: [q],
      componentes: `postal_code:${q}|country:ES`,
      etiqueta: `CP ${q}`,
      avisos: ["Un código postal marca el centro de su zona, no una dirección concreta."],
    };
  }

  const carretera = q.match(CARRETERA);
  const kilometro = q.match(KILOMETRO);
  if (carretera && kilometro) {
    const via = `${carretera[1].toUpperCase()}-${carretera[2].toUpperCase()}`;
    const km = kilometro[1].replace(",", ".");
    // Lo que queda al quitar vía y km suele ser la provincia o el municipio,
    // y es justo lo que desempata un PK que se repite en varias carreteras.
    const resto = q.replace(CARRETERA, " ").replace(KILOMETRO, " ").replace(/[,;]/g, " ").trim();
    const consultas = [
      resto ? `${via} km ${km}, ${resto}, España` : `${via} km ${km}, España`,
      `${via} km ${km}, España`,
      resto ? `${via}, ${resto}, España` : `${via}, España`,
    ];
    return {
      tipo: "punto_kilometrico",
      consultas: [...new Set(consultas)],
      componentes: "country:ES",
      etiqueta: `${via} km ${km}`,
      avisos: [
        "Los puntos kilométricos los sitúa Google de forma aproximada: confírmalo con el cliente antes de mandar la grúa.",
      ],
    };
  }

  return {
    tipo: "texto",
    consultas: [q, `${q}, España`],
    componentes: "country:ES",
    etiqueta: q,
    avisos: carretera && !kilometro
      ? ["Has indicado una carretera sin punto kilométrico: se marca la vía, no un punto concreto."]
      : [],
  };
}

/** Kilómetros entre dos puntos (haversine), para ordenar los talleres. */
export function kmEntre(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Talleres más cercanos al punto buscado, ordenados por distancia en línea
 * recta. `enCobertura` dice si el punto cae dentro del radio declarado del
 * taller, que es la condición que aplica el motor de asignación.
 */
export function talleresCercanos<T extends { latitude: number; longitude: number; radiusKm: number }>(
  punto: { lat: number; lng: number },
  talleres: T[],
  limite = 8,
): Array<T & { distanceKm: number; enCobertura: boolean }> {
  return talleres
    .filter((w) => Number.isFinite(w.latitude) && Number.isFinite(w.longitude))
    .map((w) => {
      const distanceKm = Math.round(kmEntre(punto.lat, punto.lng, w.latitude, w.longitude) * 10) / 10;
      return { ...w, distanceKm, enCobertura: distanceKm <= Number(w.radiusKm || 60) };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limite);
}
