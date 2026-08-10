/**
 * Revisión del catálogo de talleres de la red.
 *
 * El catálogo se da de alta solo al arrancar, así que un error aquí entra
 * directo en producción sin que nadie lo revise. Estas pruebas son ese
 * revisor: comprueban que no hay dos fichas del mismo taller, que los datos
 * mínimos están y que los códigos son de los que Central entiende.
 */

import { describe, expect, it } from "vitest";
import { NETWORK_WORKSHOPS } from "./workshopCatalog.ts";
import { SERVICE_CODES, buscarDuplicados, normalizarNombre, normalizarTelefono } from "./workshopImport.ts";

describe("catálogo de talleres de la red", () => {
  it("no repite el mismo taller dentro del propio catálogo", () => {
    const repetidos: string[] = [];
    NETWORK_WORKSHOPS.forEach((w, i) => {
      const anteriores = NETWORK_WORKSHOPS.slice(0, i).map((x, j) => ({
        id: j, name: x.name, phone: x.phone ?? null, address: x.address ?? null,
        latitude: x.latitude ?? null, longitude: x.longitude ?? null,
      }));
      const dup = buscarDuplicados(
        { name: w.name, phone: w.phone ?? null, address: w.address ?? null,
          latitude: w.latitude ?? null, longitude: w.longitude ?? null },
        anteriores,
      );
      if (dup.length) repetidos.push(`${w.name} ↔ ${dup[0].name} (${dup[0].motivos.join(", ")})`);
    });
    expect(repetidos).toEqual([]);
  });

  it("no repite nombre exacto", () => {
    const nombres = NETWORK_WORKSHOPS.map((w) => w.name.toLowerCase());
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("no repite teléfono", () => {
    const tels = NETWORK_WORKSHOPS.map((w) => normalizarTelefono(w.phone)).filter(Boolean);
    expect(new Set(tels).size).toBe(tels.length);
  });

  it("todos tienen nombre, empresa, municipio y provincia", () => {
    for (const w of NETWORK_WORKSHOPS) {
      expect(w.name.trim(), "nombre").not.toBe("");
      expect(w.company.trim(), `${w.name}: empresa`).not.toBe("");
      expect(w.city?.trim() ?? "", `${w.name}: municipio`).not.toBe("");
      expect(w.province?.trim() ?? "", `${w.name}: provincia`).not.toBe("");
    }
  });

  it("todos se pueden situar: o traen coordenadas o traen dirección que geocodificar", () => {
    for (const w of NETWORK_WORKSHOPS) {
      const situable = (w.latitude != null && w.longitude != null) || !!w.address?.trim();
      expect(situable, `${w.name} no se puede situar en el mapa`).toBe(true);
    }
  });

  it("solo usa códigos de servicio que Central entiende", () => {
    for (const w of NETWORK_WORKSHOPS) {
      expect(w.services.length, `${w.name} sin servicios`).toBeGreaterThan(0);
      for (const s of w.services) {
        expect(SERVICE_CODES, `${w.name}: servicio "${s}"`).toContain(s);
      }
    }
  });

  it("solo usa productos válidos", () => {
    for (const w of NETWORK_WORKSHOPS) {
      expect(["assist", "lite", "external"]).toContain(w.integrationType);
    }
  });

  it("los teléfonos tienen pinta de teléfono español", () => {
    for (const w of NETWORK_WORKSHOPS) {
      if (!w.phone) continue;
      expect(normalizarTelefono(w.phone), `${w.name}: teléfono "${w.phone}"`).toMatch(/^\d{9}$/);
    }
  });

  it("los códigos postales, cuando están, son de cinco dígitos", () => {
    for (const w of NETWORK_WORKSHOPS) {
      if (w.postalCode == null) continue;
      expect(w.postalCode, `${w.name}: CP`).toMatch(/^\d{5}$/);
    }
  });

  it("los emails, cuando están, son direcciones", () => {
    for (const w of NETWORK_WORKSHOPS) {
      if (!w.email) continue;
      expect(w.email, `${w.name}: email`).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
    }
  });

  it("el nombre normalizado no se queda vacío (rompería la detección de duplicados)", () => {
    for (const w of NETWORK_WORKSHOPS) {
      expect(normalizarNombre(w.name), `${w.name}`).not.toBe("");
    }
  });
});
