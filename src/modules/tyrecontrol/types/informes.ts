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

// ── Informe ejecutivo ────────────────────────────────────────
// Refleja el jsonb de la RPC tc_informe_ejecutivo (ver migración
// tyrecontrol_informe_ejecutivo.sql). Todo lo que puede venir vacío está
// tipado como nullable a propósito: una flota recién dada de alta no tiene
// histórico y la pantalla debe saber decirlo en vez de pintar ceros.
export type Semaforo = "intervenir" | "revisar" | "vigilar" | "correcto" | "sin_datos";
export type NivelDesgaste = "critico" | "bajo" | "medio" | "bueno" | "excelente";

export interface InformeEjecutivo {
  periodo: { desde: string; hasta: string };
  periodo_anterior: { desde: string; hasta: string };
  generado: string;
  cabecera: {
    vehiculos_total: number;
    vehiculos_revisados: number;
    vehiculos_pendientes: number;
    neumaticos_medidos: number;
    revisiones: number;
  };
  comparativa: {
    revisiones_actual: number;
    revisiones_previo: number;
    vehiculos_revisados_actual: number;
    vehiculos_revisados_previo: number;
    prof_media_actual: number | null;
    prof_media_previo: number | null;
    criticos_actual: number;
    criticos_previo: number;
  };
  niveles: Partial<Record<NivelDesgaste, number>>;
  bandas: { banda: string; n: number }[];
  estadistica: {
    n: number;
    media: number | null; mediana: number | null;
    p10: number | null; p25: number | null; p75: number | null; p90: number | null;
    minimo: number | null; maximo: number | null;
    desviacion: number | null; coef_variacion: number | null;
  };
  evolucion: { mes: string; revisiones: number; prof_media: number | null; bajo_legal: number }[];
  /** Serie histórica del banco de goma: mediciones de CADA mes por banda. */
  evolucion_bandas: {
    mes: string;
    total: number;
    bandas: Record<string, number>;
    reesculturados: number;
    recauchutados: number;
    rees_y_recau: number;
  }[];
  por_medida: { medida: string; unidades: number; prof_media: number | null; criticos: number }[];
  por_marca: { marca: string; unidades: number; prof_media: number | null; criticos: number; reesculturados: number }[];
  por_base: {
    base: string; vehiculos: number; intervenir: number; revisar: number;
    sin_datos: number; min_mm: number | null; media_mm: number | null;
  }[];
  por_eje: { eje: number; unidades: number; prof_media: number | null; criticos: number }[];
  vehiculos: {
    matricula: string; base: string | null; semaforo: Semaforo;
    n_neumaticos: number; min_mm: number | null; media_mm: number | null;
    criticos: number; bajos: number; km: number | null; ultima_revision: string | null;
  }[];
  anomalias: {
    ejes_descompensados: { matricula: string; eje: number; dif_mm: number }[];
    ejes_marcas_mezcladas: { matricula: string; eje: number; marcas: number }[];
    sin_marca: number;
    sin_medida: number;
  };
  prediccion: {
    con_ritmo_medido: number; sin_historico: number; vencidos: number;
    dias_30: number; dias_60: number; dias_90: number; dias_180: number;
  };
}
