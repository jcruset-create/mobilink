/**
 * Alta de talleres de la red que se dan por catálogo, no desde el panel.
 *
 * Se ejecuta dentro de `initConnect()`, es idempotente y **no pisa datos**: si
 * el taller ya existe solo rellena los campos que estén vacíos, de modo que lo
 * que Central Pro haya corregido a mano manda sobre el catálogo.
 */

import crypto from "node:crypto";
import db from "../db.ts";

export interface SeedWorkshop {
  /** Empresa proveedora a la que pertenece (se crea si no existe). */
  company: string;
  name: string;
  /** Red comercial o franquicia (Confortauto, Euromaster…). */
  commercialNetwork?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  province?: string;
  latitude: number;
  longitude: number;
  phone?: string;
  email?: string;
  /** Códigos de `connect_service_types`: tyres, mechanical, tow_truck… */
  services: string[];
  openingHours?: string;
  /** assist (FULL) | lite (LITE) | external (EXTERNAL). */
  integrationType: "assist" | "lite" | "external";
  radiusKm?: number;
  connectStatus?: "active" | "observation" | "blocked";
}

export const NETWORK_WORKSHOPS: SeedWorkshop[] = [
  {
    company: "Grupo Soledad",
    name: "Confortauto Neumáticos Polinyà",
    commercialNetwork: "Confortauto",
    address: "Ctra. Santa Perpetua a Sentmenat, Km 1,4 Nave 5",
    postalCode: "08213",
    city: "Polinyà",
    province: "Barcelona",
    latitude: 41.5569,
    longitude: 2.1528,
    phone: "937133317",
    email: "tallerpolinya@gruposoledad.net",
    services: ["tyres", "mechanical"],
    openingHours: "L-V 08:30-13:30|15:00-18:30; Sáb 09:00-13:00",
    // Taller de red sin Mobilink Assist contratado: la central lleva los
    // estados a mano hasta que se le active Lite o Assist completo.
    integrationType: "external",
    connectStatus: "active",
  },
];

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

export async function seedNetworkWorkshops(): Promise<void> {
  const now = Date.now();

  for (const w of NETWORK_WORKSHOPS) {
    const companyId = await providerCompanyId(w.company, now);
    const existing = await db.query(
      `SELECT id FROM connect_workshops WHERE lower(name) = lower($1) LIMIT 1`,
      [w.name],
    );

    if (!existing.rows[0]) {
      await db.query(
        `INSERT INTO connect_workshops
           ("providerCompanyId", name, "commercialNetwork", address, "postalCode", city, province,
            latitude, longitude, phone, email, services, "openingHours",
            "integrationType", "connectStatus", "radiusKm", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
        [
          companyId, w.name, w.commercialNetwork ?? null, w.address ?? null, w.postalCode ?? null,
          w.city ?? null, w.province ?? null, w.latitude, w.longitude, w.phone ?? null,
          w.email ?? null, JSON.stringify(w.services), w.openingHours ?? null,
          w.integrationType, w.connectStatus ?? "active", w.radiusKm ?? 60, now,
        ],
      );
      console.log(`[Connect] taller de red dado de alta: ${w.name}`);
      continue;
    }

    // Ya existía: solo se completan los huecos, nunca se sobrescribe.
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
         "openingHours" = COALESCE("openingHours", $10)
       WHERE id = $1`,
      [
        existing.rows[0].id, companyId, w.commercialNetwork ?? null, w.address ?? null,
        w.postalCode ?? null, w.city ?? null, w.province ?? null, w.phone ?? null,
        w.email ?? null, w.openingHours ?? null,
      ],
    );
  }
}
