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

export interface EconomicoInformes {
  coste_neumaticos: number;
  coste_operaciones: number;
  coste_reparaciones: number;
  coste_sustituciones: number;
  coste_montajes: number;
  coste_total: number;
  n_vehiculos: number;
  km_flota: number;
  ahorro_reparaciones: number;
}

export interface RankingVehiculo {
  vehiculo_id: string;
  matricula: string;
  km: number;
  coste_total: number;
  coste_km: number | null;
  n_pinchazos: number;
  n_reparaciones: number;
}

export interface RankingMarca {
  marca: string;
  n_neumaticos: number;
  coste_medio: number;
  prof_media: number | null;
  n_reparaciones: number;
  km_medio: number | null;
  coste_km_medio: number | null;
}

export interface OperacionesInforme {
  total: number;
  por_tipo: { tipo: string; n: number }[];
  por_motivo: { motivo: string; n: number }[];
  evolucion: { mes: string; n: number }[];
}

export interface PresionNeumatico {
  neumatico_id: string;
  codigo: string | null;
  matricula: string | null;
  posicion: string | null;
  presion_medida: number | null;
  presion_recomendada: number | null;
  diferencia: number | null;
  estado: "baja" | "alta" | "ok" | "sin_referencia" | string;
}

export interface ProductividadTecnico {
  tecnico_id: string | null;
  tecnico: string;
  revisiones: number;
  neumaticos_revisados: number;
  operaciones: number;
}

export interface DesgasteNeumatico {
  neumatico_id: string;
  codigo: string | null;
  marca: string | null;
  modelo: string | null;
  medida: string | null;
  ultima_prof: number | null;
  mm_por_1000km: number | null;
  km_restantes: number | null;
  fecha_prevista: string | null;
  n_medidas: number;
}

export interface CosteKmNeumatico {
  neumatico_id: string;
  codigo: string | null;
  marca: string | null;
  modelo: string | null;
  medida: string | null;
  km_recorridos: number;
  coste_total: number;
  coste_km: number | null;
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
