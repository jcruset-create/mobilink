import { describe, expect, it } from "vitest";

import { conEstado, ESCALADO_MS, type Mensaje } from "./mensajesAsistencia.ts";

const base: Mensaje = {
  id: 1, assistanceId: 9, techName: "Iván", de: "oficina", texto: "Hola", urgente: false,
  autor: "Oficina", creadoAtMs: 1_000_000, recibidoAtMs: null, leidoAtMs: null,
};

describe("estado de un mensaje", () => {
  it("urgente sin leer: suena cada 15 s desde el principio", () => {
    expect(conEstado({ ...base, urgente: true }, base.creadoAtMs)).toMatchObject({ repetirSonido: true, escalado: false });
  });

  it("normal: suena una vez; pasados 3 min sin leer, como urgente", () => {
    expect(conEstado(base, base.creadoAtMs + ESCALADO_MS - 1).repetirSonido).toBe(false);
    expect(conEstado(base, base.creadoAtMs + ESCALADO_MS)).toMatchObject({ repetirSonido: true, escalado: true });
  });

  it("leído: ni suena ni se marca en rojo", () => {
    const leido = conEstado({ ...base, urgente: true, recibidoAtMs: 1, leidoAtMs: 2 }, base.creadoAtMs + 10 * ESCALADO_MS);
    expect(leido).toMatchObject({ estado: "leido", repetirSonido: false, escalado: false, sinLeerMin: null });
  });

  it("las respuestas del operario no tienen estado de lectura", () => {
    expect(conEstado({ ...base, de: "operario" }, base.creadoAtMs + 10 * ESCALADO_MS)).toMatchObject({ estado: "respuesta", repetirSonido: false });
  });
});
