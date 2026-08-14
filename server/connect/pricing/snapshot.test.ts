import { describe, it, expect } from "vitest";
import { aDinero, formatear } from "./money.ts";
import { aplicarOverrides, construirSnapshot, validarOverride, type Override } from "./snapshot.ts";
import type { LineaPrecio, ResultadoTarifa } from "./types.ts";

const linea = (n: number, tipo: LineaPrecio["tipo"], venta: string, compra: string): LineaPrecio => ({
  numero: n, tipo, conceptCode: tipo, descripcion: tipo,
  cantidad: 1, unidad: "servicio",
  compraUnitaria: aDinero(compra), ventaUnitaria: aDinero(venta),
  compraTotal: aDinero(compra), ventaTotal: aDinero(venta),
  saleRuleId: 12, purchaseRuleId: 12, extraId: null, metadata: {},
});

const resultado: ResultadoTarifa = {
  etapa: "locked", estado: "ok", currency: "EUR",
  compraTotal: aDinero("331"), ventaTotal: aDinero("331"),
  margen: aDinero("0"), margenPct: aDinero("0"),
  venta: {
    contractId: 1, tariffPlanId: 1, tariffPlanName: "SEAS Nacional",
    tariffVersionId: 7, version: "2026",
    regla: { id: 12, code: "NOCTURNO", name: "Nocturno", priority: 50 },
    currency: "EUR",
  },
  compra: {
    contractId: 2, tariffPlanId: 1, tariffPlanName: "SEAS Nacional",
    tariffVersionId: 7, version: "2026",
    regla: { id: 12, code: "NOCTURNO", name: "Nocturno", priority: 50 },
    currency: "EUR",
  },
  lineas: [linea(1, "FORFAIT", "331", "331")],
  avisos: [],
  explicacion: {
    tarifario: "SEAS Nacional", version: "2026", regla: "Nocturno",
    fechaLocal: "2026-08-14", horaLocal: "22:17", zonaHoraria: "Europe/Madrid",
    franja: "19:00–08:00 (L-V)", tipoDia: "Laborable", zona: "España",
    distanciaKm: 76, origenDistancia: "routed",
    distanciaIncluidaKm: 100, tiempoIncluidoMin: 180, descartes: [],
  },
  engineVersion: "1.0.0", pricingRequestId: "req-1",
};

const contexto = {
  assistanceId: 42, serviceTypeCode: "tyres", vehicleTypeCode: "truck",
  atMs: Date.parse("2026-08-14T22:17:00+02:00"), timezone: "Europe/Madrid",
  durationMin: 210,
};

describe("snapshot de la tarifa", () => {
  it("guarda el porqué, no solo el cuánto", () => {
    // La pregunta de dentro de tres años no es cuánto costó, es por qué
    const s = construirSnapshot(resultado, contexto, 1_777_000_000_000);
    expect(s.venta?.tariffPlanName).toBe("SEAS Nacional");
    expect(s.venta?.version).toBe("2026");
    expect(s.venta?.reglaNombre).toBe("Nocturno");
    expect(s.contexto.horaLocal).toBe("22:17");
    expect(s.contexto.franja).toBe("19:00–08:00 (L-V)");
    expect(s.contexto.tipoDia).toBe("Laborable");
    expect(s.venta?.distanciaIncluidaKm).toBe(100);
    expect(s.venta?.tiempoIncluidoMin).toBe(180);
  });

  it("guarda valores, no referencias: sobrevive a que se archive la versión", () => {
    const s = construirSnapshot(resultado, contexto, 1_777_000_000_000);
    // Si mañana se sube el nocturno o se borra la regla, esto sigue igual
    expect(s.lineas[0].ventaTotal).toBe("331.0000");
    expect(s.venta?.reglaCode).toBe("NOCTURNO");
  });

  it("los importes van como texto: en JSON no cabe un bigint ni conviene un float", () => {
    const s = construirSnapshot(resultado, contexto, 1);
    expect(typeof s.totales.venta).toBe("string");
    // Y sobrevive a pasar por JSON, que es como se guarda
    const ida = JSON.parse(JSON.stringify(s));
    expect(ida.totales.venta).toBe("331.0000");
    expect(ida.lineas[0].ventaTotal).toBe("331.0000");
  });

  it("un margen indeterminado se guarda como nulo, no como cero", () => {
    const sinCompra: ResultadoTarifa = {
      ...resultado, compra: null, compraTotal: null, margen: null, margenPct: null,
    };
    const s = construirSnapshot(sinCompra, contexto, 1);
    expect(s.totales.compra).toBeNull();
    expect(s.totales.margen).toBeNull();
    expect(s.compra).toBeNull();
  });

  it("el mismo cálculo produce el mismo snapshot", () => {
    // Reproducibilidad: si esto no se cumpliera, no se podría comparar el
    // snapshot de hoy con el de ayer para ver qué cambió.
    const a = construirSnapshot(resultado, contexto, 1_777_000_000_000);
    const b = construirSnapshot(resultado, contexto, 1_777_000_000_000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("lleva la versión del motor y el identificador de la petición", () => {
    const s = construirSnapshot(resultado, contexto, 1);
    expect(s.engineVersion).toBe("1.0.0");
    expect(s.pricingRequestId).toBe("req-1");
  });
});

describe("modificaciones manuales", () => {
  const valido: Override = {
    priceLineId: 1, campo: "saleTotal",
    valorAnterior: aDinero("331"), valorNuevo: aDinero("300")!,
    motivo: "Acuerdo comercial con el cliente por retraso",
    autorizadoPorUserId: 5, autorizadoPorNombre: "Jordi",
    autorizadoEnMs: 1_777_000_000_000,
  };

  it("sin motivo no hay modificación", () => {
    // Dentro de seis meses, cuando pregunten por qué costó 300 y no 331, el
    // motivo es la única respuesta posible.
    expect(validarOverride({ ...valido, motivo: "" })).toBe("El motivo es obligatorio");
    expect(validarOverride({ ...valido, motivo: "ok" })).toBe("El motivo tiene que explicar algo");
  });

  it("sin autorizador tampoco", () => {
    expect(validarOverride({ ...valido, autorizadoPorUserId: null }))
      .toBe("Falta quién lo autoriza");
  });

  it("una modificación completa se admite", () => {
    expect(validarOverride(valido)).toBeNull();
  });

  it("aplica el importe nuevo y deja constancia del anterior", () => {
    const [l] = aplicarOverrides([linea(1, "FORFAIT", "331", "331")], [valido]);
    expect(formatear(l.ventaTotal!)).toBe("300.00");
    expect((l.metadata.overrides as any[])[0]).toMatchObject({
      anterior: "331.0000", nuevo: "300.0000",
      motivo: "Acuerdo comercial con el cliente por retraso", por: "Jordi",
    });
  });

  it("no toca la línea original: el snapshot anterior sigue siendo válido", () => {
    const original = linea(1, "FORFAIT", "331", "331");
    aplicarOverrides([original], [valido]);
    expect(formatear(original.ventaTotal!)).toBe("331.00");
    expect(original.metadata.overrides).toBeUndefined();
  });

  it("una modificación de otra línea no afecta a esta", () => {
    const lineas = [linea(1, "FORFAIT", "331", "331"), linea(2, "EXTRA_KM", "31.25", "31.25")];
    const r = aplicarOverrides(lineas, [valido]);
    expect(formatear(r[0].ventaTotal!)).toBe("300.00");
    expect(formatear(r[1].ventaTotal!)).toBe("31.25");
  });

  it("se puede corregir solo la compra sin tocar la venta", () => {
    const soloCompra: Override = { ...valido, campo: "purchaseTotal", valorNuevo: aDinero("280")! };
    const [l] = aplicarOverrides([linea(1, "FORFAIT", "331", "331")], [soloCompra]);
    expect(formatear(l.compraTotal!)).toBe("280.00");
    expect(formatear(l.ventaTotal!)).toBe("331.00");
  });
});
