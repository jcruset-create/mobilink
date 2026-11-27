import { describe, expect, it } from "vitest";

import {
  alertas, distancias, estadisticas, fases, fichaCliente, filtrar, franjas, minutos, municipioDe,
  partesMadrid, porCliente, porDia, porOperario, porTipoAveria, resumen, tipoDeAveria,
  type FilaEstadistica,
} from "./estadisticas.ts";

const M = 60_000;
// Lunes 23-11-2026, 10:00 en Madrid (09:00 UTC).
const L10 = Date.UTC(2026, 10, 23, 9, 0);

function fila(p: Partial<FilaEstadistica> = {}): FilaEstadistica {
  const t0 = p.createdAtMs ?? L10;
  return {
    id: 1, status: "llegada_taller",
    createdAtMs: t0, assignedAtMs: t0 + 5 * M, departedAtMs: t0 + 15 * M, arrivedAtPointMs: t0 + 45 * M,
    inicioReparacionAtMs: t0 + 50 * M, finishedAtMs: t0 + 95 * M, arrivedAtWorkshopMs: t0 + 155 * M,
    cancelledAtMs: null, customerName: "Truck Service", clientId: 1, assignedTechName: "Anthoni",
    assignedVehicleName: "Furgoneta 001", webfleetVehicleId: "001", tipo: "asistencia", origen: "taller",
    motivo: null, descripcionAveria: "Reventón rueda delantera", plate: "1234ABC", plateRemolque: null,
    esRemolque: false, address: "Calle Mayor 3, 43003 Tarragona, España", plateMismatch: false, waStatus: "delivered",
    kmRecorridos: 60, distanciaKm: 28, valoracion: 5, conFirma: true, conFotos: true,
    ...p,
  };
}

describe("estadísticas de asistencias", () => {
  it("minutos entre dos horas, sin valores absurdos", () => {
    expect(minutos(0, 10 * M)).toBeNull(); // falta la primera
    expect(minutos(1000, 1000 + 30 * M)).toBe(30);
    expect(minutos(5000, 1000)).toBeNull(); // al revés
    expect(minutos(1000, 1000 + 2 * 24 * 60 * M)).toBeNull(); // dos días
  });

  it("la hora de Madrid, no la del servidor", () => {
    expect(partesMadrid(L10)).toMatchObject({ dia: "2026-11-23", hora: 10, diaSemana: 0 });
    // 23:30 UTC del domingo ya es lunes en Madrid.
    expect(partesMadrid(Date.UTC(2026, 10, 22, 23, 30))).toMatchObject({ dia: "2026-11-23", hora: 0, diaSemana: 0 });
  });

  it("las cifras clave", () => {
    const filas = [
      fila({ id: 1 }),
      fila({ id: 2, arrivedAtPointMs: L10 + 105 * M, kmRecorridos: null, valoracion: null }),
      fila({ id: 3, status: "cancelada", cancelledAtMs: L10 + 20 * M, arrivedAtPointMs: null, finishedAtMs: null, arrivedAtWorkshopMs: null, valoracion: null }),
    ];
    const r = resumen(filas);
    expect(r).toMatchObject({
      total: 3, realizadas: 2, anuladas: 1,
      llegadaMediaMin: 70, // (40 + 100) / 2
      kmMedio: 60, kmConDato: 1, pctLlegadaObjetivo: 50, valoracionMedia: 5, encuestas: 1,
    });
    expect(r.servicioMedioMin).toBe(155);
  });

  it("las fases, de la llamada al taller", () => {
    expect(fases([fila()]).map((f) => f.min)).toEqual([5, 10, 30, 50, 60]);
  });

  it("por día, con los días vacíos incluidos", () => {
    const d = porDia([fila()], L10 - 24 * 60 * M, L10 + 24 * 60 * M);
    expect(d.map((x) => x.dia)).toEqual(["2026-11-22", "2026-11-23", "2026-11-24"]);
    expect(d[1]).toEqual({ dia: "2026-11-23", realizadas: 1, anuladas: 0 });
  });

  it("día de la semana y franja de tres horas", () => {
    const c = franjas([fila(), fila({ id: 2, createdAtMs: L10 + 4 * 60 * M })]);
    expect(c[0][3]).toEqual({ n: 1, llegadaMediaMin: 40 }); // lunes 9–12
    expect(c[0][4].n).toBe(1); // lunes 12–15 (14:00)
    expect(c[1][3].n).toBe(0);
  });

  it("tramos de distancia", () => {
    const d = distancias([fila({ distanciaKm: 5 }), fila({ distanciaKm: 28 }), fila({ distanciaKm: 140 }), fila({ distanciaKm: null })]);
    expect(d.map((x) => x.n)).toEqual([1, 0, 1, 0, 1]);
  });

  it("por cliente, de más a menos, marcando los que se llega tarde", () => {
    const c = porCliente([
      fila(), fila({ id: 2 }),
      fila({ id: 3, customerName: "Rogasa", arrivedAtPointMs: L10 + 95 * M, esRemolque: true }),
      fila({ id: 4, customerName: "  " }),
    ]);
    expect(c.map((x) => x.cliente)).toEqual(["Truck Service", "Rogasa", "Sin cliente"]);
    expect(c[0]).toMatchObject({ asistencias: 2, pct: 50, llegadaLenta: false });
    expect(c[1]).toMatchObject({ llegadaMediaMin: 90, llegadaLenta: true, remolques: 1 });
  });

  it("por operario y furgoneta", () => {
    const o = porOperario([fila(), fila({ id: 2, kmRecorridos: 40 }), fila({ id: 3, assignedTechName: null })]);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ operario: "Anthoni", furgoneta: "Furgoneta 001", asistencias: 2, salidaMediaMin: 10, kmTotal: 100, horasServicio: 4.7 });
  });

  it("el tipo de avería sale de lo que se escribió", () => {
    expect(tipoDeAveria({ motivo: null, descripcionAveria: "Reventón que ha dañado la balona" })).toBe("Llanta / balona");
    expect(tipoDeAveria({ motivo: "Pinchazo", descripcionAveria: null })).toBe("Pinchazo / reventón");
    expect(tipoDeAveria({ motivo: null, descripcionAveria: "Cambio de neumático tracción" })).toBe("Cambio de neumático");
    expect(tipoDeAveria({ motivo: null, descripcionAveria: "No arranca, batería" })).toBe("Batería / arranque");
    expect(tipoDeAveria({ motivo: null, descripcionAveria: "" })).toBe("Otros");
    expect(porTipoAveria([fila(), fila({ id: 2, descripcionAveria: "batería" })]).map((t) => t.tipo))
      .toEqual(["Pinchazo / reventón", "Batería / arranque"]);
  });

  it("los filtros", () => {
    const filas = [fila(), fila({ id: 2, customerName: "Rogasa", assignedTechName: "Marc" })];
    expect(filtrar(filas, { cliente: "rogasa" }).map((a) => a.id)).toEqual([2]);
    expect(filtrar(filas, { operario: "Anthoni" }).map((a) => a.id)).toEqual([1]);
    expect(filtrar(filas, { tipoAveria: "Pinchazo / reventón" })).toHaveLength(2);
  });

  it("control de calidad: qué asistencias hay que mirar", () => {
    const a = alertas([
      fila({ id: 1 }),
      fila({ id: 2, arrivedAtPointMs: L10 + 120 * M, conFirma: false, valoracion: 2 }),
      fila({ id: 3, status: "cancelada", cancelledAtMs: L10 + 30 * M, finishedAtMs: null, arrivedAtWorkshopMs: null, arrivedAtPointMs: null, waStatus: "undelivered" }),
      fila({ id: 4, finishedAtMs: null, arrivedAtWorkshopMs: null, conFotos: false, webfleetVehicleId: null }),
    ]);
    const por = Object.fromEntries(a.map((x) => [x.clave, x.ids]));
    expect(por.llegadaTarde).toEqual([2]);
    expect(por.sinFirma).toEqual([2]);
    expect(por.sinFotos).toEqual([]); // la 4 aún no ha terminado
    expect(por.anuladaEnCamino).toEqual([3]);
    expect(por.whatsapp).toEqual([3]);
    expect(por.sinWebfleet).toEqual([4]);
    expect(por.valoracionBaja).toEqual([2]);
  });

  it("el municipio de la dirección", () => {
    expect(municipioDe("Calle Mayor 3, 43003 Tarragona, España")).toBe("Tarragona");
    expect(municipioDe("Camí del Racó, Vandellòs i l'Hospitalet de l'Infant, Baix Camp, Tarragona, Catalunya, 43890, España"))
      .toBe("Vandellòs i l'Hospitalet de l'Infant");
    expect(municipioDe("AP-7 km 148")).toBe("AP-7 km 148");
    expect(municipioDe(null)).toBe("");
  });

  it("la ficha de cliente: meses, vehículos y lugares", () => {
    const f = fichaCliente([fila(), fila({ id: 2, plate: "9999ZZZ", createdAtMs: L10 + 60 * M }), fila({ id: 3, createdAtMs: Date.UTC(2026, 9, 5, 9) })]);
    expect(f.porMes.map((m) => [m.mes, m.asistencias])).toEqual([["2026-10", 1], ["2026-11", 2]]);
    expect(f.vehiculos[0]).toEqual({ matricula: "1234ABC", asistencias: 2 });
    expect(f.lugares[0]).toEqual({ lugar: "Tarragona", asistencias: 3 });
    expect(f.ultimas[0].id).toBe(2);
  });

  it("todo junto, con el periodo anterior para comparar", () => {
    const e = estadisticas([fila()], [fila(), fila({ id: 2 })], L10 - 60 * M, L10 + 60 * M);
    expect(e.resumen.total).toBe(1);
    expect(e.anterior.total).toBe(2);
    expect(e.franjas.celdas).toHaveLength(7);
  });
});
