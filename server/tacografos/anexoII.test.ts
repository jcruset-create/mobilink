/**
 * Lectura del anexo II de la extranet de VDO.
 *
 * El fixture reproduce lo que sale del PDF del impreso real.
 *
 * Que el analizador aguante el reparto a dos columnas NO se prueba aquí
 * inventando cómo las devuelve mupdf: se prueba en `importar.test.ts`,
 * generando un PDF a dos columnas de verdad y pasando la tubería entera.
 */

import { describe, it, expect } from "vitest";
import { aDatosExpediente, fechaAIso, parsearAnexoII, siNo } from "./anexoII.ts";

/** Informe real de un caso de intransferibilidad, con los datos cambiados. */
const IMPRESO = `Informe sobre transferencia de datos/certificado de intransferibilidad
NÚMERO DE INFORME / CERTIFICADO: E943009001015B
Fecha: 07-01-2021 17:04:38
DATOS DEL VEHÍCULO Y DE LA EMPRESA
1. Número de matrícula del vehículo:
8843KWW
2. Número de bastidor del vehículo:
YS2K4X20001910616
3. Fabricante del vehículo:
Scania
4. Modelo del vehículo:
Sunsundegui nº1125
5. Nombre de la empresa de transportes:
TERESA Y JOSE PLANA EMPRESA PLANA S.L.
6. Dirección de la empresa de transportes:
LES CREUS, 29
7. Detalles de la tarjeta de empresa:
DATOS DEL CENTRO TÉCNICO
8. Nombre del Centro Técnico:
COMERCIAL SEA, S.A.
9. Dirección del Centro Técnico:
C/ Coure, 27
10. Contraseña del Centro Técnico:
E943009
11. Detalles de la tarjeta del Centro Técnico:
EA43044379001203 (G1)
12. Nombre del técnico que interviene
JORDI CRUSET COMAJUNCOSAS
DATOS DE LA UNIDAD INSTALADA EN EL VEHÍCULO
13. Nombre del fabricante del tacógrafo:
Aumovio Germany GmbH
14. Modelo de la unidad:
1381.4521302001
15. Número de serie de la unidad:
15944384
16. Fecha de fabricación de la unidad:
2021
17. Situación de la unidad en la cabina:
SÍ
18. Marca de homologación de la unidad:
e1-84
19. Visibilidad de la placa (Req. 169/170):
SÍ
DETALLES DE LA TRANSFERENCIA
20. ¿Se ven los datos en pantalla? SÍ
21. ¿Era posible imprimir los datos? SÍ
22. ¿Era posible transferir los datos? NO
23. ¿Se pudieron descargar todos los datos? NO
24. En caso negativo de 23, ¿por qué?
ERROR LECTURA TARJETAS SE ENVIA EN GARANTIA
25. Fecha de transferencia de los datos desde la unidad intravehicular:
26. ¿Han sido los datos enviados a la empresa? NO
27. Fecha de envío:
DECLARACIÓN
1. Este documento ha sido emitido de conformidad con los procedimientos establecidos en la
Disposición adicional primera del RD 125/2017.`;

describe("parsearAnexoII", () => {
  const { campos, avisos, encontradas, total } = parsearAnexoII(IMPRESO);

  it("encuentra todas las etiquetas del impreso", () => {
    expect(avisos).toEqual([]);
    expect(encontradas).toBe(total);
  });

  it("lee los datos del vehículo y de la empresa", () => {
    expect(campos.matricula).toBe("8843KWW");
    expect(campos.bastidor).toBe("YS2K4X20001910616");
    expect(campos.empresaCliente).toBe("TERESA Y JOSE PLANA EMPRESA PLANA S.L.");
  });

  it("lee los datos de la unidad intravehicular", () => {
    expect(campos.tacMarca).toBe("Aumovio Germany GmbH");
    expect(campos.tacModelo).toBe("1381.4521302001");
    expect(campos.tacSerie).toBe("15944384");
  });

  it("lee el número de informe, la fecha y el técnico", () => {
    expect(campos.numInforme).toBe("E943009001015B");
    expect(campos.fechaCabecera).toBe("07-01-2021 17:04:38");
    expect(campos.tecnico).toBe("JORDI CRUSET COMAJUNCOSAS");
  });

  it("lee las casillas de la transferencia, que van en la misma línea", () => {
    expect(campos.verPantalla).toBe("SÍ");
    expect(campos.transferir).toBe("NO");
    expect(campos.descargaCompleta).toBe("NO");
    expect(campos.motivoNo).toBe("ERROR LECTURA TARJETAS SE ENVIA EN GARANTIA");
  });

  it("un campo vacío en el impreso se lee como vacío, no como el de al lado", () => {
    // 25 y 27 están en blanco porque no hubo transferencia. Si el recorte se
    // pasara de largo, la fecha de envío se llevaría el texto de la DECLARACIÓN.
    expect(campos.fechaTransferencia).toBe("");
    expect(campos.fechaEnvio).toBe("");
    expect(campos.tarjetaEmpresa).toBe("");
  });

  it("no arrastra la numeración de la etiqueta siguiente", () => {
    for (const v of Object.values(campos)) {
      expect(v).not.toMatch(/\s\d{1,2}\.$/);
    }
  });

  it("el espaciado del PDF no descoloca el recorte", () => {
    /*
     * Regresión. La primera versión recortaba el valor con los índices del
     * texto NORMALIZADO, dando por hecho que normalizar no cambia la longitud.
     * Es falso en cuanto hay una línea en blanco o varios espacios seguidos: el
     * recorte salía corrido y la matrícula se leía como «o: 8843KWW».
     *
     * Sólo apareció al ejecutar la suite entera, donde el texto llegaba con
     * otro espaciado; aislado pasaba. De ahí que valga la pena fijarlo.
     */
    const conRuido = IMPRESO.replace(/\n/g, "\n\n").replace(/: /g, ":   ");
    const { campos } = parsearAnexoII(conRuido);
    expect(campos.matricula).toBe("8843KWW");
    expect(campos.tacSerie).toBe("15944384");
    expect(campos.numInforme).toBe("E943009001015B");
    expect(campos.empresaCliente).toBe("TERESA Y JOSE PLANA EMPRESA PLANA S.L.");
  });

  it("los acentos del valor se conservan aunque el cotejo los ignore", () => {
    // El cotejo va sin tildes porque el OCR se deja alguna; el valor no.
    const r = parsearAnexoII(
      IMPRESO.replace("TERESA Y JOSE PLANA", "TERESA Y JOSÉ PLANÁ")
    );
    expect(r.campos.empresaCliente).toBe("TERESA Y JOSÉ PLANÁ EMPRESA PLANA S.L.");
  });

  it("una etiqueta sin tilde en el documento se encuentra igual", () => {
    // Pasa con el OCR de una foto: «Número» sale como «Numero».
    const sinTildes = IMPRESO.replace("Número de serie de la unidad:", "Numero de serie de la unidad:");
    expect(parsearAnexoII(sinTildes).campos.tacSerie).toBe("15944384");
  });

  it("un documento que no es el anexo II no inventa nada", () => {
    const r = parsearAnexoII("Factura simplificada\nTotal: 42,00 €");
    expect(r.encontradas).toBe(0);
    expect(r.avisos.length).toBe(r.total);
    expect(Object.values(r.campos).every((v) => v === "")).toBe(true);
  });
});

describe("fechaAIso", () => {
  it("convierte el formato del impreso, con hora y sin ella", () => {
    expect(fechaAIso("07-01-2021 17:04:38")).toBe("2021-01-07");
    expect(fechaAIso("7/1/2021")).toBe("2021-01-07");
  });
  it("acepta el ISO por si el impreso cambia", () => {
    expect(fechaAIso("2021-01-07")).toBe("2021-01-07");
  });
  it("lo que no es una fecha se descarta, no se adivina", () => {
    expect(fechaAIso("")).toBeNull();
    expect(fechaAIso("2021")).toBeNull();
  });
});

describe("siNo", () => {
  it("entiende SÍ y NO con y sin acento", () => {
    expect(siNo("SÍ")).toBe(true);
    expect(siNo("Si")).toBe(true);
    expect(siNo("NO")).toBe(false);
  });
  it("y no se moja si dice otra cosa", () => {
    expect(siNo("")).toBeNull();
    expect(siNo("PARCIAL")).toBeNull();
  });
});

describe("aDatosExpediente", () => {
  const { campos } = parsearAnexoII(IMPRESO);
  const d = aDatosExpediente(campos);

  it("la casilla 22 decide el tipo de operación", () => {
    // «¿Era posible transferir los datos? NO» es lo que convierte este impreso
    // en un certificado de intransferibilidad.
    expect(d.tipo).toBe("intransferibilidad");
    expect(aDatosExpediente({ ...campos, transferir: "SÍ" }).tipo).toBe("transferencia");
  });

  it("sin casilla 22 no se elige tipo: lo decide el técnico", () => {
    expect(aDatosExpediente({ ...campos, transferir: "" }).tipo).toBeUndefined();
  });

  it("copia los doce campos del expediente y pone la matrícula en mayúsculas", () => {
    expect(d.matricula).toBe("8843KWW");
    expect(d.numInforme).toBe("E943009001015B");
    expect(d.fechaInforme).toBe("2021-01-07");
    expect(d.tacSerie).toBe("15944384");
    expect(d.tecnico).toBe("JORDI CRUSET COMAJUNCOSAS");
    expect(d.fechaTransferencia).toBeNull();
  });
});
