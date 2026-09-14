import { describe, expect, it } from "vitest";
import {
  ESTADOS_EXPEDIENTE,
  actuacionCerrada,
  esEstadoExpediente,
  esTipoAccion,
  estaAbierto,
  exigeMotivo,
  expedienteEnProceso,
  expedienteResoluble,
  puedeTransicionar,
  puedeTransicionarActuacion,
  transicionesDeActuacionDesde,
  transicionesDesde,
  type EstadoActuacion,
  type EstadoExpediente,
} from "./estados.ts";

describe("vocabulario", () => {
  it("«RECLAMADO» no es un estado: es un contador", () => {
    expect(esEstadoExpediente("RECLAMADO")).toBe(false);
    expect(esEstadoExpediente("PENDIENTE")).toBe(true);
  });

  it("«GRABAR» y «MODIFICAR» son acciones, no estados ni tipos de expediente", () => {
    expect(esTipoAccion("GRABAR")).toBe(true);
    expect(esTipoAccion("MODIFICAR")).toBe(true);
    expect(esEstadoExpediente("GRABAR")).toBe(false);
  });

  it("aprobar es una acción: un expediente de aprobación tiene algo que resolver", () => {
    expect(esTipoAccion("APROBAR")).toBe(true);
  });

  it("los cuatro estados abiertos son los que siguen siendo trabajo de alguien", () => {
    const abiertos = ESTADOS_EXPEDIENTE.filter(estaAbierto);
    expect(abiertos).toEqual(["NUEVO", "PENDIENTE", "EN_PROCESO", "BLOQUEADO"]);
  });
});

describe("transiciones del expediente", () => {
  it("un expediente nuevo puede ir a cualquier sitio", () => {
    expect(puedeTransicionar("NUEVO", "PENDIENTE")).toBe(true);
    expect(puedeTransicionar("NUEVO", "RESUELTO")).toBe(true);
  });

  it("reabrir un resuelto lo deja PENDIENTE, no EN_PROCESO", () => {
    expect(puedeTransicionar("RESUELTO", "PENDIENTE")).toBe(true);
    expect(puedeTransicionar("RESUELTO", "EN_PROCESO")).toBe(false);
  });

  it("un cerrado se puede reabrir: el cierre por antigüedad no lo decidió nadie", () => {
    expect(puedeTransicionar("CERRADO", "PENDIENTE")).toBe(true);
  });

  it("un cerrado no salta directamente a resuelto ni a bloqueado", () => {
    expect(puedeTransicionar("CERRADO", "RESUELTO")).toBe(false);
    expect(puedeTransicionar("CERRADO", "BLOQUEADO")).toBe(false);
  });

  it("ningún estado transiciona a sí mismo", () => {
    for (const e of ESTADOS_EXPEDIENTE) {
      expect(puedeTransicionar(e, e)).toBe(false);
    }
  });

  it("bloquear y reabrir exigen motivo; resolver no", () => {
    expect(exigeMotivo("PENDIENTE", "BLOQUEADO")).toBe(true);
    expect(exigeMotivo("RESUELTO", "PENDIENTE")).toBe(true);
    expect(exigeMotivo("CERRADO", "PENDIENTE")).toBe(true);
    expect(exigeMotivo("EN_PROCESO", "RESUELTO")).toBe(false);
  });
});

describe("transiciones de la actuación", () => {
  it("una descartada no vuelve: se pide otra vez y se crea otra", () => {
    expect(transicionesDeActuacionDesde("DESCARTADA")).toEqual([]);
    expect(puedeTransicionarActuacion("DESCARTADA", "PENDIENTE")).toBe(false);
  });

  it("una resuelta se puede reabrir al reabrir el expediente", () => {
    expect(puedeTransicionarActuacion("RESUELTA", "PENDIENTE")).toBe(true);
  });

  it("resuelta y descartada son las dos que ya no esperan trabajo", () => {
    const cerradas = (["PENDIENTE", "EN_PROCESO", "BLOQUEADA", "RESUELTA", "DESCARTADA"] as const)
      .filter((e: EstadoActuacion) => actuacionCerrada(e));
    expect(cerradas).toEqual(["RESUELTA", "DESCARTADA"]);
  });
});

describe("el expediente a partir de sus actuaciones", () => {
  const act = (estado: EstadoActuacion, obligatoria = true) => ({ estado, obligatoria });

  it("se puede resolver cuando todas las obligatorias están cerradas", () => {
    expect(expedienteResoluble([act("RESUELTA"), act("DESCARTADA")])).toBe(true);
  });

  it("no se resuelve si queda una obligatoria por hacer", () => {
    expect(expedienteResoluble([act("RESUELTA"), act("PENDIENTE")])).toBe(false);
  });

  it("una actuación no obligatoria pendiente no lo impide", () => {
    expect(expedienteResoluble([act("RESUELTA"), act("PENDIENTE", false)])).toBe(true);
  });

  /*
   * El caso que importa: sin actuaciones NO se resuelve solo. Si se resolviera,
   * un expediente recién creado saldría de la bandeja en el mismo instante en
   * que entra, que es la peor forma posible de tener la bandeja vacía.
   */
  it("un expediente sin actuaciones no se resuelve solo", () => {
    expect(expedienteResoluble([])).toBe(false);
  });

  it("está en proceso en cuanto alguien empieza una", () => {
    expect(expedienteEnProceso([act("PENDIENTE"), act("EN_PROCESO")])).toBe(true);
    expect(expedienteEnProceso([act("PENDIENTE"), act("RESUELTA")])).toBe(false);
  });
});

describe("cobertura del mapa de transiciones", () => {
  /*
   * Un estado nuevo en el vocabulario sin su fila en el mapa saldría como un
   * estado del que no se puede salir, y eso no se nota hasta que alguien tiene
   * un expediente atascado. Aquí se cae en cuanto se añade.
   */
  it("desde todo estado abierto se puede llegar a alguna parte", () => {
    for (const e of ESTADOS_EXPEDIENTE) {
      expect(transicionesDesde(e).length, `${e} no lleva a ningún sitio`).toBeGreaterThan(0);
    }
  });

  it("a todo estado se puede llegar desde alguna parte, salvo el inicial", () => {
    const alcanzables = new Set<EstadoExpediente>();
    for (const e of ESTADOS_EXPEDIENTE) {
      for (const destino of transicionesDesde(e)) alcanzables.add(destino);
    }
    for (const e of ESTADOS_EXPEDIENTE) {
      if (e === "NUEVO") continue; // es donde nacen; nadie vuelve a él
      expect(alcanzables.has(e), `a ${e} no se llega desde ningún estado`).toBe(true);
    }
    expect(alcanzables.has("NUEVO")).toBe(false);
  });
});
