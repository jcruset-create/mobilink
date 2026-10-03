/**
 * Qué se enseña de un trastero, según quién mira.
 *
 * El componente del plano es el mismo en el panel y en la web pública; lo que
 * cambia es lo que le llega. La decisión vive AQUÍ, en el servidor, con listas
 * BLANCAS construidas campo a campo: la vista pública no se obtiene quitando
 * campos a la del panel (un campo nuevo se colaría solo), sino poniendo uno a
 * uno los que se pueden ver. Una prueba comprueba que no lleva nada privado.
 */

import type { ContractStatus, CustomerType, UnitStatus } from "../../../src/modules/self-storage/types/enums.ts";
import { disponibleParaAlquilar } from "./unitStatus.ts";

export type FilaTrastero = {
  id: string;
  center_id: string;
  zone_id: string;
  zone_code: string;
  zone_name: string;
  unit_type_id: string | null;
  type_code: string | null;
  type_name: string | null;
  type_image_3d_url: string | null;
  type_capacity_description: string | null;
  type_capacity_examples: string[] | null;
  code: string;
  name: string | null;
  width_cm: number;
  length_cm: number;
  height_cm: number;
  area_m2: number;
  volume_m3: number;
  monthly_price: number;
  /** Tipo de IVA (porcentaje) vigente cuando se fijó el precio. */
  tax_rate: number;
  /** Cuota de IVA en euros. */
  vat_amount: number;
  monthly_price_gross: number;
  deposit_amount: number;
  status: UnitStatus;
  status_reason: string | null;
  image_3d_url: string | null;
  floor_plan_shape_id: string | null;
  public_visible: boolean;
  notes: string | null;
};

export type Ocupacion = {
  contract_id: string;
  contract_number: string;
  contract_status: ContractStatus;
  start_date: string;
  end_date: string | null;
  customer_id: string;
  customer_type: CustomerType;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  /** Precio CONTRATADO (puede no ser el de tarifa del trastero). */
  contract_monthly_price?: number | null;
  contract_monthly_price_gross?: number | null;
  /** Estado de cobros del contrato: al día, con facturas pendientes o en impago. */
  payment_status?: "up_to_date" | "pending" | "overdue" | null;
};

export function nombreCliente(c: { customer_type: CustomerType; first_name: string | null; last_name: string | null; company_name: string | null }): string {
  return c.customer_type === "company"
    ? (c.company_name ?? "").trim()
    : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
}

/** La imagen 3D del box: la suya si tiene, si no la de su tipo. */
export const imagen3d = (u: FilaTrastero) => u.image_3d_url ?? u.type_image_3d_url ?? null;

/**
 * Vista del panel. `verClientes` = el rol puede ver datos personales; el de
 * mantenimiento ve el trastero y su estado, pero no quién lo alquila.
 */
export function vistaTrasteroPanel(u: FilaTrastero, ocupacion: Ocupacion | null, verClientes: boolean) {
  return {
    id: u.id,
    centerId: u.center_id,
    code: u.code,
    name: u.name,
    zone: { id: u.zone_id, code: u.zone_code, name: u.zone_name },
    unitType: u.unit_type_id ? { id: u.unit_type_id, code: u.type_code, name: u.type_name } : null,
    widthCm: u.width_cm,
    lengthCm: u.length_cm,
    heightCm: u.height_cm,
    areaM2: u.area_m2,
    volumeM3: u.volume_m3,
    monthlyPrice: u.monthly_price,
    taxRate: u.tax_rate,
    vatAmount: u.vat_amount,
    monthlyPriceGross: u.monthly_price_gross,
    depositAmount: u.deposit_amount,
    status: u.status,
    statusReason: u.status_reason,
    image3dUrl: imagen3d(u),
    floorPlanShapeId: u.floor_plan_shape_id,
    publicVisible: u.public_visible,
    notes: u.notes,
    contract:
      ocupacion && verClientes
        ? {
            id: ocupacion.contract_id,
            number: ocupacion.contract_number,
            status: ocupacion.contract_status,
            startDate: ocupacion.start_date,
            endDate: ocupacion.end_date,
            monthlyPrice: ocupacion.contract_monthly_price ?? null,
            monthlyPriceGross: ocupacion.contract_monthly_price_gross ?? null,
          }
        : null,
    customer: ocupacion && verClientes ? { id: ocupacion.customer_id, name: nombreCliente(ocupacion) } : null,
    /** Estado de cobros del contrato vivo (sólo para quien ve clientes). */
    paymentStatus: (ocupacion && verClientes ? (ocupacion.payment_status ?? null) : null) as null | string,
  };
}

/** Vista de la web pública: sólo lo que un visitante puede saber. */
export function vistaTrasteroPublica(u: FilaTrastero) {
  return {
    id: u.id,
    code: u.code,
    widthCm: u.width_cm,
    lengthCm: u.length_cm,
    heightCm: u.height_cm,
    areaM2: u.area_m2,
    volumeM3: u.volume_m3,
    monthlyPriceGross: u.monthly_price_gross,
    available: disponibleParaAlquilar(u.status, u.public_visible),
    image3dUrl: imagen3d(u),
    unitTypeName: u.type_name,
    capacityDescription: u.type_capacity_description,
    capacityExamples: u.type_capacity_examples ?? [],
    floorPlanShapeId: u.floor_plan_shape_id,
  };
}

export const CAMPOS_PRIVADOS = [
  "notes",
  "statusReason",
  "status_reason",
  "customer",
  "contract",
  "monthlyPrice",
  "vatAmount",
  "depositAmount",
  "paymentStatus",
  "publicVisible",
] as const;
