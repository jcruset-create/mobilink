/**
 * Alta de talleres de la red que se dan por catálogo, no desde el panel.
 *
 * Se ejecuta dentro de `initConnect()`, es idempotente y **no pisa datos**: si
 * el taller ya existe solo rellena los campos que estén vacíos, de modo que lo
 * que Central Pro haya corregido a mano manda sobre el catálogo.
 */

import crypto from "node:crypto";
import db from "../db.ts";
import { buscarDuplicados } from "./workshopImport.ts";
import { NETWORK_WORKSHOPS, type SeedWorkshop } from "./workshopCatalog.ts";

/** Empresa proveedora por nombre; la crea si aún no está en Central Pro. */
async function providerCompanyId(name: string, now: number): Promise<number> {
  const found = await db.query(
    `SELECT id FROM connect_provider_companies WHERE lower(name) = lower($1) AND "deletedAtMs" IS NULL LIMIT 1`,
    [name],
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await db.query(
    `INSERT INTO connect_provider_companies (uuid, name, "coreInstance", "createdAtMs", "updatedAtMs")
     VALUES ($1, $2, 'external', $3, $3) RETURNING id`,
    [crypto.randomUUID(), name, now],
  );
  return created.rows[0].id;
}

/**
 * Coordenadas de una dirección del catálogo (Google Geocoding, la misma clave
 * que usan los ETAs). Devuelve null si no hay clave o si no se encuentra: sin
 * coordenadas el taller no se da de alta, porque inventarlas sería peor.
 */
export async function geocodificar(w: {
  address?: string | null; postalCode?: string | null;
  city?: string | null; province?: string | null;
}): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const direccion = [w.address, w.postalCode, w.city, w.province, "España"]
    .map((p) => p?.trim()).filter(Boolean).join(", ");
  if (!direccion) return null;

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", direccion);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "es");
  url.searchParams.set("components", w.postalCode ? `postal_code:${w.postalCode}|country:ES` : "country:ES");

  const r = await fetch(url);
  if (!r.ok) throw new Error(`geocoding HTTP ${r.status}`);
  const data = (await r.json()) as {
    status?: string;
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  };
  if (data.status === "ZERO_RESULTS" || !data.results?.[0]) return null;
  if (data.status !== "OK") throw new Error(`geocoding ${data.status}`);
  const loc = data.results[0].geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

/**
 * ¿Está ya este taller en Central, aunque se llame de otra forma?
 *
 * Comparar por nombre exacto no basta: la red se ha ido dando de alta a mano y
 * el mismo centro puede figurar como "Confortauto Pneumàtics Sabadell" o
 * "Confortauto Sabadell". Se usan las mismas reglas que la importación por
 * WhatsApp (nombre normalizado, teléfono, dirección y cercanía), para que el
 * catálogo no cree una segunda ficha del mismo taller.
 */
async function tallerYaExistente(w: SeedWorkshop): Promise<{ id: number; name: string; motivos: string[] } | null> {
  const existentes = await db.query(
    `SELECT id, name, phone, address, latitude, longitude FROM connect_workshops`,
  );
  const filas = existentes.rows.map((r: any) => ({
    ...r,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
  }));
  return buscarDuplicados(
    { name: w.name, phone: w.phone ?? null, address: w.address ?? null,
      latitude: w.latitude ?? null, longitude: w.longitude ?? null },
    filas,
  )[0] ?? null;
}

export async function seedNetworkWorkshops(): Promise<void> {
  const now = Date.now();
  const sinCoordenadas: string[] = [];

  for (const w of NETWORK_WORKSHOPS) {
    const companyId = await providerCompanyId(w.company, now);
    const yaEsta = await tallerYaExistente(w);

    if (yaEsta) {
      // Ya existe (con este nombre o con otro): solo se completan los huecos.
      // Nunca se sobrescribe lo que Central tenga puesto a mano.
      await db.query(
        `UPDATE connect_workshops SET
           "providerCompanyId" = COALESCE("providerCompanyId", $2),
           "commercialNetwork" = COALESCE("commercialNetwork", $3),
           address = COALESCE(address, $4),
           "postalCode" = COALESCE("postalCode", $5),
           city = COALESCE(city, $6),
           province = COALESCE(province, $7),
           phone = COALESCE(phone, $8),
           email = COALESCE(email, $9),
           "openingHours" = COALESCE("openingHours", $10),
           notes = COALESCE(notes, $11)
         WHERE id = $1`,
        [
          yaEsta.id, companyId, w.commercialNetwork ?? null, w.address ?? null,
          w.postalCode ?? null, w.city ?? null, w.province ?? null, w.phone ?? null,
          w.email ?? null, w.openingHours ?? null, w.notes ?? null,
        ],
      );
      if (yaEsta.name.toLowerCase() !== w.name.toLowerCase()) {
        console.log(
          `[Connect] "${w.name}" ya estaba como "${yaEsta.name}" (${yaEsta.motivos.join(", ")}): ` +
          `no se duplica, solo se completan los datos que faltaban`,
        );
      }
      continue;
    }

    // Sin coordenadas no hay alta: la columna es obligatoria y no se inventan
    let punto = w.latitude != null && w.longitude != null
      ? { lat: w.latitude, lng: w.longitude }
      : null;
    if (!punto) {
      try {
        punto = await geocodificar(w);
      } catch (e: any) {
        console.error(`[Connect] geocodificando "${w.name}": ${e?.message}`);
      }
    }
    if (!punto) {
      sinCoordenadas.push(w.name);
      continue;
    }

    await db.query(
      `INSERT INTO connect_workshops
         ("providerCompanyId", name, "commercialNetwork", address, "postalCode", city, province,
          latitude, longitude, phone, email, services, "openingHours", notes,
          "integrationType", "connectStatus", "radiusKm", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
      [
        companyId, w.name, w.commercialNetwork ?? null, w.address ?? null, w.postalCode ?? null,
        w.city ?? null, w.province ?? null, punto.lat, punto.lng, w.phone ?? null,
        w.email ?? null, JSON.stringify(w.services), w.openingHours ?? null, w.notes ?? null,
        w.integrationType, w.connectStatus ?? "active", w.radiusKm ?? 60, now,
      ],
    );
    console.log(`[Connect] taller de red dado de alta: ${w.name} (${punto.lat}, ${punto.lng})`);
  }

  if (sinCoordenadas.length) {
    console.warn(
      `[Connect] ${sinCoordenadas.length} taller(es) del catálogo sin coordenadas, no dados de alta ` +
      `(¿falta GOOGLE_MAPS_API_KEY o la Geocoding API?): ${sinCoordenadas.join("; ")}`,
    );
  }
}
