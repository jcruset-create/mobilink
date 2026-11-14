import { describe, expect, it } from "vitest";

import { destinoVolver, rutaConFiltros } from "./navegacionVolver";

const LISTA = "/tyrecontrol/ranking-kilometraje";
const RESERVA = { ruta: "/tyrecontrol/vehiculos", etiqueta: "Vehículos" };

describe("rutaConFiltros()", () => {
  it("lleva los filtros que hay", () => {
    expect(rutaConFiltros(LISTA, { empresa: "e-1", q: "1169" }))
      .toBe(`${LISTA}?empresa=e-1&q=1169`);
  });

  // La dirección se guarda y se manda por correo: tiene que decir lo que hay
  // puesto, no `?q=` colgando.
  it("y se salta los vacíos, en vez de dejarlos puestos", () => {
    expect(rutaConFiltros(LISTA, { empresa: "e-1", q: "" })).toBe(`${LISTA}?empresa=e-1`);
    expect(rutaConFiltros(LISTA, { empresa: null, q: undefined })).toBe(LISTA);
  });

  it("sin ningún filtro no deja ni la interrogación", () => {
    expect(rutaConFiltros(LISTA, {})).toBe(LISTA);
  });

  it("escapa lo que haga falta", () => {
    expect(rutaConFiltros(LISTA, { q: "1169 NNC & 1172" }))
      .toBe(`${LISTA}?q=1169+NNC+%26+1172`);
  });
});

describe("destinoVolver()", () => {
  it("vuelve a donde dice el origen", () => {
    expect(destinoVolver({ volverA: `${LISTA}?empresa=e-1`, volverEtiqueta: "Kilómetros por vehículo" }, RESERVA))
      .toEqual({ ruta: `${LISTA}?empresa=e-1`, etiqueta: "Kilómetros por vehículo" });
  });

  /*
   * El `state` de un enlace no viaja en la URL: recargar la página o entrar
   * por una dirección escrita a mano lo borra. Entonces se hace lo de
   * siempre, que es lo que hacía esta pantalla antes.
   */
  it("sin origen, al destino de siempre", () => {
    expect(destinoVolver(undefined, RESERVA)).toEqual(RESERVA);
    expect(destinoVolver(null, RESERVA)).toEqual(RESERVA);
    expect(destinoVolver({}, RESERVA)).toEqual(RESERVA);
  });

  /*
   * Y a medias tampoco. Un botón que pone «← Vehículos» y lleva al ranking es
   * peor que no tener botón: quien lo pulsa cree saber dónde acaba.
   */
  it("con ruta pero sin nombre, tampoco se usa", () => {
    expect(destinoVolver({ volverA: LISTA }, RESERVA)).toEqual(RESERVA);
    expect(destinoVolver({ volverEtiqueta: "Kilómetros por vehículo" }, RESERVA)).toEqual(RESERVA);
  });
});
