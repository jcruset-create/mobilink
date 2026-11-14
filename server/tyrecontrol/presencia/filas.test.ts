/**
 * Pruebas de lo que se escribe en cada barrido.
 *
 * Esta parte no la cubría nada, y ahí se escondía el fallo que dejó la tabla
 * vacía en producción: el adaptador iba contra Supabase entero, así que no
 * había nada que probar sin base de datos. Ahora la decisión —qué fila sale y
 * si la estancia continúa— es una función pura y se comprueba aquí.
 */

import { describe, expect, it } from "vitest";
import { filaCambia, filaDePresencia, mismaEstancia, type Anterior } from "./filas.ts";
import type { FilaPresencia } from "../../integration-hub/application/services/BasePresenceService.ts";

const AHORA = "2026-09-13T12:00:00Z";
const POSICION = new Date("2026-09-13T11:55:00Z");

function fila(over: Partial<FilaPresencia> = {}): FilaPresencia {
  return {
    tenantId: "plana",
    vehiculoId: "v1",
    matricula: "1234ABC",
    estado: "IN_BASE",
    baseId: "reus",
    baseNombre: "Reus",
    esSuBase: true,
    distanciaM: 42.7,
    antiguedadMin: 5,
    lat: 41.128,
    lng: 1.186,
    velocidadKmh: 0,
    posicionAt: POSICION,
    proveedor: "movertis",
    cuenta: "buses",
    externo: "E1",
    calculadoAt: new Date(AHORA),
    ...over,
  } as FilaPresencia;
}

const prev = (over: Partial<Anterior> = {}): Anterior => ({
  estado: "IN_BASE",
  delegacion_id: "reus",
  entrada_base_at: "2026-09-12T20:00:00Z",
  ...over,
});

describe("mismaEstancia()", () => {
  it("sigue siendo la misma si no ha cambiado de base", () => {
    expect(mismaEstancia("reus", prev())).toBe(true);
  });

  it("un equipo dormido dentro de la base NO reinicia la estancia", () => {
    // Es lo normal en esta flota: el autobús aparca y el GPS se calla. Contarlo
    // como llegada nueva convertiría «lleva tres días aquí» en «acaba de
    // llegar», que es justo lo contrario de la verdad.
    expect(mismaEstancia("reus", prev({ estado: "STALE_POSITION" }))).toBe(true);
  });

  it("cambiar de base empieza estancia nueva", () => {
    expect(mismaEstancia("vilanova", prev())).toBe(false);
  });

  it("venir de fuera o de no saberse empieza estancia nueva", () => {
    expect(mismaEstancia("reus", prev({ estado: "OUTSIDE_BASES", delegacion_id: null }))).toBe(false);
    expect(mismaEstancia("reus", prev({ estado: "NO_POSITION", delegacion_id: null }))).toBe(false);
    expect(mismaEstancia("reus", undefined)).toBe(false);
  });

  it("sin base detectada no hay estancia que continuar", () => {
    expect(mismaEstancia(undefined, prev())).toBe(false);
  });
});

describe("filaDePresencia()", () => {
  it("conserva la hora de llegada mientras siga en la misma base", () => {
    const f = filaDePresencia(fila(), prev(), AHORA);
    expect(f.entrada_base_at).toBe("2026-09-12T20:00:00Z");
    expect(f.delegacion_id).toBe("reus");
    expect(f.es_su_base).toBe(true);
    expect(f.empresa_id).toBe("plana");
  });

  it("al cambiar de base, la llegada es la de la posición, no la del barrido", () => {
    const f = filaDePresencia(fila({ baseId: "vilanova" }), prev(), AHORA);
    expect(f.entrada_base_at).toBe(POSICION.toISOString());
  });

  it("fuera de toda base no se guarda ni base ni llegada", () => {
    const f = filaDePresencia(
      fila({ estado: "OUTSIDE_BASES", baseId: undefined, baseNombre: undefined, esSuBase: undefined }),
      prev(),
      AHORA,
    );
    expect(f.delegacion_id).toBeNull();
    expect(f.entrada_base_at).toBeNull();
    expect(f.es_su_base).toBeNull();
  });

  it("sin posición fechada no se inventa la hora de llegada", () => {
    const f = filaDePresencia(fila({ posicionAt: undefined }), undefined, AHORA);
    expect(f.posicion_at).toBeNull();
    expect(f.entrada_base_at).toBeNull();
  });

  it("la distancia se redondea a metros y el motivo viaja tal cual", () => {
    const f = filaDePresencia(
      fila({ estado: "NO_POSITION", baseId: undefined, motivo: "sin_enlace", distanciaM: undefined }),
      undefined,
      AHORA,
    );
    expect(f.motivo).toBe("sin_enlace");
    expect(f.distancia_m).toBeNull();
    expect(filaDePresencia(fila(), undefined, AHORA).distancia_m).toBe(43);
  });

  it("velocidad cero se guarda como cero, no como ausencia", () => {
    // Un autobús parado marca 0 y eso es el dato que dice que está aparcado.
    expect(filaDePresencia(fila({ velocidadKmh: 0 }), undefined, AHORA).velocidad_kmh).toBe(0);
  });
});

/**
 * Lo que decide si una fila se escribe o se deja en paz.
 *
 * El barrido reescribía las 717 filas en cada vuelta, y medido el 10/11/2026
 * solo 356 vehículos traían posición más fresca que el intervalo de diez
 * minutos. Lo que se fija aquí es que «no ha cambiado» signifique lo que tiene
 * que significar: que el DATO es el mismo, no que el barrido no haya vuelto a
 * pasar.
 */
describe("filaCambia()", () => {
  const guardada = (over: Partial<Anterior> = {}): Anterior =>
    ({
      estado: "IN_BASE",
      delegacion_id: "reus",
      entrada_base_at: "2026-09-12T20:00:00+00:00",
      es_su_base: true,
      distancia_m: 43,
      lat: 41.128,
      lng: 1.186,
      velocidad_kmh: 0,
      posicion_at: "2026-09-13T11:55:00+00:00",
      proveedor: "movertis",
      cuenta: "buses",
      externo: "E1",
      motivo: null,
      ...over,
    }) as Anterior;

  it("sin fila anterior siempre hay que escribir", () => {
    expect(filaCambia(filaDePresencia(fila(), undefined, AHORA), undefined)).toBe(true);
  });

  it("el mismo vehículo quieto no se reescribe", () => {
    // El caso de 361 de los 717: aparcado en su base, nada que decir.
    expect(filaCambia(filaDePresencia(fila(), guardada(), AHORA), guardada())).toBe(false);
  });

  it("la hora del barrido NO cuenta como cambio", () => {
    // `calculado_at` y `updated_at` son de la vuelta, no del vehículo. Si
    // contaran, no se saltaría ni una fila y todo esto no serviría de nada.
    const otraVuelta = filaDePresencia(
      fila({ calculadoAt: new Date("2026-09-13T18:30:00Z") }),
      guardada(),
      "2026-09-13T18:30:00Z",
    );
    expect(filaCambia(otraVuelta, guardada())).toBe(false);
  });

  it("que la posición envejezca tampoco cuenta", () => {
    // `antiguedad_min` crece sola aunque no llegue nada: se recalcula al leer.
    expect(filaCambia(filaDePresencia(fila({ antiguedadMin: 240 }), guardada(), AHORA), guardada()))
      .toBe(false);
  });

  it("«Z» y «+00:00» son el mismo instante, no un cambio", () => {
    // Escribimos `toISOString()` («…Z») y Supabase devuelve «…+00:00». Si se
    // compararan como texto, TODAS las filas saldrían cambiadas siempre y el
    // ahorro sería cero sin que nada fallara a la vista.
    const nueva = filaDePresencia(fila(), guardada(), AHORA);
    expect(String(nueva.posicion_at)).toContain("Z");
    expect(guardada().posicion_at).toContain("+00:00");
    expect(filaCambia(nueva, guardada())).toBe(false);
  });

  it("salir de la base sí se escribe", () => {
    const nueva = filaDePresencia(
      fila({ estado: "OUTSIDE_BASES", baseId: undefined, esSuBase: false }),
      guardada(),
      AHORA,
    );
    expect(filaCambia(nueva, guardada())).toBe(true);
  });

  it("moverse dentro de la base se escribe", () => {
    expect(filaCambia(filaDePresencia(fila({ lat: 41.2, distanciaM: 900 }), guardada(), AHORA), guardada()))
      .toBe(true);
  });

  it("una posición nueva se escribe aunque el vehículo no se haya movido", () => {
    // El GPS vuelve a reportar desde el mismo sitio: `posicion_at` cambia y eso
    // es un dato, es la prueba de que el equipo sigue vivo.
    const nueva = filaDePresencia(
      fila({ posicionAt: new Date("2026-09-13T11:58:00Z") }),
      guardada(),
      AHORA,
    );
    expect(filaCambia(nueva, guardada())).toBe(true);
  });

  it("cambiar de base se escribe", () => {
    expect(filaCambia(filaDePresencia(fila({ baseId: "vilanova", esSuBase: false }), guardada(), AHORA), guardada()))
      .toBe(true);
  });

  it("un vehículo dormido no se reescribe", () => {
    // Son 155 de los 717: STALE_POSITION con la posición de hace más de una
    // hora. Vuelta tras vuelta dicen exactamente lo mismo.
    const dormido = guardada({ estado: "STALE_POSITION" });
    const nueva = filaDePresencia(fila({ estado: "STALE_POSITION" }), dormido, AHORA);
    expect(filaCambia(nueva, dormido)).toBe(false);
  });
});
