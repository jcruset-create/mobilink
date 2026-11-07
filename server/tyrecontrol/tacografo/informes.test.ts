import { describe, expect, it } from "vitest";

import { decidirInforme, type Situacion } from "./informes.ts";
import type { FilaTacografo } from "./parser.ts";

/** Una fila leída del PDF, con lo justo para decidir. */
const fila = (o: Partial<FilaTacografo> = {}): FilaTacografo => ({
  fila: 1, idOrigen: "E943009005405X", fecha: "2026-11-04",
  tipoOperacion: "Calibrado o Parametrización / Control / Reparación",
  resultado: "Favorable", ordenTrabajo: null,
  matriculaOrigen: "8235JDF", matriculaNorm: "8235JDF", bastidor: null,
  marca: null, modelo: null, categoria: null, clienteNombre: null,
  medidaOrigen: null, medidaNorm: null, medidaSospechosa: false,
  medidaAnteriorOrigen: null, medidaAnteriorNorm: null,
  kmAnterior: null, kmNuevo: null,
  paramL: null, paramW: null, paramK: null, paramLAnterior: null, paramWAnterior: null,
  tipoTacografo: "Digital", fabricante: null, referencia: null, version: null,
  versionMapa: null, numSerie: null, numSensor: null, gnss: null, dsrc: null, precintos: null,
  bRodillos: null, eqCalibrado: null, manometro: null, cronometro: null,
  tecnico: null, tecnicoTarjeta: null, tecnicoTarjetaCad: null, tecnicoTarjetaVer: null,
  observaciones: null, tgdFichero: null, comprobaciones: null,
  ...o,
});

const situacion = (o: Partial<Situacion> = {}): Situacion => ({
  fila: fila(), problemas: [],
  vehiculoId: "veh-1", matriculaVehiculo: "8235JDF",
  existente: null, mismoFichero: null,
  ...o,
});

describe("decidirInforme()", () => {
  // Los dos casos que pidió el cliente, que es de lo que va todo esto.
  it("si la intervención NO está, se crea y se adjunta", () => {
    expect(decidirInforme(situacion()).accion).toBe("crear_y_adjuntar");
  });

  it("si YA está, solo se adjunta: no se toca el histórico", () => {
    const d = decidirInforme(situacion({
      existente: { id: "int-9", vehiculoId: "veh-1", fecha: "2026-11-04", creadaDePdf: false },
    }));
    expect(d.accion).toBe("solo_adjuntar");
    expect(d.intervencionId).toBe("int-9");
  });

  /*
   * El error fácil es subir el informe en la ficha de al lado, y es el caro:
   * deja una intervención colgando del autobús equivocado y le mueve el
   * vencimiento a los dos. No se decide: se pregunta.
   */
  it("una matrícula que no es la de la ficha NO se resuelve sola", () => {
    const d = decidirInforme(situacion({ matriculaVehiculo: "9204HMM" }));
    expect(d.accion).toBe("no_se_puede");
    expect(d.sePuedeConfirmar).toBe(true);
    expect(d.motivo).toContain("8235JDF");
    expect(d.motivo).toContain("9204HMM");
  });

  it("y con la confirmación de una persona, se adjunta diciéndolo", () => {
    const d = decidirInforme(situacion({ matriculaVehiculo: "9204HMM", confirmado: true }));
    expect(d.accion).toBe("crear_y_adjuntar");
    expect(d.avisos.some((a) => a.includes("confirmado"))).toBe(true);
  });

  /*
   * Si el nº de orden está vinculado a otro vehículo, quedaría un documento
   * de este apuntando a la intervención de aquél: el clip en una ficha y el
   * dato en otra.
   */
  it("una intervención de otro vehículo no se adjunta aquí", () => {
    const d = decidirInforme(situacion({
      existente: { id: "int-9", vehiculoId: "veh-OTRO", fecha: "2026-11-04", creadaDePdf: false },
    }));
    expect(d.accion).toBe("no_se_puede");
    expect(d.motivo).toContain("OTRO vehículo");
    expect(d.sePuedeConfirmar).toBeUndefined();
  });

  // Pasa de verdad: un autobús dado de alta después de importar el Excel.
  it("una intervención sin vehículo se vincula a este, si la matrícula es la suya", () => {
    const d = decidirInforme(situacion({
      existente: { id: "int-9", vehiculoId: null, fecha: "2026-11-04", creadaDePdf: false },
    }));
    expect(d.accion).toBe("solo_adjuntar");
    expect(d.vincular).toBe(true);
    expect(d.avisos.some((a) => a.includes("sin vehículo asignado"))).toBe(true);
  });

  it("el mismo fichero otra vez dice cuál es el que ya estaba", () => {
    const d = decidirInforme(situacion({ mismoFichero: { id: "doc-3", intervencionId: "int-9" } }));
    expect(d.accion).toBe("duplicado");
    expect(d.documentoId).toBe("doc-3");
    expect(d.intervencionId).toBe("int-9");
  });

  // Y manda sobre la matrícula: si el fichero ya está aquí, ya se confirmó.
  it("el duplicado se detecta antes de discutir la matrícula", () => {
    const d = decidirInforme(situacion({
      matriculaVehiculo: "9204HMM",
      mismoFichero: { id: "doc-3", intervencionId: null },
    }));
    expect(d.accion).toBe("duplicado");
  });

  describe("lo que no se puede leer", () => {
    it("sin fila, se dice el primer problema y se guardan los demás", () => {
      const d = decidirInforme(situacion({
        fila: null,
        problemas: [{ fila: 1, motivo: "No se encuentra el A1" }, { fila: 1, motivo: "y tampoco la fecha" }],
      }));
      expect(d.accion).toBe("no_se_puede");
      expect(d.motivo).toBe("No se encuentra el A1");
      expect(d.avisos).toEqual(["y tampoco la fecha"]);
    });

    it("sin fila y sin problemas, tampoco se calla", () => {
      const d = decidirInforme(situacion({ fila: null }));
      expect(d.accion).toBe("no_se_puede");
      expect(d.motivo).toBeTruthy();
    });
  });

  describe("los avisos se dan aunque la cosa salga adelante", () => {
    it("un tipo de operación que el informe no dice se avisa", () => {
      const d = decidirInforme(situacion({ fila: fila({ tipoOperacion: null }) }));
      expect(d.accion).toBe("crear_y_adjuntar");
      expect(d.avisos.some((a) => a.includes("sin tipo de operación"))).toBe(true);
    });

    it("y los problemas del lector se arrastran hasta arriba", () => {
      const d = decidirInforme(situacion({
        problemas: [{ fila: 1, motivo: "El fabricante no es ninguna de las marcas conocidas" }],
      }));
      expect(d.accion).toBe("crear_y_adjuntar");
      expect(d.avisos).toContain("El fabricante no es ninguna de las marcas conocidas");
    });
  });
});
