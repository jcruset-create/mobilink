/**
 * Capacidades del destino y degradación elegante.
 *
 * Lo que se fija: un destino sencillo no es un destino roto, y lo que no sabe
 * hacer se cuenta, no se inventa.
 */

import { describe, expect, it } from "vitest";

import { leerCapacidades, limitaciones, puede } from "./capacidadesDestino.ts";

describe("Capacidades del destino", () => {
  /* Es lo único que puede darse por supuesto de algo recién conectado. */
  it("sin declarar nada, se supone el mínimo: comunica estados", () => {
    expect(leerCapacidades(null)).toEqual(["supports_status_updates"]);
    expect(leerCapacidades([])).toEqual(["supports_status_updates"]);
    expect(leerCapacidades("[]")).toEqual(["supports_status_updates"]);
  });

  it("lee la lista guardada como JSON", () => {
    expect(puede('["supports_quotes"]', "supports_quotes")).toBe(true);
    expect(puede('["supports_quotes"]', "supports_documents")).toBe(false);
  });

  it("una capacidad inventada se descarta sin romper las buenas", () => {
    expect(leerCapacidades(["supports_documents", "supports_teletransporte"]))
      .toEqual(["supports_documents"]);
  });

  it("un JSON corrupto cae al mínimo en vez de reventar", () => {
    expect(leerCapacidades("{roto")).toEqual(["supports_status_updates"]);
  });

  it("dice en castellano lo que no va a pasar", () => {
    const l = limitaciones(["supports_status_updates"], ["supports_live_tracking", "supports_documents"]);
    expect(l).toHaveLength(2);
    expect(l[0]).toContain("posición en el mapa");
  });

  /* Listar las siete que faltan convierte el aviso en ruido. */
  it("solo avisa de lo que se iba a pedir", () => {
    expect(limitaciones(["supports_status_updates"], ["supports_status_updates"])).toEqual([]);
  });
});
