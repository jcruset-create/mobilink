import { describe, expect, it } from "vitest";

import {
  aMensajeTaller,
  conEstado,
  ESCALADO_MS,
  umbralEscalado,
  type MensajeTaller,
} from "./liteMensajes.ts";

const base: MensajeTaller = {
  id: 1,
  body: "El camión está en el km 238, no en el 236",
  byName: "Marta Soler",
  createdAtMs: 1_000_000,
  readAtMs: null,
  urgent: false,
};

describe("urgencia y escalado de un mensaje al taller", () => {
  it("urgente sin leer: suena desde el primer momento", () => {
    expect(conEstado({ ...base, urgent: true }, base.createdAtMs)).toMatchObject({
      repetirSonido: true,
      escalado: false,
    });
  });

  it("normal recién llegado: suena una vez y no repite", () => {
    expect(conEstado(base, base.createdAtMs)).toMatchObject({
      repetirSonido: false,
      escalado: false,
    });
  });

  it("normal sin leer: un milisegundo antes de los 3 minutos todavía no escala", () => {
    const m = conEstado(base, base.createdAtMs + ESCALADO_MS - 1);
    expect(m.escalado).toBe(false);
    expect(m.repetirSonido).toBe(false);
  });

  it("normal sin leer: a los 3 minutos justos pasa a tratarse como urgente", () => {
    expect(conEstado(base, base.createdAtMs + ESCALADO_MS)).toMatchObject({
      escalado: true,
      repetirSonido: true,
      sinLeerMin: 3,
    });
  });

  it("leído: deja de sonar aunque sea urgente y hayan pasado horas", () => {
    const m = conEstado(
      { ...base, urgent: true, readAtMs: base.createdAtMs + 5_000 },
      base.createdAtMs + 20 * ESCALADO_MS,
    );
    expect(m).toMatchObject({ repetirSonido: false, escalado: false, sinLeerMin: null });
  });

  it("un urgente leído no se cuenta como escalado", () => {
    // El escalado es «nadie lo ha visto»; con acuse de lectura ya no aplica,
    // y si no se distinguiera, Central vería en rojo algo ya atendido.
    const m = conEstado({ ...base, readAtMs: base.createdAtMs + 1 }, base.createdAtMs + 10 * ESCALADO_MS);
    expect(m.escalado).toBe(false);
  });

  it("los minutos sin leer se cuentan hacia abajo y nunca salen negativos", () => {
    expect(conEstado(base, base.createdAtMs + 59_000).sinLeerMin).toBe(0);
    expect(conEstado(base, base.createdAtMs + 61_000).sinLeerMin).toBe(1);
    // Reloj del servidor por detrás de la fila (hora corregida, réplica):
    // antes salía -1 minuto sin leer, que no significa nada.
    expect(conEstado(base, base.createdAtMs - 10_000).sinLeerMin).toBe(0);
  });

  it("el umbral de escalado es el momento a partir del cual un normal ya repite", () => {
    const ahora = base.createdAtMs + ESCALADO_MS;
    // Lo que hace la consulta: creadoAtMs <= umbral significa escalado.
    expect(base.createdAtMs <= umbralEscalado(ahora)).toBe(true);
    expect(base.createdAtMs <= umbralEscalado(ahora - 1)).toBe(false);
  });
});

describe("normalización de la fila", () => {
  it("convierte los BIGINT que Postgres devuelve como cadena", () => {
    // Sin esto, `ahora - createdAtMs` resta un número de un texto: el
    // escalado no saltaba nunca y nadie se enteraba.
    const m = aMensajeTaller({
      id: "7",
      body: "Llama a la central",
      byName: null,
      createdAtMs: "1700000000000",
      readAtMs: "1700000005000",
      urgent: true,
    });
    expect(m).toEqual({
      id: 7,
      body: "Llama a la central",
      byName: null,
      createdAtMs: 1_700_000_000_000,
      readAtMs: 1_700_000_005_000,
      urgent: true,
    });
    expect(conEstado(m, 1_700_000_000_000 + ESCALADO_MS).escalado).toBe(false);
  });

  it("sin leer y sin autor no revienta", () => {
    const m = aMensajeTaller({ id: 1, body: null, createdAtMs: 1, readAtMs: null });
    expect(m).toMatchObject({ body: "", byName: null, readAtMs: null, urgent: false });
  });

  it("urgent solo es verdad si lo es de verdad", () => {
    // La columna llega como booleano de Postgres; cualquier otra cosa
    // (null de una fila antigua, 'f', 0) es un mensaje normal.
    for (const v of [null, undefined, 0, "", "f", "false"]) {
      expect(aMensajeTaller({ id: 1, body: "x", createdAtMs: 1, urgent: v }).urgent).toBe(false);
    }
    expect(aMensajeTaller({ id: 1, body: "x", createdAtMs: 1, urgent: true }).urgent).toBe(true);
  });
});
