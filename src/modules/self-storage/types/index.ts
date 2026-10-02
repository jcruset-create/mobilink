/**
 * Tipos de la API interna de Self Storage tal como los ve el panel. Son las
 * vistas que construye el servidor (`server/self-storage/domain/vistas.ts` y
 * los repositorios): aquí no hay ningún dato que el servidor no mande.
 */

import type { ContractStatus, CustomerStatus, CustomerType, RecordStatus, StaffRole, UnitStatus } from "./enums";

export * from "./enums";

export type Bootstrap = {
  rol: StaffRole | null;
  permisos: string[];
  usuario: { id: string; nombre: string };
  centros: { id: string; code: string; name: string; status: RecordStatus }[];
  vocabulario: {
    unitStatuses: UnitStatus[];
    customerStatuses: CustomerStatus[];
    customerTypes: CustomerType[];
    contractStatuses: ContractStatus[];
    etiquetas: {
      unitStatus: Record<UnitStatus, string>;
      customerStatus: Record<CustomerStatus, string>;
      customerType: Record<CustomerType, string>;
      contractStatus: Record<ContractStatus, string>;
    };
  };
};

export type Centro = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  timezone: string;
  phone: string | null;
  email: string | null;
  publicVisible: boolean;
  status: RecordStatus;
  zonas?: number;
  trasteros?: number;
};

export type Zona = {
  id: string;
  centerId: string;
  code: string;
  name: string;
  floor: string | null;
  sortOrder: number;
  status: RecordStatus;
  trasteros?: number;
};

export type TipoTrastero = {
  id: string;
  centerId: string | null;
  code: string;
  name: string;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  nominalAreaM2: number;
  nominalVolumeM3: number;
  image3dUrl: string | null;
  capacityDescription: string | null;
  capacityExamples: string[];
  sortOrder: number;
  active: boolean;
  trasteros: number;
};

export type Trastero = {
  id: string;
  centerId: string;
  code: string;
  name: string | null;
  zone: { id: string; code: string; name: string };
  unitType: { id: string; code: string | null; name: string | null } | null;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  areaM2: number;
  volumeM3: number;
  monthlyPrice: number;
  taxRate: number;
  monthlyPriceGross: number;
  depositAmount: number;
  status: UnitStatus;
  statusReason: string | null;
  image3dUrl: string | null;
  floorPlanShapeId: string | null;
  publicVisible: boolean;
  notes: string | null;
  contract: { id: string; number: string; status: ContractStatus; startDate: string; endDate: string | null } | null;
  customer: { id: string; name: string } | null;
  paymentStatus: string | null;
};

export type Plano = {
  center: { id: string; code: string; name: string };
  plan: { id: string; version: number; name: string; svg: string; shapeIds: string[]; createdAt: string } | null;
  units: Trastero[];
  unlinkedShapes: string[];
  orphanUnits: { id: string; code: string; shapeId: string }[];
};

export type Cliente = {
  id: string;
  customerType: CustomerType;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  taxId: string;
  phone: string;
  email: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  status: CustomerStatus;
  statusReason: string | null;
  notes: string | null;
  hasPortalAccount: boolean;
  displayName: string;
  contratosVivos?: number;
};

export type Telefono = { id: string; phone: string; label: string | null; allowDoorAccess: boolean };

export type ContratoResumen = {
  id: string;
  contractNumber: string;
  status: ContractStatus;
  startDate: string;
  endDate: string | null;
  monthlyPrice: number;
  unitId: string;
  unitCode: string;
  centerId: string;
  centerName: string;
  members: number;
};

export type FichaCliente = Cliente & { phones: Telefono[]; contracts: ContratoResumen[] };

export type Indicadores = {
  total: number;
  available: number;
  reserved: number;
  occupied: number;
  maintenance: number;
  blocked: number;
  rentable: number;
  areaTotal: number;
  areaOcupada: number;
  occupancyPct: number | null;
  occupancyRentablePct: number | null;
  areaOccupancyPct: number | null;
};

export type Dashboard = {
  centerId: string | null;
  units: Indicadores;
  byCenter: (Indicadores & { id: string; code: string; name: string })[];
  byZone: (Indicadores & { id: string; code: string; name: string; centerName: string })[];
  customers: { active: number; blocked: number; total: number };
  billing: { monthlyInvoiced: number | null; pendingCollection: number | null; overdue: number | null; phase: number };
  access: { today: number | null; doors: unknown; phase: number };
};

export type FilaImportacion = {
  rowNumber: number;
  unitCode: string | null;
  raw: Record<string, string>;
  parsed: (Record<string, unknown> & { cambios?: string[] }) | null;
  errors: string[];
  warnings: string[];
  action: "create" | "update" | "skip" | "error";
  storageUnitId: string | null;
};

export type Importacion = {
  id: string;
  centerId: string;
  fileName: string;
  status: "validated" | "applied" | "failed";
  summary: {
    total: number;
    create: number;
    update: number;
    skip: number;
    error: number;
    warnings: number;
    columnasIgnoradas?: string[];
    creados?: number;
    actualizados?: number;
  };
  createdAt: string;
  appliedAt: string | null;
  rows?: FilaImportacion[];
};
