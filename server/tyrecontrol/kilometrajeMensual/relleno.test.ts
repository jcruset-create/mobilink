/**
 * El pendiente del relleno y cómo se lee el resultado de una unidad.
 *
 * Lo que se fija aquí es lo que se rompe solo si nadie lo mira:
 *
 *   · Que el pendiente sale de lo guardado, no de una lista: reanudar tras un
 *     reinicio tiene que dar exactamente lo que faltaba.
 *   · Que un «sin datos» cuenta como hecho. Pedido de uno en uno el servicio
 *     no llega a cerrar ese mes, así que si el pendiente mirase `closed` los
 *     autobuses parados en enero se repetirían en bucle para siempre.
 *   · Que un 401/403 para la tarea entera en vez de apuntárselo al vehículo:
 *     con la credencial rechazada, cada petición más es cupo quemado.
 *   · Que quedarse sin cupo NO le gasta un intento al vehículo. Si lo gastara,
 *     una tarde con el proveedor apretado dejaría media flota por «fallida»
 *     sin que nadie le hubiera preguntado nada.
 */

import { describe, expect, it } from "vitest";
import {
  clavePaso, desenlaceDe, enPalabras, intervaloValido, minutosRestantes, pasosPendientes,
  INTERVALO_SEGUNDOS_POR_DEFECTO,
} from "./relleno.ts";

const ENERO = { year: 2026, month: 1 };
const FEBRERO = { year: 2026, month: 2 };

const enlaces = [
  { mobilinkId: "v-b", externalCode: "u-2", matricula: "B-20" },
  { mobilinkId: "v-a", externalCode: "u-1", matricula: "B-3" },
  { mobilinkId: "v-c", externalCode: "u-3", matricula: "B-100" },
];

describe("pasosPendientes", () => {
  it("ordena por mes y luego por matrícula, con los números en orden humano", () => {
    const p = pasosPendientes({ enlaces, meses: [FEBRERO, ENERO], hechos: new Set() });
    expect(p.map((x) => `${x.year}-${x.month} ${x.etiqueta}`)).toEqual([
      "2026-1 B-3", "2026-1 B-20", "2026-1 B-100",
      "2026-2 B-3", "2026-2 B-20", "2026-2 B-100",
    ]);
  });

  it("deja fuera lo que ya tiene fila guardada", () => {
    const hechos = new Set([clavePaso({ mobilinkId: "v-a", ...ENERO })]);
    const p = pasosPendientes({ enlaces, meses: [ENERO], hechos });
    expect(p.map((x) => x.mobilinkId)).toEqual(["v-b", "v-c"]);
  });

  it("reanudar da lo mismo que faltaba: el pendiente no depende de la memoria", () => {
    const primera = pasosPendientes({ enlaces, meses: [ENERO], hechos: new Set() });
    // Se procesan dos y el proceso se cae: lo único que queda es lo guardado.
    const guardados = new Set(primera.slice(0, 2).map(clavePaso));
    const segunda = pasosPendientes({ enlaces, meses: [ENERO], hechos: guardados });
    expect(segunda).toEqual(primera.slice(2));
  });

  it("un vehículo que ha agotado los intentos deja de pedirse", () => {
    const intentos = new Map([[clavePaso({ mobilinkId: "v-a", ...ENERO }), 3]]);
    const p = pasosPendientes({ enlaces, meses: [ENERO], hechos: new Set(), intentos, maxIntentos: 3 });
    expect(p.map((x) => x.mobilinkId)).toEqual(["v-b", "v-c"]);
  });

  it("con intentos por debajo del tope se sigue reintentando", () => {
    const intentos = new Map([[clavePaso({ mobilinkId: "v-a", ...ENERO }), 2]]);
    const p = pasosPendientes({ enlaces, meses: [ENERO], hechos: new Set(), intentos, maxIntentos: 3 });
    expect(p.map((x) => x.mobilinkId)).toContain("v-a");
  });

  it("un vehículo sin matrícula guardada se ordena por su código de unidad", () => {
    const p = pasosPendientes({
      enlaces: [{ mobilinkId: "v-x", externalCode: "u-9", matricula: null }, ...enlaces],
      meses: [ENERO], hechos: new Set(),
    });
    expect(p.map((x) => x.etiqueta)).toEqual(["B-3", "B-20", "B-100", "u-9"]);
  });

  it("sin enlaces no hay nada que pedir", () => {
    expect(pasosPendientes({ enlaces: [], meses: [ENERO], hechos: new Set() })).toEqual([]);
  });
});

describe("desenlaceDe", () => {
  const cuenta = (extra: Record<string, unknown>) => ({ cuentas: [{ peticiones: 1, ...extra }] });

  it("km traídos es un hecho", () => {
    expect(desenlaceDe(cuenta({ vehiculosConKm: 1, kmTotales: 1234.5 })))
      .toEqual({ tipo: "ok", km: 1234.5 });
  });

  it("sin datos también es un hecho: no se vuelve a pedir", () => {
    expect(desenlaceDe(cuenta({ vehiculosSinDatos: 1 })).tipo).toBe("sin_datos");
  });

  it("un error del proveedor se reintenta y lleva el mensaje", () => {
    const d = desenlaceDe(cuenta({ errores: 1, muestraErrores: ["Core Error: 4"] }));
    expect(d).toEqual({ tipo: "error", mensaje: "Core Error: 4" });
  });

  it("una credencial rechazada para la tarea entera, no es culpa del vehículo", () => {
    const d = desenlaceDe(cuenta({ abandonada: "AUTH: token rechazado", errores: 1 }));
    expect(d.tipo).toBe("abandonar");
  });

  it("quedarse sin cupo no gasta intento: se espera y se vuelve", () => {
    const d = desenlaceDe(cuenta({ abandonada: "Cupo agotado…", sinCupo: true, peticiones: 0 }));
    expect(d.tipo).toBe("esperar");
  });

  it("una cuenta que ya no existe es un error, no un vehículo sin datos", () => {
    expect(desenlaceDe({ cuentas: [] }).tipo).toBe("error");
  });
});

describe("cuánto queda", () => {
  it("751 vehículos a 20 s son algo más de cuatro horas", () => {
    const m = minutosRestantes(751, 20);
    expect(m).toBe(251);
    expect(enPalabras(m)).toBe("4 h 11 min");
  });

  it("sin pendientes no queda nada", () => {
    expect(enPalabras(minutosRestantes(0, 20))).toBe("nada");
  });
});

describe("intervaloValido", () => {
  it("por defecto, veinte segundos", () => {
    expect(intervaloValido(undefined)).toBe(INTERVALO_SEGUNDOS_POR_DEFECTO);
    expect(intervaloValido("hola")).toBe(20);
  });

  it("no se deja bajar a una ráfaga", () => {
    expect(intervaloValido(1)).toBe(20);
    expect(intervaloValido(5)).toBe(5);
  });

  it("tiene tope por arriba, para que no se quede parado un día", () => {
    expect(intervaloValido(99_999)).toBe(3600);
  });
});
