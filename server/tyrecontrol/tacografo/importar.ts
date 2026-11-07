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

  /**
   * El lote de importación, cuando viene de un fichero del centro. Las que
   * se crean leyendo un informe en PDF no tienen lote: no son una
   * importación, son un documento que alguien adjuntó. Su rastro es el PDF
   * adjunto, `importado_por` y `creada_de_pdf`.
   */
  lote_id: string | null;
  creada_de_pdf: boolean;
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
  /**
   * Las que ya estaban pero las creó un informe en PDF, con la fila del Excel
   * lista para completarlas. Ver `parcheParaCompletar()`.
   */
  completar: Array<{ idOrigen: string; nueva: FilaInsert }>;
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
  /** De las ya importadas, las que creó un PDF y están a medias. */
  creadasDePdf?: Set<string>;
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


/**
 * Columnas que el Excel NUNCA pisa al completar una fila que creó un PDF.
 *
 * `vehiculo_id` está aquí por lo mismo que `deshacer.ts` se niega a borrar
 * intervenciones vinculadas a mano: alguien puede haberla cambiado mirándola,
 * y pisarla le tiraría ese trabajo. La identidad tampoco se toca, por razones
 * obvias.
 */
const NUNCA_SE_PISA = new Set([
  "id", "empresa_id", "sistema_origen", "id_origen", "vehiculo_id",
  "created_at", "importado_en", "importado_por",
]);

/**
 * Columnas que el Excel SIEMPRE manda, aunque la fila ya traiga valor.
 *
 * Las cuatro primeras son la trazabilidad: la fila pasa a venir del fichero
 * del centro, con su lote, y el `fila_origen` que traía del PDF era un número
 * de página, que ahí no significa nada.
 *
 * Las dos últimas son las sospechas, y es importante: `km_sospechoso` se
 * decide comparando con las lecturas anteriores del mismo vehículo, y un PDF
 * suelto no tiene con qué comparar. El Excel sí.
 */
const SIEMPRE_DEL_EXCEL = [
  "lote_id", "archivo_nombre", "hoja_origen", "fila_origen",
  "km_sospechoso", "medida_sospechosa",
] as const;

/**
 * El parche con el que una fila del Excel COMPLETA la que creó un informe en
 * PDF, en vez de saltársela por «ya importada».
 *
 * Hace falta porque el impreso no lo trae todo: de las unidades VDO no trae
 * la versión de software, y de una transferencia el Excel del centro no trae
 * el bastidor ni el modelo (comprobado: en producción están a null y el PDF
 * sí los lleva). O sea que cada camino sabe cosas que el otro no, y la fila
 * buena es la unión.
 *
 * Solo se rellena lo que está a NULL. Si el Excel dice una cosa y la fila
 * otra, se queda lo que ya había: no es trabajo de un importador decidir
 * cuál de dos valores distintos es el bueno, y pisarlo borraría la evidencia
 * sin que nadie se enterara.
 */
export function parcheParaCompletar(
  existente: Record<string, unknown>, nueva: FilaInsert,
): Record<string, unknown> {
  const parche: Record<string, unknown> = { creada_de_pdf: false };
  for (const [clave, valor] of Object.entries(nueva as unknown as Record<string, unknown>)) {
    if (NUNCA_SE_PISA.has(clave)) continue;
    if ((SIEMPRE_DEL_EXCEL as readonly string[]).includes(clave)) { parche[clave] = valor; continue; }
    const hay = existente[clave];
    if ((hay === null || hay === undefined) && valor !== null && valor !== undefined) {
      parche[clave] = valor;
    }
  }
  return parche;
}

/** Lo que hace falta saber, además de la fila, para dejarla lista para insertar. */
export interface ContextoInsert {
  empresa: string;
  sistemaOrigen: string;
  /** El vehículo al que se vincula, o `null` si la matrícula no casa. */
  vehiculoId: string | null;
  /** `null` cuando no viene de un fichero del centro (ver `FilaInsert.lote_id`). */
  loteId: string | null;
  archivo: string | null;
  hoja: string | null;
  usuarioId: string | null;
  kmSospechoso: boolean;
  creadaDePdf?: boolean;
}

/**
 * De una fila leída a una fila de la tabla.
 *
 * Está aquí fuera y no dentro de `preparar()` porque hay DOS caminos que
 * acaban en la misma tabla: el Excel mensual del centro y el informe técnico
 * en PDF de una intervención suelta. Con dos mapeos, el día que se añada una
 * columna se añadiría en uno y no en el otro, y la ficha enseñaría un dato
 * según por dónde hubiera entrado.
 *
 * Da por hecho que la fila trae `idOrigen`, `fecha` y `matriculaNorm`: son
 * NOT NULL en la tabla y quien llama los comprueba antes, porque es ahí donde
 * se sabe qué decirle a quien subió el fichero.
 */
export function aFilaInsert(f: FilaTacografo, c: ContextoInsert): FilaInsert {
  return {
    empresa_id: c.empresa,
    vehiculo_id: c.vehiculoId,
    sistema_origen: c.sistemaOrigen,
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
    km_sospechoso: c.kmSospechoso,

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

    lote_id: c.loteId,
    creada_de_pdf: c.creadaDePdf ?? false,
    archivo_nombre: c.archivo,
    hoja_origen: c.hoja,
    fila_origen: f.fila,
    importado_por: c.usuarioId,
  };
}

export function preparar(filas: FilaTacografo[], op: OpcionesPreparar): Preparacion {
  const porMatricula = new Map<string, VehiculoRef>();
  for (const v of op.vehiculos) if (!porMatricula.has(v.matriculaNorm)) porMatricula.set(v.matriculaNorm, v);

  const kmRaro = marcarKmSospechoso(filas);

  const insertar: FilaInsert[] = [];
  const bloqueadas: FilaBloqueada[] = [];
  const saltadas: string[] = [];
  const completar: Preparacion["completar"] = [];
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
    const veh = porMatricula.get(f.matriculaNorm) ?? null;

    if (op.yaImportados.has(f.idOrigen)) {
      saltadas.push(f.idOrigen);
      // Las que creó un PDF no se saltan del todo: el Excel las completa.
      if (op.creadasDePdf?.has(f.idOrigen)) {
        completar.push({
          idOrigen: f.idOrigen,
          nueva: aFilaInsert(f, {
            empresa: op.empresa,
            sistemaOrigen: op.sistemaOrigen,
            vehiculoId: veh?.id ?? null,
            loteId: op.loteId,
            archivo: op.archivo,
            hoja: op.hoja,
            usuarioId: op.usuarioId,
            kmSospechoso: kmRaro.has(f.idOrigen),
          }),
        });
      }
      continue;
    }

    if (!veh) sinVehiculo += 1;

    insertar.push(aFilaInsert(f, {
      empresa: op.empresa,
      sistemaOrigen: op.sistemaOrigen,
      vehiculoId: veh?.id ?? null,
      loteId: op.loteId,
      archivo: op.archivo,
      hoja: op.hoja,
      usuarioId: op.usuarioId,
      kmSospechoso: kmRaro.has(f.idOrigen),
    }));
  }

  return { insertar, bloqueadas, saltadas, completar, sinVehiculo };
}
