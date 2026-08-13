import { describe, it, expect } from "vitest";
import { recorrerPaginas } from "./paginacion";

/**
 * Un listado de mentira de `total` filas, que responde por páginas como lo
 * haría PostgREST y además anota cómo se le ha llamado: parte del contrato es
 * no pedir más páginas de las necesarias.
 */
function listadoDe(total: number) {
  const llamadas: { pagina: number; tamano: number }[] = [];
  const traer = async (pagina: number, tamano: number) => {
    llamadas.push({ pagina, tamano });
    const desde = pagina * tamano;
    const filas = Array.from({ length: Math.max(0, Math.min(tamano, total - desde)) }, (_, i) => desde + i);
    return { filas, total };
  };
  return { traer, llamadas };
}

describe("recorrerPaginas", () => {
  it("trae todo cuando cabe de sobra", async () => {
    const { traer, llamadas } = listadoDe(1250);
    const r = await recorrerPaginas(traer, 10000, 1000);
    expect(r.filas).toHaveLength(1250);
    expect(r.total).toBe(1250);
    expect(r.truncado).toBe(false);
    expect(llamadas).toHaveLength(2);
  });

  it("no pide una página de más cuando el total es múltiplo exacto del bloque", async () => {
    // El error clásico: 1000 de 1000 parece "quizá hay más" y se pide otra.
    const { traer, llamadas } = listadoDe(1000);
    const r = await recorrerPaginas(traer, 10000, 1000);
    expect(r.filas).toHaveLength(1000);
    expect(r.truncado).toBe(false);
    expect(llamadas).toHaveLength(1);
  });

  it("avisa cuando el tope corta, en vez de recortar en silencio", async () => {
    const { traer } = listadoDe(5000);
    const r = await recorrerPaginas(traer, 2000, 1000);
    expect(r.filas).toHaveLength(2000);
    expect(r.total).toBe(5000);
    expect(r.truncado).toBe(true);
  });

  it("nunca se trae más filas que el tope, aunque no sea múltiplo del bloque", async () => {
    const { traer, llamadas } = listadoDe(5000);
    const r = await recorrerPaginas(traer, 1500, 1000);
    expect(r.filas).toHaveLength(1500);
    expect(r.truncado).toBe(true);
    expect(llamadas.map((l) => l.tamano)).toEqual([1000, 500]);
  });

  it("con el listado vacío no da la vuelta ni marca truncado", async () => {
    const { traer, llamadas } = listadoDe(0);
    const r = await recorrerPaginas(traer, 10000, 1000);
    expect(r.filas).toHaveLength(0);
    expect(r.total).toBe(0);
    expect(r.truncado).toBe(false);
    expect(llamadas).toHaveLength(1);
  });

  it("para si una página viene a medias aunque el total prometa más", async () => {
    // Pasa de verdad: alguien borra o deja de ver filas entre página y página.
    let n = 0;
    const traer = async (_p: number, tamano: number) => {
      n++;
      return { filas: Array.from({ length: n === 1 ? tamano : 3 }, (_, i) => i), total: 9999 };
    };
    const r = await recorrerPaginas(traer, 10000, 1000);
    expect(r.filas).toHaveLength(1003);
    expect(r.truncado).toBe(true); // 1003 de 9999: se dice, no se esconde
  });
});
