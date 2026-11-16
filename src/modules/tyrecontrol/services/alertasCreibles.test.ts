import { describe, expect, it } from "vitest";
import { aplicarJuicio, esParaCambiar, seriesDelVehiculo, type HistorialParaJuicio } from "./alertasCreibles";
import { agruparPorVehiculo } from "./alertasPorVehiculo";
import type { RuedaAlerta } from "../types/informes";
import { mapaUltimasMediciones } from "./ultimaMedicion";

/**
 * El 2651JRM tal como estaba en producción el 16/11/2026: la delantera
 * izquierda (nueva, 12 mm) leída a 1,6 y 2,2 dos días seguidos, y la trasera
 * izquierda exterior gastándose de verdad hasta su mínimo.
 */
type Fila = [fecha: string, km: number | null, del: number, tras: number];
const PASADAS: Fila[] = [
  ["2026-11-16", null, 2.2, 3.8], ["2026-11-14", 776502, 1.6, 4.9], ["2026-11-10", 775838, 11.9, 3.9],
  ["2026-11-09", 775587, 12.2, 4.2], ["2026-11-04", 774688, 12.4, 4.1], ["2026-10-30", 773827, 12.4, 4.6],
  ["2026-10-29", 773661, 12.2, 4.7], ["2026-09-26", 767958, 12.8, 5.8], ["2026-09-25", 767578, 12.6, 5.3],
  ["2026-09-07", 767431, 12.9, 5.6], ["2026-09-04", 767299, 13.1, 5.7], ["2026-09-02", 766817, 13.1, 5.9],
  ["2026-08-30", 766083, 13.4, 6.6], ["2026-08-26", 765144, 13.9, 7.1], ["2026-08-21", 764567, 14.0, 7.2],
  ["2026-08-13", 764143, 14.2, 7.5], ["2026-08-12", 763662, 14.1, 7.8],
];
const HISTORIAL: HistorialParaJuicio = {
  revisiones: PASADAS.map(([fecha, km], i) => ({ id: `r${i}`, vehiculo_id: "v1", fecha_revision: fecha, km_vehiculo: km, tecnico_id: null })),
  detalles: PASADAS.flatMap(([, , del, tras], i) => [
    { revision_id: `r${i}`, posicion_id: "p-del", profundidad_mm: del },
    { revision_id: `r${i}`, posicion_id: "p-tras", profundidad_mm: tras },
  ]),
  montajes: [
    { vehiculo_id: "v1", posicion_id: "p-del", fecha_montaje: "2026-08-11" },
    { vehiculo_id: "v1", posicion_id: "p-tras", fecha_montaje: "2026-08-10" },
  ],
};
const rueda = (posicion: string, codigo: string, mm: number, extra: Partial<RuedaAlerta> = {}): RuedaAlerta => ({
  vehiculo_id: "v1", matricula: "2651JRM", numero_unidad: "1654", tipo_vehiculo: "autobus", config_ejes: "2x4",
  imagen_chasis_url: null, posicion_id: posicion, codigo_posicion: codigo, eje: 1, lado: "izq", interior_exterior: null,
  neumatico_id: `n-${posicion}`, codigo: null, medida: "295/80R22.5", profundidad_mm: mm, minimo_mm: 4,
  fecha_revision: "2026-11-16", presion_bar: null, presion_recomendada_bar: null, desviacion_pct: null,
  presion_avisos: null, presion_aviso_at: null, confirmada: true, pendiente_mm: null, pendiente_fecha: null, ...extra,
});
const ALERTAS = [rueda("p-del", "E1_IZQ", 2.2), rueda("p-tras", "E2_IZQ_EXT", 3.9)];

describe("aplicarJuicio", () => {
  const [del, tras] = aplicarJuicio(ALERTAS, HISTORIAL);

  it("la que no cabe en los kilómetros vuelve a su profundidad de antes", () => {
    expect(del).toMatchObject({ profundidad_mm: 12.4, fecha_revision: "2026-11-04", confirmada: true });
  });

  it("y la lectura baja no se calla: queda pendiente, con la cuenta", () => {
    expect(del).toMatchObject({ pendiente_mm: 2.2, pendiente_fecha: "2026-11-16" });
    expect(del.no_creible).toContain("medir con sonda");
  });

  it("la que se gasta de verdad sigue para cambiar, sin tocar", () => {
    expect(tras).toBe(ALERTAS[1]);
  });

  it("en la tarjeta: una rueda para cambiar y otra por confirmar, y la peor es la de verdad", () => {
    const [v] = agruparPorVehiculo([del, tras], "2026-11-16");
    expect(v).toMatchObject({ paraCambiar: 1, porConfirmar: 1, peor: 3.9 });
    const e1 = v.ruedas.find((r) => r.codigo === "E1_IZQ")!;
    expect(e1.estado).toBe("por_confirmar");
    expect(e1.titulo).toContain("última lectura 2,2 mm");
    expect(e1.titulo).toContain("No es desgaste");
  });

  it("sin historial, las filas salen como vinieron", () => {
    expect(aplicarJuicio(ALERTAS, { revisiones: [], detalles: [], montajes: [] })).toEqual(ALERTAS);
  });

  it("solo se juzga lo que sale para cambiar", () => {
    const buena = rueda("p-del", "E1_IZQ", 12.4);
    const conPresion = rueda("p-del", "E1_IZQ", 2.2, { presion_aviso_at: "2026-11-16" });
    const pendiente = rueda("p-del", "E1_IZQ", 2.2, { confirmada: false });
    expect([buena, conPresion, pendiente].map(esParaCambiar)).toEqual([false, false, false]);
    expect(aplicarJuicio([buena, conPresion, pendiente], HISTORIAL)).toEqual([buena, conPresion, pendiente]);
  });
});

describe("seriesDelVehiculo", () => {
  it("no hereda lecturas anteriores al montaje ni de revisiones incompletas", () => {
    const h: HistorialParaJuicio = {
      ...HISTORIAL,
      revisiones: [
        ...HISTORIAL.revisiones,
        { id: "vieja", vehiculo_id: "v1", fecha_revision: "2026-08-01", km_vehiculo: 763000, tecnico_id: null },
        { id: "parcial", vehiculo_id: "v1", fecha_revision: "2026-11-13", km_vehiculo: 776307, tecnico_id: null },
      ],
      detalles: [
        ...HISTORIAL.detalles,
        { revision_id: "vieja", posicion_id: "p-del", profundidad_mm: 3 },
        { revision_id: "vieja", posicion_id: "p-tras", profundidad_mm: 3 },
        { revision_id: "parcial", posicion_id: "p-del", profundidad_mm: 12.2 },
        { revision_id: "parcial", posicion_id: "p-tras", profundidad_mm: null },
      ],
    };
    const s = seriesDelVehiculo("v1", h).get("p-del")!;
    expect(s).toHaveLength(PASADAS.length);
    expect(s[0]).toMatchObject({ mm: 2.2, fecha: "2026-11-16" });
    expect(s[0].km).toBeGreaterThan(776502); // sin km: estimado por la fecha
  });
});

describe("La ficha del vehículo aplica el mismo juicio", () => {
  const revs = HISTORIAL.revisiones.map((r) => ({ ...r, created_at: `${r.fecha_revision}T20:00:00Z` }));
  const dets = HISTORIAL.detalles.map((d) => ({ ...d, neumatico_id: null, presion_bar: 8 }));
  const montajes = new Map([
    ["p-del", { neumatico_id: "n-del", fecha_montaje: "2026-08-11" }],
    ["p-tras", { neumatico_id: "n-tras", fecha_montaje: "2026-08-10" }],
  ]);
  const mapa = mapaUltimasMediciones(revs, dets, montajes, () => 4);

  it("la delantera enseña sus 12,4 mm y deja el 2,2 por confirmar", () => {
    expect(mapa["n-del"]).toMatchObject({ profundidad_mm: 12.4, pendiente_mm: 2.2, confirmada: true });
    expect(mapa["n-del"].no_creible).toContain("medir con sonda");
  });

  it("la trasera, gastada de verdad, se queda en su mínimo", () => {
    expect(mapa["n-tras"]).toMatchObject({ profundidad_mm: 3.9, pendiente_mm: null, no_creible: null });
  });
});
