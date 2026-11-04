import { describe, expect, it, vi } from "vitest";
import { MAX_PAGINAS, PAGINA, paginar } from "./paginar.ts";

/**
 * Esto existe porque PostgREST corta en silencio. Lo que se fija:
 *
 *  · Se sigue pidiendo mientras las páginas vengan LLENAS. Una página llena
 *    no significa «ya está»: significa justo lo contrario.
 *  · Un error de la base sale como excepción. Devolver lo leído hasta ahí
 *    sería exactamente el fallo que esto viene a evitar.
 *  · Si se agotan las vueltas, se avisa. Un informe a medias que no lo dice
 *    es peor que un informe que no sale.
 */

const paginaDe = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe("paginar", () => {
  it("una sola página incompleta: una sola llamada", async () => {
    const pedir = vi.fn().mockResolvedValue({ data: paginaDe(3), error: null });
    expect(await paginar(pedir)).toHaveLength(3);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith(0, PAGINA - 1);
  });

  it("vacía desde el principio: ni se repite ni revienta", async () => {
    const pedir = vi.fn().mockResolvedValue({ data: [], error: null });
    expect(await paginar(pedir)).toEqual([]);
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("una página llena NO es el final: se pide la siguiente", async () => {
    const pedir = vi.fn()
      .mockResolvedValueOnce({ data: paginaDe(PAGINA), error: null })
      .mockResolvedValueOnce({ data: paginaDe(PAGINA), error: null })
      .mockResolvedValueOnce({ data: paginaDe(7), error: null });
    expect(await paginar(pedir)).toHaveLength(2 * PAGINA + 7);
    expect(pedir).toHaveBeenNthCalledWith(2, PAGINA, 2 * PAGINA - 1);
    expect(pedir).toHaveBeenNthCalledWith(3, 2 * PAGINA, 3 * PAGINA - 1);
  });

  it("un error de la base no se devuelve como media lista", async () => {
    const pedir = vi.fn()
      .mockResolvedValueOnce({ data: paginaDe(PAGINA), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "se cayó" } });
    await expect(paginar(pedir)).rejects.toThrow("se cayó");
  });

  it("si no se acaba nunca, se dice: nada de informes a medias callados", async () => {
    const pedir = vi.fn().mockResolvedValue({ data: paginaDe(PAGINA), error: null });
    await expect(paginar(pedir)).rejects.toThrow(/Demasiadas filas/);
    expect(pedir).toHaveBeenCalledTimes(MAX_PAGINAS);
  });
});
