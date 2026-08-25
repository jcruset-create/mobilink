/**
 * Lectura del informe técnico de la extranet.
 *
 * El fixture es el texto POR BLOQUES de un InfTec real (datos del propio
 * centro), tal y como lo produce `textoDePdf`: cada etiqueta pegada a su
 * valor, aunque el orden de secciones baile. Validado primero contra el PDF
 * de verdad y fijado aquí después.
 */

import { describe, it, expect } from "vitest";
import { aDatosExpedienteInfTec, limpiarTitular, parsearInfTec } from "./infTec.ts";

const IMPRESO = `TACÓGRAFO DIGITAL
A. IDENTIFICACIÓN DEL
INFORME TÉCNICO
A1. Nº de orden de la intervención:
E943009001015B
A3. Fecha:
07-01-2021 17:04:38
B. IDENTIFICACIÓN DEL CENTRO TÉCNICO
B4. Razón social del C.T.:
COMERCIAL SEA, S.A.
B5. Contraseña asignada:
E943009
B6. Provincia donde está ubicado:
TARRAGONA
C11. Nombre y apellidos:
JORDI CRUSET
COMAJUNCOSAS
C12. Identificación completa de la
tarjeta del centro de ensayo:
EA43044379001203 (G1)
D. TIPO DE INTERVENCIÓN
REALIZADA
Transferencia de datos +
Sustitución de un tacógrafo
E22. Matrícula:
8843KWW
E23. Fecha de primera matriculación del vehículo:
09-05-2019
Bastidor:
YS2K4X20001910616
E24. Marca:
Scania
E25. Titular:
(B43009091) TERESA Y JOSE PLANA EMPRESA
PLANA S.L.
LES CREUS, 29. 43120 CONSTANTI - Tarragona
Modelo:
Sunsundegui nº1125
Categoría:
M3
I40. Nombre del fabricante:
Continental Automotive GmbH
I41. Número de pieza de la VU:
1381.4521302001
I42. Número de homologación de la VU:
e1-84
I43. Número de serie de la VU:
15944384
I44. Fecha activación unidad instalada en el vehículo:
17-05-2019
W. OBSERVACIONES
Destino de la unidad intravehicular: Se enviará a reparación`;

describe("parsearInfTec", () => {
  const r = parsearInfTec(IMPRESO);

  it("encuentra las etiquetas útiles y no cuenta los cortes", () => {
    expect(r.avisos).toEqual([]);
    expect(r.encontradas).toBe(r.total);
    // Los cortes (_e24, _modelo…) no aparecen como campos.
    expect(Object.keys(r.campos).some((k) => k.startsWith("_"))).toBe(false);
  });

  it("lee la sección I sin mezclarla con las casillas de al lado", () => {
    // En el asText plano, el nº de serie salía tres líneas más abajo, tras un
    // «NO» de otra casilla. Por bloques cada valor sigue a su etiqueta.
    expect(r.campos.tacMarca).toBe("Continental Automotive GmbH");
    expect(r.campos.tacModelo).toBe("1381.4521302001");
    expect(r.campos.tacSerie).toBe("15944384");
  });

  it("junta el nombre del técnico partido en dos líneas", () => {
    expect(r.campos.tecnico).toBe("JORDI CRUSET COMAJUNCOSAS");
  });

  it("un documento ajeno no pasa por informe técnico", () => {
    // «Modelo:» aparece en cualquier factura de taller; al ser sólo un corte,
    // no infla el recuento de reconocimiento.
    const ajeno = parsearInfTec("Factura\nModelo: Grande\nTotal: 99");
    expect(ajeno.encontradas).toBe(0);
  });
});

describe("limpiarTitular", () => {
  it("quita el CIF y corta tras la forma jurídica", () => {
    expect(
      limpiarTitular(
        "(B43009091) TERESA Y JOSE PLANA EMPRESA PLANA S.L. LES CREUS, 29. 43120 CONSTANTI - Tarragona"
      )
    ).toBe("TERESA Y JOSE PLANA EMPRESA PLANA S.L.");
  });

  it("con otras formas jurídicas también", () => {
    expect(limpiarTitular("(A1) TRANSPORTES NORD S.A.U. AV. ROMA, 1. 43001 TGN")).toBe(
      "TRANSPORTES NORD S.A.U."
    );
    expect(limpiarTitular("FRUITES DEL CAMP S.COOP POL 3. 43120 CONSTANTI")).toBe(
      "FRUITES DEL CAMP S.COOP"
    );
  });

  it("un autónomo sin forma jurídica: corta en la coma anterior al código postal", () => {
    // Se queda la calle pegada — asumido: se ve en el formulario y se recorta.
    expect(limpiarTitular("(12345678Z) JOAN PONS VIA AUGUSTA, 8. 43003 TARRAGONA")).toBe(
      "JOAN PONS VIA AUGUSTA"
    );
  });

  it("sin dirección, se queda como está", () => {
    expect(limpiarTitular("EMPRESA SIN MAS")).toBe("EMPRESA SIN MAS");
  });
});

describe("aDatosExpedienteInfTec", () => {
  const d = aDatosExpedienteInfTec(parsearInfTec(IMPRESO).campos);

  it("copia los nueve campos que trae este impreso", () => {
    expect(d.numInforme).toBe("E943009001015B");
    expect(d.empresaCliente).toBe("TERESA Y JOSE PLANA EMPRESA PLANA S.L.");
    expect(d.matricula).toBe("8843KWW");
    expect(d.bastidor).toBe("YS2K4X20001910616");
    expect(d.tacSerie).toBe("15944384");
    expect(d.fechaInforme).toBe("2021-01-07");
  });

  it("NUNCA decide el tipo de operación", () => {
    // El informe técnico no lleva la casilla 22 del anexo II: si fue posible
    // transferir sólo lo sabe aquel impreso, y aquí lo elige el técnico.
    expect(d.tipo).toBeUndefined();
  });
});
