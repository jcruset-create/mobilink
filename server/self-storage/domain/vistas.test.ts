import { describe, expect, it } from "vitest";
import { CAMPOS_PRIVADOS, vistaTrasteroPanel, vistaTrasteroPublica, type FilaTrastero, type Ocupacion } from "./vistas.ts";

const fila: FilaTrastero = {
  id: "u1",
  center_id: "c1",
  zone_id: "z1",
  zone_code: "Z2",
  zone_name: "Zona 2",
  unit_type_id: "t1",
  type_code: "BOX-3",
  type_name: "Trastero 3 m²",
  type_image_3d_url: "https://img/3.webp",
  type_capacity_description: "Un piso pequeño",
  type_capacity_examples: ["20 cajas"],
  code: "2-014",
  name: null,
  width_cm: 150,
  length_cm: 200,
  height_cm: 250,
  area_m2: 3,
  volume_m3: 7.5,
  monthly_price: 49.59,
  tax_rate: 21,
  vat_amount: 10.41,
  monthly_price_gross: 60,
  deposit_amount: 60,
  status: "occupied",
  status_reason: null,
  image_3d_url: null,
  floor_plan_shape_id: "box-2-014",
  public_visible: true,
  notes: "llave de repuesto en el cajón 3",
};

const ocupacion: Ocupacion = {
  contract_id: "k1",
  contract_number: "SSC-1",
  contract_status: "active",
  start_date: "2026-01-01",
  end_date: null,
  customer_id: "cu1",
  customer_type: "individual",
  first_name: "Juan",
  last_name: "Pérez",
  company_name: null,
};

describe("vistas del trastero", () => {
  it("la pública no lleva NADA privado (ni notas, ni cliente, ni contrato, ni base, ni estado interno)", () => {
    const v = vistaTrasteroPublica(fila);
    const texto = JSON.stringify(v);
    for (const campo of CAMPOS_PRIVADOS) expect(v).not.toHaveProperty(campo);
    expect(texto).not.toContain("Juan");
    expect(texto).not.toContain("llave");
    expect(v.available).toBe(false);
    expect(v.image3dUrl).toBe("https://img/3.webp"); // la del tipo
  });

  it("la pública tiene exactamente los campos de la lista blanca", () => {
    expect(Object.keys(vistaTrasteroPublica(fila)).sort()).toEqual(
      [
        "id", "code", "widthCm", "lengthCm", "heightCm", "areaM2", "volumeM3", "monthlyPriceGross", "available",
        "image3dUrl", "unitTypeName", "capacityDescription", "capacityExamples", "floorPlanShapeId",
      ].sort()
    );
  });

  it("panel con permiso de clientes: cliente y contrato", () => {
    const v = vistaTrasteroPanel(fila, ocupacion, true);
    expect(v.customer).toEqual({ id: "cu1", name: "Juan Pérez" });
    expect(v.contract?.number).toBe("SSC-1");
  });

  it("panel de mantenimiento: el trastero sí, el cliente no", () => {
    const v = vistaTrasteroPanel(fila, ocupacion, false);
    expect(v.customer).toBeNull();
    expect(v.contract).toBeNull();
    expect(v.code).toBe("2-014");
  });
});
