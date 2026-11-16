/**
 * Importa (o simula) un «Fleetcheck Report» de TIRETASK.
 *
 * El trabajo de verdad lo hace `importRevisiones`, el mismo motor del Excel y
 * del CheckPoint. Aquí se decide CÓMO se le pide, que para un informe de un
 * tercero es más estrecho que para lo nuestro:
 *
 *  - Solo se mide lo que ya está montado en TyreControl. El informe dice qué
 *    profundidad tiene la rueda de una posición; no es quién para crear
 *    neumáticos ni montajes. Lo que no tenga neumático se devuelve en una
 *    lista, sin importar.
 *  - Si el vehículo ya tiene una revisión ese día, no se toca.
 *  - Los kilómetros NO se cogen del informe (los trae uno de cada cinco, a
 *    mano): la revisión nace sin ellos y el relleno diario se los pide a la
 *    telemática, como a las del CheckPoint. El del informe se deja apuntado
 *    en la nota de la revisión, para poder compararlo.
 */
import { listarPosiciones, listarTiposVehiculo, listarVehiculos } from "./data";
import {
  TIPO_POR_FIRMA, filasDeFleetcheck, firmaDeEjes, medidaDeNeumatico, partesDeNeumatico,
  type LecturaFleetcheck, type VehiculoFleetcheck,
} from "./fleetcheck";
import { importRevisiones, type ReporteRev } from "./importRevisiones";
import { medidaCanonica } from "./medidas";
import { supabase } from "./supabase";

export interface ReporteFleetcheck {
  rev: ReporteRev;
  vehiculos: number;
  mediciones: number;
  /** Ruedas cuya medida en el informe no es la del neumático que tenemos montado. */
  medidasDistintas: string[];
  avisos: string[];
}

/** El servidor: el mismo origen en producción, el puerto del back en local. */
const API = import.meta.env.PROD ? "" : "http://localhost:4000";

export const ORIGEN_FLEETCHECK = "Importada del Fleetcheck Report de TIRETASK";

/** Manda el PDF al servidor, que es quien sabe abrirlo, y devuelve su lectura. */
export async function leerFleetcheckPdf(file: File): Promise<LecturaFleetcheck> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Sesión no válida");
  const cuerpo = new FormData();
  cuerpo.append("archivo", file);
  const r = await fetch(`${API}/api/tyrecontrol/fleetcheck/leer`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: cuerpo,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error || "No se ha podido leer el PDF");
  return j as LecturaFleetcheck;
}

/**
 * Qué ruedas del informe no llevan la medida que tenemos montada.
 *
 * No impide importar: la profundidad se guarda igual. Pero una medida distinta
 * quiere decir que el neumático de esa posición no es el que TyreControl cree,
 * y eso alguien tiene que mirarlo.
 */
async function compararMedidas(lectura: LecturaFleetcheck): Promise<string[]> {
  const vehs = await listarVehiculos();
  const porMatricula = new Map(vehs.map((v) => [String(v.matricula).trim().toUpperCase(), v.id]));
  const ids = lectura.vehiculos.map((v) => porMatricula.get(v.matricula)).filter(Boolean) as string[];
  if (!ids.length) return [];

  type Montaje = {
    vehiculo_id: string;
    posicion: { eje: number | null; lado: string | null; interior_exterior: string | null } | null;
    neumatico: { medida: string | null } | null;
  };
  const montados = new Map<string, string>(); // vehiculo|eje|lado|io -> medida
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("tc_montajes_actuales")
      .select("vehiculo_id, posicion:tc_posiciones_vehiculo(eje, lado, interior_exterior), neumatico:tc_neumaticos(medida)")
      .in("vehiculo_id", ids.slice(i, i + 100));
    if (error) throw new Error("Montajes: " + error.message);
    for (const m of (data ?? []) as unknown as Montaje[]) {
      if (!m.posicion || !m.neumatico?.medida) continue;
      montados.set(`${m.vehiculo_id}|${m.posicion.eje}|${m.posicion.lado}|${m.posicion.interior_exterior ?? ""}`, m.neumatico.medida);
    }
  }

  const distintas: string[] = [];
  for (const v of lectura.vehiculos) {
    const id = porMatricula.get(v.matricula);
    if (!id) continue;
    const dobles = new Set(v.ruedas.filter((r) => r.dentroFuera === "int").map((r) => r.eje));
    for (const r of v.ruedas) {
      const delInforme = medidaDeNeumatico(r.neumatico);
      const nuestra = montados.get(`${id}|${r.eje}|${r.lado}|${dobles.has(r.eje) ? r.dentroFuera : ""}`);
      if (!delInforme || !nuestra) continue;
      if (medidaCanonica(delInforme) !== medidaCanonica(nuestra)) {
        distintas.push(`${v.matricula} ${r.posicion}: el informe dice ${delInforme} y tenemos montado ${nuestra}`);
      }
    }
  }
  return distintas;
}

export async function importFleetcheck(
  lectura: LecturaFleetcheck, fecha: string, ejecutar: boolean,
): Promise<ReporteFleetcheck> {
  const filas = filasDeFleetcheck(lectura, fecha);
  const conPresion = filas.some((f) => f.presion_bar != null);
  const notaPorMatricula = new Map(
    lectura.vehiculos.filter((v) => v.km != null)
      .map((v) => [v.matricula, `Km apuntados en el informe: ${v.km!.toLocaleString("es-ES")}`]),
  );

  const rev = await importRevisiones(filas, ejecutar, {
    origen: "importacion_excel",
    soloMontados: true,
    respetarExistentes: true,
    tipoRevision: conPresion ? "profundidades_presiones" : "solo_profundidades",
    observaciones: ORIGEN_FLEETCHECK,
    notaPorMatricula,
  });

  // La comparación de medidas es informativa: si falla, la importación no.
  const medidasDistintas = await compararMedidas(lectura).catch(() => [] as string[]);

  return {
    rev,
    vehiculos: lectura.vehiculos.length,
    mediciones: filas.length,
    medidasDistintas,
    avisos: [...lectura.avisos, ...rev.avisos],
  };
}

// ── Alta de los vehículos que no tienen plano ───────────────────────────────

/**
 * Un vehículo del informe que está en TyreControl sin plano ni neumáticos, y
 * lo que se haría con él.
 *
 * Es la excepción a «no se crea ningún neumático»: aquí sí se crean, porque
 * sin ellos no hay dónde apuntar la medición. Por eso no va dentro de la
 * importación sino aparte, y solo si quien importa lo marca.
 */
export interface AltaPropuesta {
  matricula: string;
  vehiculoId: string;
  empresaId: string;
  /** Reparto de ruedas por eje según el informe: «2x4x2». */
  firma: string;
  tipoId: string | null;
  tipoNombre: string | null;
  ruedas: number;
  /** Si no se puede dar de alta, por qué. */
  motivo: string | null;
}

export interface ResultadoAltas {
  hechas: string[];
  fallos: { matricula: string; error: string }[];
  avisos: string[];
}

const NOTA_INVENTARIO = "Inventario inicial del vehículo";

/**
 * Qué vehículos del informe se pueden dar de alta con sus datos.
 *
 * Entran los que no tienen tipo, y también los que se quedaron a medias en un
 * intento anterior (ya tienen el tipo que les toca y un inventario en
 * borrador): repetir tiene que poder terminar lo empezado.
 */
export async function altasPosibles(lectura: LecturaFleetcheck): Promise<AltaPropuesta[]> {
  const vehs = await listarVehiculos();
  const porMatricula = new Map(vehs.map((v) => [String(v.matricula).trim().toUpperCase(), v]));
  const tipos = await listarTiposVehiculo();
  const tipoPorNombre = new Map(tipos.map((t) => [String(t.nombre), t]));

  const candidatos = lectura.vehiculos
    .map((lv) => ({ lv, v: porMatricula.get(lv.matricula) }))
    .filter((x) => x.v && x.lv.ruedas.length > 0) as { lv: VehiculoFleetcheck; v: (typeof vehs)[number] }[];
  if (!candidatos.length) return [];

  const ids = candidatos.map((x) => x.v.id);
  const montados = new Map<string, number>();
  const enBorrador = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const trozo = ids.slice(i, i + 100);
    const m = await supabase.from("tc_montajes_actuales").select("vehiculo_id").in("vehiculo_id", trozo);
    if (m.error) throw new Error("Montajes: " + m.error.message);
    for (const f of (m.data ?? []) as { vehiculo_id: string }[]) montados.set(f.vehiculo_id, (montados.get(f.vehiculo_id) ?? 0) + 1);
    const b = await supabase.from("revisiones_vehiculo").select("vehiculo_id")
      .in("vehiculo_id", trozo).eq("estado_revision", "borrador").eq("observaciones", NOTA_INVENTARIO);
    if (b.error) throw new Error("Revisiones: " + b.error.message);
    for (const f of (b.data ?? []) as { vehiculo_id: string }[]) enBorrador.add(f.vehiculo_id);
  }

  // Las medidas que admite cada tipo. Es la misma regla con la que la base
  // rechaza un montaje (`tc_medida_compatible`): mejor decirlo en la vista
  // previa que encontrárselo a mitad del alta. Un tipo sin lista las admite
  // todas. Si la consulta falla no se comprueba aquí, y decide la base.
  const admitidas = new Map<string, Set<string>>();
  {
    const { data } = await supabase.from("tc_medidas_tipo_vehiculo")
      .select("tipo_vehiculo_id, medida:tc_cat_medidas_neumatico(valor)");
    for (const f of (data ?? []) as unknown as { tipo_vehiculo_id: string; medida: { valor: string } | null }[]) {
      if (!f.medida?.valor) continue;
      const lista = admitidas.get(f.tipo_vehiculo_id) ?? new Set<string>();
      lista.add(medidaCanonica(f.medida.valor));
      admitidas.set(f.tipo_vehiculo_id, lista);
    }
  }

  const propuestas: AltaPropuesta[] = [];
  const posicionesDeTipo = new Map<string, number>();
  for (const { lv, v } of candidatos) {
    const firma = firmaDeEjes(lv.ruedas);
    const tipo = tipoPorNombre.get(TIPO_POR_FIRMA[firma] ?? "") ?? null;
    const sinTipo = !v.tipo_vehiculo_id;
    const aMedias = !sinTipo && tipo != null && v.tipo_vehiculo_id === tipo.id
      && enBorrador.has(v.id) && (montados.get(v.id) ?? 0) < lv.ruedas.length;
    if (!sinTipo && !aMedias) continue;

    let motivo: string | null = null;
    if (sinTipo && (montados.get(v.id) ?? 0) > 0) {
      motivo = "No tiene tipo pero sí neumáticos montados: hay que mirarlo a mano.";
    } else if (!tipo) {
      motivo = `No hay un tipo claro para un reparto ${firma}: se le pone a mano.`;
    } else {
      if (!posicionesDeTipo.has(tipo.id)) posicionesDeTipo.set(tipo.id, (await listarPosiciones(tipo.id)).length);
      if (posicionesDeTipo.get(tipo.id) !== lv.ruedas.length) {
        motivo = `El tipo «${tipo.nombre}» tiene ${posicionesDeTipo.get(tipo.id)} posiciones y el informe trae ${lv.ruedas.length} ruedas.`;
      }
    }
    if (!motivo && tipo && admitidas.has(tipo.id)) {
      const fuera = lv.ruedas.map((r) => medidaDeNeumatico(r.neumatico))
        .find((m) => m && !admitidas.get(tipo.id)!.has(medidaCanonica(m)));
      if (fuera) {
        motivo = `La medida ${fuera} no está admitida en el tipo «${tipo.nombre}»: es otra clase de vehículo y hay que ponerle el tipo a mano.`;
      }
    }
    if (!motivo) {
      const mala = lv.ruedas.find((r) => {
        const p = partesDeNeumatico(r.neumatico);
        return !p || !p.modelo || !p.carga || r.perfiles.length === 0;
      });
      if (mala) {
        motivo = `La rueda ${mala.posicion} no trae lo necesario para darla de alta (modelo, índice de carga y profundidad): «${mala.neumatico}».`;
      }
    }
    propuestas.push({
      matricula: lv.matricula, vehiculoId: v.id, empresaId: v.empresa_id, firma,
      tipoId: tipo?.id ?? null, tipoNombre: tipo?.nombre ?? null, ruedas: lv.ruedas.length, motivo,
    });
  }
  return propuestas;
}

async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/**
 * Da de alta los vehículos propuestos, con las funciones de siempre: las
 * mismas que usa la tablet cuando un técnico hace el inventario inicial.
 *
 *   1. `tc_alta_operativa_tipo`: le pone el tipo (y con él, el plano).
 *   2. `tc_crear_referencia_provisional`: busca cada neumático en el catálogo
 *      y, si no está, lo deja creado «pendiente de validar».
 *   3. `tc_inventario_inicial_posicion`: apunta el neumático que ya estaba en
 *      cada posición, como carga inicial y sin descontar stock, con su
 *      profundidad (la menor de las lecturas) y su presión.
 *   4. `tc_inventario_inicial_finalizar`: cierra la revisión inicial.
 *
 * Un vehículo que falla no detiene a los demás: se apunta y se sigue. Y
 * repetir es seguro: cada paso contesta lo mismo si ya estaba hecho.
 */
export async function darDeAlta(
  lectura: LecturaFleetcheck, fecha: string, propuestas: AltaPropuesta[],
  alAvanzar?: (hechos: number, total: number) => void,
): Promise<ResultadoAltas> {
  const validas = propuestas.filter((p) => !p.motivo && p.tipoId);
  const resultado: ResultadoAltas = { hechas: [], fallos: [], avisos: [] };
  const referencias = new Map<string, string>(); // empresa|texto del neumático -> referencia
  const posiciones = new Map<string, Awaited<ReturnType<typeof listarPosiciones>>>();
  let hechos = 0;

  for (const p of validas) {
    try {
      const lv = lectura.vehiculos.find((v) => v.matricula === p.matricula);
      if (!lv) throw new Error("No está en el informe");
      await rpc("tc_alta_operativa_tipo", { p_vehiculo: p.vehiculoId, p_tipo: p.tipoId });

      if (!posiciones.has(p.tipoId!)) posiciones.set(p.tipoId!, await listarPosiciones(p.tipoId!));
      const ps = posiciones.get(p.tipoId!)!;
      const dobles = new Set(lv.ruedas.filter((r) => r.dentroFuera === "int").map((r) => r.eje));

      for (const r of lv.ruedas) {
        const io = dobles.has(r.eje) ? r.dentroFuera : null;
        const pos = ps.find((x) => x.eje === r.eje && String(x.lado ?? "") === r.lado && (x.interior_exterior ?? null) === io);
        if (!pos) throw new Error(`El plano no tiene la posición ${r.posicion}`);

        const partes = partesDeNeumatico(r.neumatico)!;
        const clave = `${p.empresaId}|${r.neumatico}`;
        if (!referencias.has(clave)) {
          const ref = await rpc<{ referencia_id: string; creado?: { referencia?: boolean } }>("tc_crear_referencia_provisional", {
            p_empresa: p.empresaId, p_marca: partes.marca, p_modelo: partes.modelo, p_medida: partes.medida,
            p_carga_simple: partes.carga, p_carga_doble: partes.cargaDoble, p_velocidad: partes.velocidad,
          });
          referencias.set(clave, ref.referencia_id);
          if (ref.creado?.referencia) {
            resultado.avisos.push(`«${r.neumatico}» no estaba en el catálogo: se ha creado pendiente de validar.`);
          }
        }
        const lecturas = r.perfiles.length > 1
          ? `Lecturas: ${r.perfiles.map((x) => x.toFixed(1).replace(".", ",")).join(" / ")} mm. ` : "";
        await rpc("tc_inventario_inicial_posicion", {
          p_vehiculo: p.vehiculoId, p_posicion: pos.id, p_referencia: referencias.get(clave),
          p_datos: {
            profundidad_mm: String(Math.min(...r.perfiles)),
            presion_bar: (r.presionDespues ?? r.presionAntes) == null ? "" : String(r.presionDespues ?? r.presionAntes),
            observaciones: `${lecturas}${ORIGEN_FLEETCHECK}`,
          },
        });
      }

      // Sin kilómetros: los pone el relleno diario desde la telemática.
      const fin = await rpc<{ revision_id: string; ya_estaba: boolean }>("tc_inventario_inicial_finalizar", {
        p_vehiculo: p.vehiculoId, p_km: null, p_origen_km: null,
      });
      // La revisión inicial nace con la fecha de hoy; las mediciones son del
      // día del informe.
      const { error } = await supabase.from("revisiones_vehiculo")
        .update({ fecha_revision: fecha }).eq("id", fin.revision_id);
      if (error) resultado.avisos.push(`${p.matricula}: dado de alta, pero su revisión se ha quedado con la fecha de hoy (${error.message}).`);
      resultado.hechas.push(p.matricula);
    } catch (e) {
      resultado.fallos.push({ matricula: p.matricula, error: e instanceof Error ? e.message : String(e) });
    }
    hechos += 1;
    alAvanzar?.(hechos, validas.length);
  }
  resultado.avisos = [...new Set(resultado.avisos)];
  return resultado;
}
