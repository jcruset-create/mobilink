import { describe, it, expect } from "vitest";
import {
  CLAVE_MATERIAL,
  claveArticulo,
  entradaEnMs,
  minutosDePlantilla,
  normalizaMatricula,
  normalizaTexto,
  parteATrabajos,
  resumenMateriales,
  unidadesDeLinea,
  type MapaArticulos,
  type ParteTrabajo,
} from "./parteTrabajoATrabajos";
import type { QuickTemplate } from "./workshopTypes";

function plantilla(parcial: Partial<QuickTemplate> & Pick<QuickTemplate, "key">): QuickTemplate {
  return {
    key: parcial.key,
    label: parcial.label ?? parcial.key,
    area: parcial.area ?? "camion",
    mode: parcial.mode ?? "team",
    allowedTechs: parcial.allowedTechs ?? [],
    priorityOrder: parcial.priorityOrder ?? [],
    standardMinutes: parcial.standardMinutes ?? null,
    usesQuantity: parcial.usesQuantity,
    unitMinutes: parcial.unitMinutes,
    unitPrice: parcial.unitPrice,
  };
}

const MONTAJE = plantilla({
  key: "montaje-camion",
  label: "Montaje camión mayor 19.5",
  area: "camion",
  usesQuantity: true,
  unitMinutes: 25,
});

const FIJACION = plantilla({
  key: "fijacion",
  label: "Montaje fijación",
  area: "camion",
  usesQuantity: true,
  unitMinutes: 10,
});

const PLANTILLAS = [MONTAJE, FIJACION];

// El parte real escaneado: PT D2_26/62 del 10/09/2026.
const PARTE: ParteTrabajo = {
  numero: "D2_26/62",
  fecha: "2026-09-10",
  horaEntrada: "17:27:57",
  matricula: "8072MNC",
  clienteNombre: "NEUMATICOS SOLEDAD,S.L-RENTING",
  cif: "B03260684",
  km: 0,
  lineas: [
    { descripcion: 'MONTAJE CAMION MAYOR 19.5"', unidades: 4, precioUnitario: 18.54 },
    { descripcion: "MONTAJE FIJACIÓN(QUIT.PONER)CM", unidades: 4, precioUnitario: 17.14 },
    { descripcion: "ALARGADERA PLASTICO 170", unidades: 2, precioUnitario: 0 },
    { descripcion: "ALARGADERA ACODADA 50º CAMION B1198X", unidades: 2, precioUnitario: 0 },
    { descripcion: "315/70X22.5 SAILUN SDL1 154L", unidades: 4, precioUnitario: 600 },
    { descripcion: "ROBLES", unidades: 1, precioUnitario: 0 },
  ],
};

const MAPA: MapaArticulos = {
  [claveArticulo(PARTE.lineas[0])]: MONTAJE.key,
  [claveArticulo(PARTE.lineas[1])]: FIJACION.key,
  [claveArticulo(PARTE.lineas[2])]: CLAVE_MATERIAL,
  [claveArticulo(PARTE.lineas[3])]: CLAVE_MATERIAL,
  [claveArticulo(PARTE.lineas[4])]: CLAVE_MATERIAL,
  [claveArticulo(PARTE.lineas[5])]: CLAVE_MATERIAL,
};

describe("normalizaTexto", () => {
  it("quita acentos, mayúsculas y espacios de sobra", () => {
    expect(normalizaTexto("  Montaje  Fijación ")).toBe("MONTAJE FIJACION");
  });
});

describe("normalizaMatricula", () => {
  it("quita el tipo de vehículo que antepone la captura del ERP", () => {
    expect(normalizaMatricula("CAMION-8072MNC")).toBe("8072MNC");
    expect(normalizaMatricula("REMOLQUE-R1234BCD")).toBe("R1234BCD");
  });

  it("deja intacta una matrícula normal", () => {
    expect(normalizaMatricula(" 8072 mnc ")).toBe("8072MNC");
  });

  it("no recorta si lo de después del guion no parece matrícula", () => {
    expect(normalizaMatricula("CAMION-SINDATOS")).toBe("CAMION-SINDATOS");
  });
});

describe("claveArticulo", () => {
  it("prefiere el código del ERP cuando viene", () => {
    expect(claveArticulo({ descripcion: "lo que sea", unidades: 1, codigo: "art-1" })).toBe("cod:ART-1");
  });

  it("sin código, usa la descripción normalizada", () => {
    expect(claveArticulo({ descripcion: "Montaje Camión", unidades: 1 })).toBe("desc:MONTAJE CAMION");
  });

  it("dos descripciones que solo difieren en acentos y espacios comparten clave", () => {
    const a = claveArticulo({ descripcion: "MONTAJE FIJACIÓN", unidades: 1 });
    const b = claveArticulo({ descripcion: "montaje  fijacion", unidades: 1 });
    expect(a).toBe(b);
  });
});

describe("unidadesDeLinea", () => {
  it("redondea las cantidades del parte", () => {
    expect(unidadesDeLinea({ descripcion: "x", unidades: 4 })).toBe(4);
    expect(unidadesDeLinea({ descripcion: "x", unidades: 4.0 })).toBe(4);
  });

  it("descarta cantidades no válidas", () => {
    expect(unidadesDeLinea({ descripcion: "x", unidades: 0 })).toBe(0);
    expect(unidadesDeLinea({ descripcion: "x", unidades: -3 })).toBe(0);
    expect(unidadesDeLinea({ descripcion: "x", unidades: Number.NaN })).toBe(0);
  });
});

describe("minutosDePlantilla", () => {
  it("multiplica por cantidad cuando la plantilla va por unidades", () => {
    expect(minutosDePlantilla(MONTAJE, 4)).toBe(100);
  });

  it("no multiplica cuando la plantilla es de tiempo fijo", () => {
    const fija = plantilla({ key: "revision", standardMinutes: 75 });
    expect(minutosDePlantilla(fija, 4)).toBe(75);
  });

  it("cae al tiempo estándar si no hay minutos por unidad", () => {
    const rara = plantilla({ key: "rara", usesQuantity: true, unitMinutes: null, standardMinutes: 30 });
    expect(minutosDePlantilla(rara, 3)).toBe(30);
  });

  it("devuelve 0 si la plantilla no tiene ningún tiempo", () => {
    expect(minutosDePlantilla(plantilla({ key: "vacia" }), 2)).toBe(0);
  });
});

describe("entradaEnMs", () => {
  it("respeta la hora de entrada del parte", () => {
    const ms = entradaEnMs(PARTE);
    expect(ms).toBe(new Date("2026-09-10T17:27:57").getTime());
  });

  it("acepta la hora sin segundos", () => {
    expect(entradaEnMs({ ...PARTE, horaEntrada: "08:30" })).toBe(
      new Date("2026-09-10T08:30:00").getTime()
    );
  });

  it("devuelve null si la fecha no es legible", () => {
    expect(entradaEnMs({ ...PARTE, fecha: "10/09/2026" })).toBeNull();
    expect(entradaEnMs({ ...PARTE, fecha: undefined })).toBeNull();
  });
});

describe("parteATrabajos", () => {
  it("crea un trabajo por línea de servicio, con su cantidad y sus minutos", () => {
    const r = parteATrabajos({ parte: PARTE, mapa: MAPA, quickTemplates: PLANTILLAS });

    expect(r.trabajos).toHaveLength(2);

    expect(r.trabajos[0]).toMatchObject({
      templateKey: "montaje-camion",
      area: "camion",
      plate: "8072MNC",
      quantity: 4,
      estimatedMinutes: 100,
      ptNumero: "D2_26/62",
    });

    expect(r.trabajos[1]).toMatchObject({
      templateKey: "fijacion",
      quantity: 4,
      estimatedMinutes: 40,
    });
  });

  it("el material no genera trabajo pero se conserva como referencia", () => {
    const r = parteATrabajos({ parte: PARTE, mapa: MAPA, quickTemplates: PLANTILLAS });

    expect(r.materiales.map((m) => m.descripcion)).toEqual([
      "ALARGADERA PLASTICO 170",
      "ALARGADERA ACODADA 50º CAMION B1198X",
      "315/70X22.5 SAILUN SDL1 154L",
      "ROBLES",
    ]);

    expect(resumenMateriales(r.materiales)).toContain("315/70X22.5 SAILUN SDL1 154L ×4");
  });

  it("los trabajos heredan cliente y hora de entrada del parte, no la de volcado", () => {
    const r = parteATrabajos({ parte: PARTE, mapa: MAPA, quickTemplates: PLANTILLAS });

    expect(r.trabajos[0].customerName).toBe("NEUMATICOS SOLEDAD,S.L-RENTING");
    expect(r.trabajos[0].arrivedAtMs).toBe(new Date("2026-09-10T17:27:57").getTime());
  });

  it("una línea que nadie ha enseñado sale para resolver, no se descarta", () => {
    const r = parteATrabajos({ parte: PARTE, mapa: {}, quickTemplates: PLANTILLAS });

    expect(r.trabajos).toHaveLength(0);
    expect(r.sinMapear).toHaveLength(6);
    expect(r.sinMapear[0].descripcion).toBe('MONTAJE CAMION MAYOR 19.5"');
  });

  it("si la plantilla enseñada ya no existe, la línea vuelve a sin mapear y avisa", () => {
    const r = parteATrabajos({
      parte: PARTE,
      mapa: { ...MAPA, [claveArticulo(PARTE.lineas[0])]: "plantilla-borrada" },
      quickTemplates: PLANTILLAS,
    });

    expect(r.sinMapear.map((l) => l.descripcion)).toContain('MONTAJE CAMION MAYOR 19.5"');
    expect(r.avisos.join(" ")).toContain("plantilla-borrada");
  });

  it("una línea de servicio con 0 unidades no crea trabajo y lo dice", () => {
    const parte = {
      ...PARTE,
      lineas: [{ descripcion: 'MONTAJE CAMION MAYOR 19.5"', unidades: 0 }],
    };

    const r = parteATrabajos({ parte, mapa: MAPA, quickTemplates: PLANTILLAS });

    expect(r.trabajos).toHaveLength(0);
    expect(r.avisos.join(" ")).toContain("no se crea trabajo");
  });

  it("un parte solo de material avisa de que no hay nada que crear", () => {
    const parte = { ...PARTE, lineas: [PARTE.lineas[4]] };

    const r = parteATrabajos({ parte, mapa: MAPA, quickTemplates: PLANTILLAS });

    expect(r.trabajos).toHaveLength(0);
    expect(r.avisos.join(" ")).toContain("no hay trabajo que crear");
  });

  it("avisa si el parte llega sin matrícula, pero no se planta", () => {
    const r = parteATrabajos({
      parte: { ...PARTE, matricula: "" },
      mapa: MAPA,
      quickTemplates: PLANTILLAS,
    });

    expect(r.avisos.join(" ")).toContain("matrícula");
    expect(r.trabajos).toHaveLength(2);
  });

  it("avisa si no hay hora de entrada legible", () => {
    const r = parteATrabajos({
      parte: { ...PARTE, fecha: undefined },
      mapa: MAPA,
      quickTemplates: PLANTILLAS,
    });

    expect(r.trabajos[0].arrivedAtMs).toBeNull();
    expect(r.avisos.join(" ")).toContain("hora de volcado");
  });

  it("normaliza la matrícula del parte", () => {
    const r = parteATrabajos({
      parte: { ...PARTE, matricula: " 8072 mnc " },
      mapa: MAPA,
      quickTemplates: PLANTILLAS,
    });

    expect(r.trabajos[0].plate).toBe("8072MNC");
  });

  it("acepta la matrícula tal y como sale en la captura del ERP", () => {
    const r = parteATrabajos({
      parte: { ...PARTE, matricula: "CAMION-8072MNC" },
      mapa: MAPA,
      quickTemplates: PLANTILLAS,
    });

    expect(r.trabajos[0].plate).toBe("8072MNC");
  });

  it("un parte sin líneas no revienta", () => {
    const r = parteATrabajos({
      parte: { ...PARTE, lineas: [] },
      mapa: MAPA,
      quickTemplates: PLANTILLAS,
    });

    expect(r.trabajos).toEqual([]);
    expect(r.avisos.join(" ")).toContain("no hay trabajo que crear");
  });
});
