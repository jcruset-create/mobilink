// Tipos del módulo Informes (BI). Se apoyan en las funciones RPC de
// agregación de Postgres (tc_informes_*), no en cálculo en el navegador.

export interface FiltrosInformes {
  empresaId: string | null;
  desde: string | null; // YYYY-MM-DD
  hasta: string | null;
}

export interface KpisInformes {
  vehiculos_activos: number;
  vehiculos_revisados: number;
  vehiculos_pendientes: number;
  revisiones_total: number;
  tecnicos_activos: number;
  neumaticos_total: number;
  neumaticos_montados: number;
  neumaticos_almacen: number;
  neumaticos_reparacion: number;
  neumaticos_descartados: number;
  neumaticos_bajo_minimo: number;
  neumaticos_proximos: number;
  op_montajes: number;
  op_rotaciones: number;
  op_reparaciones: number;
  op_sustituciones: number;
  op_descartes: number;
}

export interface EstadoFlota {
  total: number;
  correcto: number;
  revisar: number;
  urgente: number;
  pendiente: number;
  evolucion: { mes: string; revisiones: number }[];
}

export interface DimensionTotal {
  etiqueta: string;
  total: number;
}

export interface MarcaMedidaTotal {
  marca: string;
  medida: string;
  total: number;
}

export interface Alerta {
  tipo: "bajo_minimo" | "proximo_sustitucion" | "vehiculo_sin_revisar" | string;
  severidad: "alta" | "media" | "baja" | string;
  vehiculo_id: string | null;
  matricula: string | null;
  neumatico_id: string | null;
  codigo: string | null;
  posicion: string | null;
  detalle: string;
  valor: number | null;
}

export interface ProfundidadDistribucion {
  marca: string;
  r0_2: number;
  r2_4: number;
  r4_6: number;
  r6_8: number;
  r8_10: number;
  r10: number;
  total: number;
}
