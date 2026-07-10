import {
  listarEmpresas, crearEmpresa, listarDelegaciones, crearDelegacion,
  listarTiposVehiculo, listarConfigEjes, crearConfigEjes,
  listarMedidas, crearMedida, listarTiposLlanta, listarVehiculos,
  crearVehiculo, actualizarVehiculo,
} from "./data";
import { EMPRESA_VACIA, delegacionVacia } from "../components/forms";
import { tipoLlantaLabel } from "../types";
import type { VehiculoInput } from "../types";

export interface FilaReporte {
  fila: number;
  matricula: string;
  accion: "crear" | "actualizar" | "error";
  avisos: string[];
  error?: string;
}

export interface ReporteImport {
  filas: FilaReporte[];
  resumen: { total: number; crear: number; actualizar: number; errores: number };
  empresa: string;
  empresaNueva: boolean;
  delegacionesNuevas: string[];
  medidasNuevas: string[];
  configsNuevas: string[];
}

const normN = (s: any) => String(s ?? "").trim().toLowerCase();               // nombres
const normM = (s: any) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, ""); // medidas
const normL = (s: any) => String(s ?? "").trim().toLowerCase().replace(/[\s·.]+/g, ""); // llantas

function fechaStr(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim() || null;
}

// Importa (o simula, si ejecutar=false) la hoja de vehículos.
export async function importVehiculos(rows: any[], ejecutar: boolean): Promise<ReporteImport> {
  const clientes = [...new Set(rows.map((r) => String(r.cliente ?? "").trim()).filter(Boolean))];
  if (clientes.length === 0) throw new Error("La columna 'cliente' está vacía en todas las filas.");
  if (clientes.length > 1) throw new Error(`El archivo tiene varios clientes (${clientes.join(", ")}). Importa un cliente por archivo.`);
  const clienteNombre = clientes[0];

  // Empresa (crear si no existe)
  const empresas = await listarEmpresas();
  let empresa = empresas.find((e) => normN(e.nombre) === normN(clienteNombre)) ?? null;
  let empresaNueva = false;
  if (!empresa) {
    empresaNueva = true;
    if (ejecutar) empresa = await crearEmpresa({ ...EMPRESA_VACIA, nombre: clienteNombre });
  }
  const empresaId = empresa?.id ?? null;

  // Catálogos
  const tipos = await listarTiposVehiculo();
  let configs = await listarConfigEjes();
  let medidas = await listarMedidas();
  const llantas = await listarTiposLlanta();
  let delegaciones = empresaId ? await listarDelegaciones(empresaId) : [];
  let existentes = empresaId ? await listarVehiculos({ empresaId }) : [];

  // Catálogos que faltan (a crear)
  const basesFile = [...new Set(rows.map((r) => String(r.base ?? "").trim()).filter(Boolean))];
  const configsFile = [...new Set(rows.map((r) => String(r.configuracion_ejes ?? "").trim()).filter(Boolean))];
  const medidasFile = [...new Set(rows.map((r) => String(r.medida ?? "").trim()).filter(Boolean))];

  const delegacionesNuevas = basesFile.filter((b) => !delegaciones.some((d) => normN(d.nombre) === normN(b)));
  const configsNuevas = configsFile.filter((c) => !configs.some((x) => normN(x.nombre) === normN(c)));
  const medidasNuevas = medidasFile.filter((m) => !medidas.some((x) => normM(x.valor) === normM(m)));

  if (ejecutar && empresaId) {
    for (const b of delegacionesNuevas) await crearDelegacion({ ...delegacionVacia(empresaId), nombre: b });
    for (const c of configsNuevas) await crearConfigEjes(c);
    for (const m of medidasNuevas) await crearMedida(m);
    delegaciones = await listarDelegaciones(empresaId);
    configs = await listarConfigEjes();
    medidas = await listarMedidas();
    existentes = await listarVehiculos({ empresaId });
  }

  const mapDeleg = new Map(delegaciones.map((d) => [normN(d.nombre), d.id]));
  const mapTipo = new Map(tipos.map((t) => [normN(t.nombre), t.id]));
  const mapConfig = new Map(configs.map((c) => [normN(c.nombre), c.id]));
  const mapMedida = new Map(medidas.map((m) => [normM(m.valor), m.id]));
  const mapLlanta = new Map(llantas.map((l) => [normL(tipoLlantaLabel(l)), l.id]));
  const mapVeh = new Map(existentes.map((v) => [String(v.matricula).trim().toUpperCase(), v.id]));

  const filas: FilaReporte[] = [];
  let crear = 0, actualizar = 0, errores = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const matricula = String(r.matricula ?? "").trim().toUpperCase();
    const avisos: string[] = [];
    if (!matricula) { filas.push({ fila: i + 2, matricula: "", accion: "error", avisos: [], error: "Falta matrícula" }); errores++; continue; }

    const delegacion_id = r.base ? (mapDeleg.get(normN(r.base)) ?? null) : null;
    const tipo_vehiculo_id = r.tipo_vehiculo ? (mapTipo.get(normN(r.tipo_vehiculo)) ?? null) : null;
    if (r.tipo_vehiculo && !tipo_vehiculo_id) avisos.push(`Tipo '${r.tipo_vehiculo}' no encontrado (se deja sin tipo)`);
    const config_ejes_id = r.configuracion_ejes ? (mapConfig.get(normN(r.configuracion_ejes)) ?? null) : null;
    const medida_id = r.medida ? (mapMedida.get(normM(r.medida)) ?? null) : null;
    let tipo_llanta_id: string | null = null;
    if (r.tipo_llanta && String(r.tipo_llanta).trim() !== "0") {
      tipo_llanta_id = mapLlanta.get(normL(r.tipo_llanta)) ?? null;
      if (!tipo_llanta_id) avisos.push("Tipo de llanta no encontrado (se deja sin llanta)");
    }

    const existeId = mapVeh.get(matricula) ?? null;
    const accion: "crear" | "actualizar" = existeId ? "actualizar" : "crear";

    if (ejecutar && empresaId) {
      const nu = String(r.numero_unidad ?? "").trim();
      const input: VehiculoInput = {
        empresa_id: empresaId,
        delegacion_id,
        tipo_vehiculo_id,
        matricula,
        numero_unidad: nu && nu !== "0" ? nu : null,
        marca: r.marca_vehiculo ? String(r.marca_vehiculo).trim() : null,
        modelo: r.modelo_vehiculo ? String(r.modelo_vehiculo).trim() : null,
        bastidor: r.bastidor ? String(r.bastidor).trim() : null,
        fecha_matriculacion: fechaStr(r.fecha_matriculacion),
        webfleet_vehicle_id: r.webfleet_id ? String(r.webfleet_id).trim() : null,
        km_actual: String(r.km_actual ?? "").trim() ? Number(String(r.km_actual).replace(",", ".")) : 0,
        origen_km: "importacion_excel",
        activo: !/^no$/i.test(String(r.activo ?? "").trim()),
        config_ejes_id,
        medida_id,
        tipo_llanta_id,
        medidas_por_eje: false,
      };
      try {
        if (existeId) await actualizarVehiculo(existeId, input);
        else await crearVehiculo(input);
      } catch (e: any) {
        filas.push({ fila: i + 2, matricula, accion: "error", avisos, error: e?.message || "Error al guardar" });
        errores++;
        continue;
      }
    }

    if (accion === "crear") crear++; else actualizar++;
    filas.push({ fila: i + 2, matricula, accion, avisos });
  }

  return { filas, resumen: { total: rows.length, crear, actualizar, errores }, empresa: clienteNombre, empresaNueva, delegacionesNuevas, medidasNuevas, configsNuevas };
}
