/**
 * Las tablets en el Mapa flota, contra PostgreSQL: la regla vive en el SQL
 * (pisar la última, no pisar con una más vieja, ocultar las de hace un día).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

describeSiHayBase("posición de las tablets para el Mapa flota", () => {
  let db: any;
  let mod: typeof import("./posicionTablet.ts");
  const tecnico = `Tablet-${Date.now()}`;
  const ahora = Date.now();

  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    mod = await import("./posicionTablet.ts");
  });

  afterAll(async () => {
    await db.query(`DELETE FROM tablet_posicion WHERE "techName" = $1`, [tecnico]);
  });

  const mia = async () => (await mod.listarTabletsEnMapa(null, ahora)).find((t) => t.techName === tecnico);

  it("guarda la posición y la enseña en el mapa", async () => {
    await mod.guardarPosicionTablet(tecnico, { lat: 41.1, lng: 1.2, atMs: ahora - 60_000, speedKmh: 50 });
    expect(await mia()).toMatchObject({ lat: 41.1, lng: 1.2, speedKmh: 50, esPropio: true });
  });

  it("una más nueva pisa a la anterior; una más vieja no", async () => {
    await mod.guardarPosicionTablet(tecnico, { lat: 41.2, lng: 1.3, atMs: ahora - 30_000 });
    await mod.guardarPosicionTablet(tecnico, { lat: 40.0, lng: 0.5, atMs: ahora - 90_000 });
    expect(await mia()).toMatchObject({ lat: 41.2, lng: 1.3 });
  });

  it("un (0, 0) de GPS sin fijar no se guarda", async () => {
    await mod.guardarPosicionTablet(tecnico, { lat: 0, lng: 0, atMs: ahora });
    expect(await mia()).toMatchObject({ lat: 41.2 });
  });

  it("una posición de hace más de un día no sale", async () => {
    expect((await mod.listarTabletsEnMapa(null, ahora + mod.MAX_EDAD_EN_MAPA_MS + 60_000))
      .some((t) => t.techName === tecnico)).toBe(false);
  });

  it("la última posición se puede leer para el respaldo de la asistencia", async () => {
    expect(await mod.ultimaPosicionTablet(tecnico)).toEqual({ lat: 41.2, lng: 1.3, atMs: ahora - 30_000 });
    expect(await mod.ultimaPosicionTablet(`${tecnico}-nadie`)).toBeNull();
  });

  it("al cerrar sesión desaparece del mapa", async () => {
    await mod.borrarPosicionTablet(tecnico);
    expect(await mia()).toBeUndefined();
  });
});
