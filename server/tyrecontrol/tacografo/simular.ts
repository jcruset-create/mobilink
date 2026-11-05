/**
 * Qué pasaría si se importara este fichero. Sin escribir nada.
 *
 * ── Para qué existe un paso que no hace nada ────────────────────────────────
 *
 * Porque los números hay que poder discutirlos ANTES de que existan. Un
 * informe que dice «1.744 filas, 1.705 vinculadas, 39 sin vehículo, 43
 * propuestas de medida y 19 discrepancias» se mira, se cuestiona y se corrige;
 * las mismas cifras después de grabar ya son un problema de limpieza.
 *
 * Esto es una función: entran las filas leídas, los vehículos de la empresa y
 * lo que ya está importado, y sale el informe. No habla con la base ni con la
 * red, así que se puede probar entera sin levantar nada.
 *
 * ── Las tres maneras de no entrar ───────────────────────────────────────────
 *
 *   · `duplicada`    · ese id ya está importado. Es lo que hace que volver a
 *                      pasar el mismo Excel no duplique nada, y lo que permite
 *                      pasar una exportación más larga el mes que viene y que
 *                      solo entre lo nuevo.
 *   · `sin_vehiculo` · la matrícula no casa con ningún vehículo de la empresa.
 *                      Entra igual, sin vincular: es historia del centro y el
 *                      vehículo puede darse de alta mañana. Lo que NO se hace
 *                      es crear vehículos por nuestra cuenta.
 *   · un problema del parser, que ya viene resuelto de antes.
 *
 * ── El bastidor ─────────────────────────────────────────────────────────────
 *
 * Cuando el informe trae bastidor y el vehículo también, tienen que coincidir.
 * Si no coinciden la fila se vincula igual —manda la matrícula, que es lo que
 * identifica al vehículo en TyreControl— pero se avisa, porque significa que
 * una de las dos fichas está mal y eso no se arregla solo.
 */

import { comparar, type Comparacion } from "./medidas.ts";
import type { FilaTacografo, Problema } from "./parser.ts";
import { calcular, type EstadoTacografo, type Regla } from "./vencimiento.ts";

/** Un vehículo de la empresa, reducido a lo que el cruce necesita. */
export interface VehiculoRef {
  id: string;
  matriculaNorm: string;
  matricula: string;
  bastidor: string | null;
  activo: boolean;
  medidaId: string | null;
  /** El valor del catálogo, ya canónico. */
  medida: string | null;
}

export type EstadoFila = "nueva" | "duplicada" | "sin_vehiculo";
export type CasoMedida = "sin_medida" | "solo_marcado" | "discrepa" | "sin_vehiculo";

export interface FilaSimulada {
  fila: number;
  idOrigen: string;
  fecha: string | null;
  matriculaNorm: string;
  matricula: string | null;
  estado: EstadoFila;
  vehiculoId: string | null;
  avisos: string[];
}

export interface PropuestaMedida {
  matriculaNorm: string;
  matricula: string | null;
  vehiculoId: string | null;
  caso: CasoMedida;
  /** Lo que dice el tacógrafo, normalizado, y tal cual venía. */
  medidaNorm: string;
  medidaOrigen: string | null;
  fecha: string | null;
  idOrigen: string;
  /** Lo que TyreControl tenía cuando se hizo la comparación. */
  medidaActual: string | null;
  medidaActualId: string | null;
  /**
   * Si se puede aceptar dentro de una confirmación múltiple.
   *
   * Solo lo son las coincidencias seguras: vehículo vinculado, sin ningún
   * aviso en sus filas y sin medida previa que pisar. Una discrepancia nunca
   * entra en un «aceptar todo»: para eso hace falta mirarla.
   */
  seguraParaBloque: boolean;
}

export interface KmSospechoso {
  matriculaNorm: string;
  matricula: string | null;
  fecha: string | null;
  idOrigen: string;
  km: number;
  kmAnterior: number;
  fechaAnterior: string | null;
}

export interface ConflictoBastidor {
  matriculaNorm: string;
  idOrigen: string;
  bastidorFichero: string;
  bastidorVehiculo: string;
}

export interface Simulacion {
  archivo: string | null;
  /** Lo que trae el fichero, antes de decidir nada. */
  filasLeidas: number;
  problemas: Problema[];

  nuevas: number;
  duplicadas: number;
  sinVehiculo: number;

  vehiculosEncontrados: number;
  vehiculosInactivos: number;
  matriculasSinVehiculo: string[];

  filas: FilaSimulada[];
  propuestas: PropuestaMedida[];
  propuestasPorCaso: Record<CasoMedida, number>;
  kmSospechosos: KmSospechoso[];
  conflictosBastidor: ConflictoBastidor[];

  /** Nombres de cliente del fichero, con su recuento. Se conservan tal cual. */
  clientes: Array<{ nombre: string; filas: number }>;
  vencimientos: Record<EstadoTacografo, number>;
  avisos: string[];
}

export interface Entrada {
  filas: FilaTacografo[];
  problemas: Problema[];
  vehiculos: VehiculoRef[];
  /** Los `id_origen` que ya están importados para esta empresa y origen. */
  yaImportados: Set<string>;
  regla: Regla;
  hoy: string;
  archivo?: string | null;
}

const vacio = (): Record<CasoMedida, number> =>
  ({ sin_medida: 0, solo_marcado: 0, discrepa: 0, sin_vehiculo: 0 });

/** El caso de una medida frente a lo que TyreControl tiene. */
export function casoDeMedida(
  medidaTacografo: string,
  medidaActual: string | null,
  vinculado: boolean,
): { caso: CasoMedida; comparacion: Comparacion } {
  if (!vinculado) return { caso: "sin_vehiculo", comparacion: "desconocida" };
  if (!medidaActual) return { caso: "sin_medida", comparacion: "desconocida" };
  const c = comparar(medidaTacografo, medidaActual);
  if (c === "igual") return { caso: "sin_medida", comparacion: c };   // no genera propuesta
  if (c === "solo_marcado") return { caso: "solo_marcado", comparacion: c };
  return { caso: "discrepa", comparacion: c };
}

export function simular(e: Entrada): Simulacion {
  const porMatricula = new Map<string, VehiculoRef>();
  for (const v of e.vehiculos) if (!porMatricula.has(v.matriculaNorm)) porMatricula.set(v.matriculaNorm, v);

  const filas: FilaSimulada[] = [];
  const conflictosBastidor: ConflictoBastidor[] = [];
  const clientes = new Map<string, number>();
  const sinVehiculo = new Set<string>();
  const vehiculosTocados = new Set<string>();
  const inactivos = new Set<string>();
  // Matrículas con algún aviso: su propuesta no entra en un «aceptar todo».
  const conAvisos = new Set<string>();

  for (const f of e.filas) {
    const veh = porMatricula.get(f.matriculaNorm) ?? null;
    const avisos: string[] = [];

    if (veh) {
      vehiculosTocados.add(veh.id);
      if (!veh.activo) inactivos.add(veh.id);
      if (f.bastidor && veh.bastidor && f.bastidor !== veh.bastidor.trim().toUpperCase()) {
        conflictosBastidor.push({
          matriculaNorm: f.matriculaNorm, idOrigen: f.idOrigen,
          bastidorFichero: f.bastidor, bastidorVehiculo: veh.bastidor,
        });
        avisos.push(`El bastidor del informe (${f.bastidor}) no es el del vehículo (${veh.bastidor})`);
      }
    } else {
      sinVehiculo.add(f.matriculaNorm);
    }

    if (f.medidaSospechosa) avisos.push(`Medida que no se sabe leer: «${f.medidaOrigen}»`);
    if (!f.fecha) avisos.push("Sin fecha");

    const estado: EstadoFila = e.yaImportados.has(f.idOrigen)
      ? "duplicada" : veh ? "nueva" : "sin_vehiculo";

    if (avisos.length > 0) conAvisos.add(f.matriculaNorm);

    const nombre = f.clienteNombre ?? "(sin cliente en el fichero)";
    clientes.set(nombre, (clientes.get(nombre) ?? 0) + 1);

    filas.push({
      fila: f.fila, idOrigen: f.idOrigen, fecha: f.fecha,
      matriculaNorm: f.matriculaNorm, matricula: veh?.matricula ?? f.matriculaOrigen,
      estado, vehiculoId: veh?.id ?? null, avisos,
    });
  }

  // ── Por vehículo: kilometraje, medida y vencimiento ──────────────────────
  const porVeh = new Map<string, FilaTacografo[]>();
  for (const f of e.filas) {
    if (!porVeh.has(f.matriculaNorm)) porVeh.set(f.matriculaNorm, []);
    porVeh.get(f.matriculaNorm)!.push(f);
  }

  const kmSospechosos: KmSospechoso[] = [];
  const propuestas: PropuestaMedida[] = [];
  const vencimientos: Record<EstadoTacografo, number> =
    { vigente: 0, proxima: 0, vencida: 0, sin_datos: 0 };

  for (const [matricula, lista] of porVeh) {
    const veh = porMatricula.get(matricula) ?? null;
    const cronologico = [...lista].sort((a, b) =>
      String(a.fecha ?? "").localeCompare(String(b.fecha ?? "")));

    // El kilometraje tiene que ir hacia arriba. Cuando baja no se descarta
    // —puede ser un cambio de cuentakilómetros, que es un dato— pero se marca.
    let anterior: FilaTacografo | null = null;
    for (const f of cronologico) {
      if (f.kmNuevo == null) continue;
      if (anterior?.kmNuevo != null && f.kmNuevo < anterior.kmNuevo) {
        kmSospechosos.push({
          matriculaNorm: matricula, matricula: veh?.matricula ?? f.matriculaOrigen,
          fecha: f.fecha, idOrigen: f.idOrigen, km: f.kmNuevo,
          kmAnterior: anterior.kmNuevo, fechaAnterior: anterior.fecha,
        });
      }
      anterior = f;
    }

    // La medida: la del registro válido MÁS RECIENTE, que es la que vale como
    // propuesta. Las anteriores quedan en el histórico de la ficha.
    const conMedida = cronologico.filter((f) => f.medidaNorm);
    const ultima = conMedida.length ? conMedida[conMedida.length - 1] : null;
    if (ultima?.medidaNorm) {
      const { caso } = casoDeMedida(ultima.medidaNorm, veh?.medida ?? null, Boolean(veh));
      const coincide = veh?.medida && comparar(ultima.medidaNorm, veh.medida) === "igual";
      if (!coincide) {
        propuestas.push({
          matriculaNorm: matricula,
          matricula: veh?.matricula ?? ultima.matriculaOrigen,
          vehiculoId: veh?.id ?? null,
          caso,
          medidaNorm: ultima.medidaNorm,
          medidaOrigen: ultima.medidaOrigen,
          fecha: ultima.fecha,
          idOrigen: ultima.idOrigen,
          medidaActual: veh?.medida ?? null,
          medidaActualId: veh?.medidaId ?? null,
          seguraParaBloque: caso === "sin_medida" && Boolean(veh) && !conAvisos.has(matricula),
        });
      }
    }

    vencimientos[calcular(
      lista.map((f) => ({ fecha: f.fecha, tipoOperacion: f.tipoOperacion, resultado: f.resultado })),
      e.regla, e.hoy).estado] += 1;
  }

  const propuestasPorCaso = vacio();
  for (const p of propuestas) propuestasPorCaso[p.caso] += 1;

  const avisos: string[] = [];
  if (sinVehiculo.size > 0) {
    avisos.push(`${sinVehiculo.size} matrícula(s) del informe no existen en TyreControl: sus `
      + `intervenciones se guardan sin vincular y se pueden enlazar después. No se crean vehículos.`);
  }
  if (inactivos.size > 0) {
    avisos.push(`${inactivos.size} vehículo(s) vinculados están dados de baja. Las intervenciones `
      + `entran igual: son historia.`);
  }
  if (conflictosBastidor.length > 0) {
    avisos.push(`${conflictosBastidor.length} intervención(es) traen un bastidor distinto al del `
      + `vehículo. Se vinculan por matrícula, pero conviene mirar cuál de las dos fichas está mal.`);
  }
  if (kmSospechosos.length > 0) {
    avisos.push(`${kmSospechosos.length} lectura(s) de cuentakilómetros bajan respecto a la `
      + `anterior. Se guardan marcadas; no tocan el kilómetro actual del vehículo.`);
  }
  if (clientes.size > 1) {
    avisos.push(`El fichero trae ${clientes.size} nombres de cliente distintos. Todas las `
      + `intervenciones se importan bajo la empresa elegida, conservando el nombre original de cada una.`);
  }
  const duplicadas = filas.filter((f) => f.estado === "duplicada").length;
  if (duplicadas === filas.length && filas.length > 0) {
    avisos.push("Todo lo que trae este fichero ya está importado: no hay nada nuevo que hacer.");
  }

  return {
    archivo: e.archivo ?? null,
    filasLeidas: e.filas.length,
    problemas: e.problemas,
    nuevas: filas.filter((f) => f.estado === "nueva").length,
    duplicadas,
    sinVehiculo: filas.filter((f) => f.estado === "sin_vehiculo").length,
    vehiculosEncontrados: vehiculosTocados.size,
    vehiculosInactivos: inactivos.size,
    matriculasSinVehiculo: [...sinVehiculo].sort(),
    filas,
    propuestas,
    propuestasPorCaso,
    kmSospechosos,
    conflictosBastidor,
    clientes: [...clientes].map(([nombre, f]) => ({ nombre, filas: f }))
      .sort((a, b) => b.filas - a.filas),
    vencimientos,
    avisos,
  };
}
