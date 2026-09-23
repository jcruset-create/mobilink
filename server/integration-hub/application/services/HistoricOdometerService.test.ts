/**
 * El odómetro de un instante pasado.
 *
 * Lo que se fija aquí es lo que esta API obliga a defender, y cada regla sale
 * de una medición contra la cuenta real de Autocares Plana:
 *
 *   · Una ventana sin viajes no da odómetro, así que se ensancha en vez de
 *     tomar el hueco por respuesta. (15/3/2026: domingo parado, la API
 *     devolvió ceros mientras el autobús marcaba 1.245.311 km.)
 *   · Dos ventanas tienen que coincidir. (19/9/2026: una consulta de cada
 *     nueve devolvió 1.200.870,91 km, 65.000 por debajo del día anterior, con
 *     pinta de dato bueno.)
 *   · Un día sin cerrar no se toca. (20/9/2026 a las 14:27: dos valores
 *     distintos con diez minutos de diferencia.)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TripSummary } from "../../domain/telematics.ts";

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({
  resolveTelematicsConnectors: vi.fn(),
}));
vi.mock("../../infrastructure/repositories.ts", () => ({
  findExternalCode: vi.fn(),
}));

const { resolveTelematicsConnectors } = await import("../../connectors/ConnectorRegistry.ts");
const { findExternalCode } = await import("../../infrastructure/repositories.ts");
const {
  odometroEnInstante, ventanasParaInstante, diaCerrado, deAcuerdo, buscarHorizonte,
  TOLERANCIA_ACUERDO_KM, ANCHURAS_DIAS, MESES_ATRAS_MAXIMO,
} = await import("./HistoricOdometerService.ts");

const CTX = { tenantId: "empresa-plana", correlationId: "COR-1" };
/** 15/3/2026 a las 14:27 de Madrid. */
const INSTANTE = new Date("2026-03-15T13:27:00Z");
const AHORA = new Date("2026-09-20T20:00:00Z");

function resumen(final: number | undefined, distancia = 100): TripSummary {
  return {
    provider: "movertis", accountKey: "plana", providerVehicleId: "26219006",
    window: { from: INSTANTE, to: INSTANTE },
    distanceKm: distancia,
    ...(final === undefined ? {} : { finalOdometerKm: final }),
  };
}

/** Un conector que contesta lo que se le diga, una respuesta por ventana. */
function conectorQueDice(respuestas: Array<TripSummary | null>) {
  let i = 0;
  return {
    key: "movertis", accountKey: "plana", nombre: "Plana", config: {},
    connector: {
      capabilities: ["trip-summary"],
      getTripSummary: vi.fn(async () => {
        const r = respuestas[Math.min(i++, respuestas.length - 1)];
        return r ? [r] : [];
      }),
    },
  };
}

beforeEach(() => {
  vi.mocked(findExternalCode).mockResolvedValue("26219006" as any);
});

describe("ventanasParaInstante()", () => {
  it("de la más estrecha a la más ancha, todas terminando en el instante", () => {
    const v = ventanasParaInstante(INSTANTE);
    expect(v.map((x) => x.etiqueta)).toEqual(["día", "7 días", "28 días"]);
    expect(v.every((x) => x.to.getTime() === INSTANTE.getTime())).toBe(true);
  });

  it("la estrecha empieza en la medianoche LOCAL, no en la de UTC", () => {
    // 15/3/2026 00:00 de Madrid son las 23:00 UTC del 14. Cortar en UTC metería
    // la noche del 14 en el día equivocado.
    expect(ventanasParaInstante(INSTANTE)[0].from.toISOString()).toBe("2026-03-14T23:00:00.000Z");
  });

  it("ninguna ventana pasa de un mes: Movertis no admite rangos mayores", () => {
    const v = ventanasParaInstante(INSTANTE);
    const dias = (x: { from: Date; to: Date }) => (x.to.getTime() - x.from.getTime()) / 86400000;
    expect(Math.max(...v.map(dias))).toBeLessThanOrEqual(31);
    expect(ANCHURAS_DIAS[ANCHURAS_DIAS.length - 1]).toBe(28);
  });
});

describe("diaCerrado()", () => {
  it("el día en curso NO está cerrado", () => {
    expect(diaCerrado(new Date("2026-09-20T12:27:00Z"), AHORA)).toBe(false);
  });

  it("ayer sí", () => {
    expect(diaCerrado(new Date("2026-09-19T12:27:00Z"), AHORA)).toBe(true);
  });

  it("el día recién terminado espera el margen de consolidación", () => {
    // 00:30 del día siguiente: el día ha terminado, pero un viaje de madrugada
    // puede no haber entrado todavía.
    const reciénTerminado = new Date("2026-09-19T22:30:00Z");
    expect(diaCerrado(new Date("2026-09-19T12:00:00Z"), reciénTerminado)).toBe(false);
  });
});

describe("deAcuerdo()", () => {
  it("el redondeo del proveedor no rompe el acuerdo", () => {
    expect(deAcuerdo(1266263.46, 1266263.49)).toBe(true);
    expect(deAcuerdo(1266263.46, 1266264.4)).toBe(true);
  });

  it("la respuesta mentirosa medida NO pasa", () => {
    expect(deAcuerdo(1266263.46, 1200870.91)).toBe(false);
  });

  it("la tolerancia es de un kilómetro", () => {
    expect(TOLERANCIA_ACUERDO_KM).toBe(1);
    expect(deAcuerdo(1000, 1001.5)).toBe(false);
  });
});

describe("odometroEnInstante()", () => {
  it("dos ventanas que coinciden: se acepta la estrecha", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      conectorQueDice([resumen(1245311.31, 42), resumen(1245311.31, 900)]),
    ] as any);
    const r = await odometroEnInstante(CTX, "veh-1", INSTANTE, { ahora: AHORA });
    expect(r.estado).toBe("encontrado");
    if (r.estado !== "encontrado") return;
    expect(r.odometro.odometerKm).toBe(1245311.31);
    expect(r.odometro.kmEnVentana).toBe(42);
    expect(r.odometro.ventanas).toEqual(["día", "7 días"]);
  });

  it("una ventana sin viajes no cuenta: se ensancha y se usan las siguientes", async () => {
    // El domingo parado: la primera ventana viene sin odómetro.
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      conectorQueDice([resumen(undefined, 0), resumen(1245311.31), resumen(1245311.31)]),
    ] as any);
    const r = await odometroEnInstante(CTX, "veh-1", INSTANTE, { ahora: AHORA });
    expect(r.estado).toBe("encontrado");
    if (r.estado !== "encontrado") return;
    expect(r.odometro.ventanas).toEqual(["7 días", "28 días"]);
  });

  it("dos ventanas que NO coinciden: no se escribe nada y se dice por qué", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      conectorQueDice([resumen(1266263.46), resumen(1200870.91)]),
    ] as any);
    const r = await odometroEnInstante(CTX, "veh-1", INSTANTE, { ahora: AHORA });
    expect(r.estado).toBe("discrepancia");
    if (r.estado !== "discrepancia") return;
    expect(r.motivo).toContain("1200870.91");
  });

  it("si ninguna ventana trae odómetro, es «sin lectura», no un cero", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      conectorQueDice([resumen(undefined, 0)]),
    ] as any);
    const r = await odometroEnInstante(CTX, "veh-1", INSTANTE, { ahora: AHORA });
    expect(r.estado).toBe("sin_lectura");
  });

  it("un día sin cerrar no se pregunta siquiera: ni una petición", async () => {
    const cuenta = conectorQueDice([resumen(1266407.66)]);
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([cuenta] as any);
    const r = await odometroEnInstante(CTX, "veh-1", new Date("2026-09-20T12:27:00Z"), { ahora: AHORA });
    expect(r.estado).toBe("dia_abierto");
    expect(cuenta.connector.getTripSummary).not.toHaveBeenCalled();
  });

  it("sin cuentas de telemática se dice eso, no «sin lectura»", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([] as any);
    expect((await odometroEnInstante(CTX, "veh-1", INSTANTE, { ahora: AHORA })).estado).toBe("sin_telematica");
  });

  it("un vehículo sin enlace no es un fallo de la cuenta", async () => {
    vi.mocked(findExternalCode).mockResolvedValue(null as any);
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([conectorQueDice([resumen(1)])] as any);
    expect((await odometroEnInstante(CTX, "veh-1", INSTANTE, { ahora: AHORA })).estado).toBe("sin_telematica");
  });

  it("si el proveedor revienta, es «no disponible»: merece reintento", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([{
      key: "movertis", accountKey: "plana", nombre: "Plana", config: {},
      connector: {
        capabilities: ["trip-summary"],
        getTripSummary: vi.fn(async () => { throw new Error("Core Error: 4"); }),
      },
    }] as any);
    const r = await odometroEnInstante(CTX, "veh-1", INSTANTE, { ahora: AHORA });
    expect(r.estado).toBe("no_disponible");
    if (r.estado !== "no_disponible") return;
    expect(r.motivo).toContain("Core Error: 4");
  });
});


/**
 * El suelo del relleno de revisiones.
 *
 * En Autocares Plana la revisión más antigua es de 2021 y Movertis no tiene
 * nada anterior a AGOSTO DE 2025: julio devuelve ceros y cero viajes; agosto,
 * 1.467 km y 66 viajes. Sin este suelo la tarea se pasaba horas preguntando
 * por años que el proveedor no puede contestar, y encima de la forma más cara:
 * una revisión irrellenable ensancha la ventana tres veces antes de rendirse.
 */
describe("buscarHorizonte()", () => {
  /** Un proveedor que tiene datos desde hace `desde` meses hacia acá. */
  const proveedorCon = (desde: number) => {
    const vistos: number[] = [];
    const fn = async (mesesAtras: number) => {
      vistos.push(mesesAtras);
      return mesesAtras <= desde;
    };
    return { fn, vistos };
  };

  it("encuentra el mes más antiguo con datos", async () => {
    for (const horizonte of [1, 2, 5, 13, 24, 35]) {
      const { fn } = proveedorCon(horizonte);
      expect(await buscarHorizonte(fn)).toBe(horizonte);
    }
  });

  it("el caso real: trece meses de histórico", async () => {
    const { fn } = proveedorCon(13);
    expect(await buscarHorizonte(fn)).toBe(13);
  });

  it("sin datos ni el mes pasado, no hay horizonte que acotar", async () => {
    expect(await buscarHorizonte(async () => false)).toBeNull();
  });

  it("un proveedor con TODO el histórico devuelve el tope", async () => {
    expect(await buscarHorizonte(async () => true)).toBe(MESES_ATRAS_MAXIMO);
  });

  it("es binaria: seis rondas, no treinta y seis", async () => {
    const { fn, vistos } = proveedorCon(13);
    await buscarHorizonte(fn);
    // 36 meses a ciegas serían 36 rondas. Cada ronda cuesta peticiones reales.
    expect(vistos.length).toBeLessThanOrEqual(8);
  });

  it("nunca pregunta más allá del tope", async () => {
    const { fn, vistos } = proveedorCon(13);
    await buscarHorizonte(fn, 12);
    expect(Math.max(...vistos)).toBeLessThanOrEqual(12);
  });
});
