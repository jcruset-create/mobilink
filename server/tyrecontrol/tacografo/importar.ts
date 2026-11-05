/**
 * Qué se graba de un fichero, y qué no.
 *
 * Es la continuación de `simular.ts`: aquélla dice qué PASARÍA, ésta prepara
 * exactamente las filas que se van a escribir. Sigue sin tocar la base —eso
 * es `escribir.ts`— para que lo que decide qué entra se pueda probar entero
 * sin levantar nada.
 *
 * ── Las tres salidas de una fila ────────────────────────────────────────────
 *
 *   · se GRABA      · es nueva y tiene lo mínimo para existir.
 *   · se SALTA      · ese `id_origen` ya está importado para esta empresa.
 *                     No es un error: es lo que hace que volver a pasar el
 *                     mismo fichero no duplique nada, y que la exportación
 *                     del mes que viene traiga solo lo nuevo.
 *   · se BLOQUEA    · le falta algo sin lo que no puede existir, y se dice
 *                     cuál con su número de fila. Un recuento de «bloqueadas:
 *                     7» no sirve para arreglar nada.
 *
 * ── Qué bloquea, y por qué esos tres ────────────────────────────────────────
 *
 * `id_origen` y `fecha` son NOT NULL en la tabla, así que sin ellos la fila
 * no cabe. Y la fecha además no es un capricho del esquema: una intervención
 * sin fecha no se puede situar en el histórico ni cuenta para el vencimiento,
 * que es para lo que se importa. La matrícula se exige porque sin ella no hay
 * ni a quién vincular ni a quién vincular DESPUÉS.
 *
 * Todo lo demás entra aunque venga a medias: una intervención sin número de
 * serie del sensor sigue siendo una intervención.
 *
 * ── Lo que NO se escribe nunca desde aquí ───────────────────────────────────
 *
 * Ni montajes, ni neumáticos, ni ejes, ni la configuración del vehículo, ni
 * `tc_vehiculos.km_actual`. El kilometraje del tacógrafo son lecturas
 * fechadas que viven en su intervención; el km actual del vehículo viene de
 * la telemática y no se toca.
 */

import type { FilaTacografo } from "./parser.ts";
import type { VehiculoRef } from "./simular.ts";

/** Una fila lista para insertarse, con los nombres de columna de la tabla. */
export interface FilaInsert {
  empresa_id: string;
  vehiculo_id: string | null;
  sistema_origen: string;
  id_origen: string;
  fecha: string;
  tipo_operacion: string | null;
  resultado: string | null;
  orden_trabajo: string | null;

  referencia: string | null;
  version: string | null;
  version_mapa: string | null;
  num_serie: string | null;
  num_sensor: string | null;
  gnss: string | null;
  dsrc: string | null;
  tipo_tacografo: string | null;
  fabricante: string | null;
  precintos: string | null;

  medida_neumatico: string | null;
  medida_neumatico_norm: string | null;
  medida_sospechosa: boolean;
  medida_anterior: string | null;
  medida_anterior_norm: string | null;

  km_anterior: number | null;
  km_nuevo: number | null;
  km_sospechoso: boolean;

  param_l: string | null;
  param_w: string | null;
  param_k: string | null;
  param_l_anterior: string | null;
  param_w_anterior: string | null;

  b_rodillos: string | null;
  eq_calibrado: string | null;
  manometro: string | null;
  cronometro: string | null;

  matricula_origen: string | null;
  matricula_norm: string;
  bastidor_origen: string | null;
  marca: string | null;
  modelo: string | null;
  categoria: string | null;
  cliente_nombre_origen: string | null;

  tecnico: string | null;
  tecnico_tarjeta: string | null;
  tecnico_tarjeta_cad: string | null;
  tecnico_tarjeta_ver: string | null;

  observaciones: string | null;
  tgd_fichero: string | null;
  comprobaciones: Record<string, string> | null;

  lote_id: string;
  archivo_nombre: string | null;
  hoja_origen: string | null;
  fila_origen: number;
  importado_por: string | null;
}

export interface FilaBloqueada {
  fila_origen: number;
  id_origen: string | null;
  matricula: string | null;
  fecha: string | null;
  motivo: string;
  valor: string | null;
}

export interface Preparacion {
  insertar: FilaInsert[];
  bloqueadas: FilaBloqueada[];
  /** `id_origen` que ya estaban: ni se insertan ni son un problema. */
  saltadas: string[];
  /** De las que se insertan, cuántas van sin vehículo. */
  sinVehiculo: number;
}

export interface OpcionesPreparar {
  empresa: string;
  loteId: string;
  sistemaOrigen: string;
  archivo: string | null;
  hoja: string | null;
  usuarioId: string | null;
  vehiculos: VehiculoRef[];
  yaImportados: Set<string>;
}

/**
 * Las lecturas de kilometraje que bajan respecto a la anterior del mismo
 * vehículo. No se descartan —lo más probable es un cambio de
 * cuentakilómetros, que es un dato— pero se marcan.
 */
export function marcarKmSospechoso(filas: FilaTacografo[]): Set<string> {
  const porVeh = new Map<string, FilaTacografo[]>();
  for (const f of filas) {
    if (!porVeh.has(f.matriculaNorm)) porVeh.set(f.matriculaNorm, []);
    porVeh.get(f.matriculaNorm)!.push(f);
  }
  const sospechosas = new Set<string>();
  for (const lista of porVeh.values()) {
    const cron = [...lista]
      .filter((f) => f.kmNuevo != null && f.fecha)
      .sort((a, b) => a.fecha!.localeCompare(b.fecha!));
    for (let i = 1; i < cron.length; i += 1) {
      if (cron[i].kmNuevo! < cron[i - 1].kmNuevo!) sospechosas.add(cron[i].idOrigen);
    }
  }
  return sospechosas;
}

export function preparar(filas: FilaTacografo[], op: OpcionesPreparar): Preparacion {
  const porMatricula = new Map<string, VehiculoRef>();
  for (const v of op.vehiculos) if (!porMatricula.has(v.matriculaNorm)) porMatricula.set(v.matriculaNorm, v);

  const kmRaro = marcarKmSospechoso(filas);

  const insertar: FilaInsert[] = [];
  const bloqueadas: FilaBloqueada[] = [];
  const saltadas: string[] = [];
  let sinVehiculo = 0;

  for (const f of filas) {
    if (!f.idOrigen) {
      bloqueadas.push({ fila_origen: f.fila, id_origen: null, matricula: f.matriculaOrigen,
        fecha: f.fecha, motivo: "Sin identificador de intervención", valor: null });
      continue;
    }
    if (!f.fecha) {
      bloqueadas.push({ fila_origen: f.fila, id_origen: f.idOrigen, matricula: f.matriculaOrigen,
        fecha: null, motivo: "Sin fecha: no se puede situar en el histórico ni cuenta para el vencimiento",
        valor: null });
      continue;
    }
    if (!f.matriculaNorm) {
      bloqueadas.push({ fila_origen: f.fila, id_origen: f.idOrigen, matricula: null,
        fecha: f.fecha, motivo: "Sin matrícula", valor: null });
      continue;
    }
    if (op.yaImportados.has(f.idOrigen)) {
      saltadas.push(f.idOrigen);
      continue;
    }

    const veh = porMatricula.get(f.matriculaNorm) ?? null;
    if (!veh) sinVehiculo += 1;

    insertar.push({
      empresa_id: op.empresa,
      vehiculo_id: veh?.id ?? null,
      sistema_origen: op.sistemaOrigen,
      id_origen: f.idOrigen,
      fecha: f.fecha,
      tipo_operacion: f.tipoOperacion,
      resultado: f.resultado,
      orden_trabajo: f.ordenTrabajo,

      referencia: f.referencia,
      version: f.version,
      version_mapa: f.versionMapa,
      num_serie: f.numSerie,
      num_sensor: f.numSensor,
      gnss: f.gnss,
      dsrc: f.dsrc,
      tipo_tacografo: f.tipoTacografo,
      fabricante: f.fabricante,
      precintos: f.precintos,

      medida_neumatico: f.medidaOrigen,
      medida_neumatico_norm: f.medidaNorm,
      medida_sospechosa: f.medidaSospechosa,
      medida_anterior: f.medidaAnteriorOrigen,
      medida_anterior_norm: f.medidaAnteriorNorm,

      km_anterior: f.kmAnterior,
      km_nuevo: f.kmNuevo,
      km_sospechoso: kmRaro.has(f.idOrigen),

      param_l: f.paramL,
      param_w: f.paramW,
      param_k: f.paramK,
      param_l_anterior: f.paramLAnterior,
      param_w_anterior: f.paramWAnterior,

      b_rodillos: f.bRodillos,
      eq_calibrado: f.eqCalibrado,
      manometro: f.manometro,
      cronometro: f.cronometro,

      matricula_origen: f.matriculaOrigen,
      matricula_norm: f.matriculaNorm,
      bastidor_origen: f.bastidor,
      marca: f.marca,
      modelo: f.modelo,
      categoria: f.categoria,
      cliente_nombre_origen: f.clienteNombre,

      tecnico: f.tecnico,
      tecnico_tarjeta: f.tecnicoTarjeta,
      tecnico_tarjeta_cad: f.tecnicoTarjetaCad,
      tecnico_tarjeta_ver: f.tecnicoTarjetaVer,

      observaciones: f.observaciones,
      tgd_fichero: f.tgdFichero,
      comprobaciones: f.comprobaciones,

      lote_id: op.loteId,
      archivo_nombre: op.archivo,
      hoja_origen: op.hoja,
      fila_origen: f.fila,
      importado_por: op.usuarioId,
    });
  }

  return { insertar, bloqueadas, saltadas, sinVehiculo };
}
