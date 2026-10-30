/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Dobles para las pruebas del resumen de vehículo.
 *
 * Imita lo justo del cliente de Supabase: `from().select().eq()…` acumulando
 * filtros y resolviendo contra filas en memoria. Los filtros se APLICAN de
 * verdad, no se ignoran: es lo que permite probar que una consulta sin
 * `empresa_id` no devolvería lo que debe (y que las nuestras lo llevan).
 *
 * Vive en el árbol de producción y no en un `.test.ts` porque lo comparten
 * varios ficheros de prueba. No lo importa nada del servidor en marcha.
 */
export type Tablas = Record<string, Record<string, any>[]>;

export interface Espia { tabla: string; filtros: [string, any][] }

export function clienteFalso(tablas: Tablas, espias: Espia[] = []) {
  return {
    from(tabla: string) {
      const filtros: [string, any][] = [];
      const fuera: [string, string[]][] = [];
      const filas = () => {
        espias.push({ tabla, filtros: [...filtros] });
        let r = (tablas[tabla] ?? []).filter((x) => filtros.every(([c, v]) => x[c] === v));
        for (const [col, valores] of fuera) r = r.filter((x) => !valores.includes(String(x[col])));
        return r;
      };
      const b: any = {
        select: () => b,
        eq: (c: string, v: any) => { filtros.push([c, v]); return b; },
        gte: () => b,
        lte: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        lt: () => b,
        delete: () => b,
        not: (c: string, _op: string, lista: string) => {
          fuera.push([c, String(lista).replace(/[()"']/g, "").split(",").map((s) => s.trim())]);
          return b;
        },
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
        upsert: async (fila: any) => {
          (tablas[tabla] ??= []).push(fila);
          return { data: null, error: null };
        },
        insert: async (fila: any) => {
          (tablas[tabla] ??= []).push(fila);
          return { data: null, error: null };
        },
        then: (ok: any, mal: any) => Promise.resolve({ data: filas(), error: null }).then(ok, mal),
      };
      return b;
    },
  };
}
