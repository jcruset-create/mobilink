import { useEffect, useRef, useState } from "react";
import {
  subirFichaTecnicaNueva, procesarOcrDocumento, listarCatalogoCamposFicha,
  type ResultadoFichaTecnica, type CampoFicha, type EjeFicha, type CampoCatalogoFicha,
} from "../services/data";
import type { TipoVehiculo, ConfigEjes, VehiculoInput } from "../types";
import { COLUMNAS_TEXTO, COLUMNAS_ENTERO, COLUMNAS_NUMERICO, COLUMNAS_FECHA, numeroDe, fechaIso } from "../services/fichaTecnicaCampos";
import { Modal, inputCls } from "./ui";

export interface PendienteFicha {
  docId: string;
  ejes: EjeFicha[];
  configuracion: string | null;
  atributos: CampoFicha[];
}

/** Sugiere un tipo de vehículo por lo que diga el documento (categoría/carrocería)
 *  y, si hay varios candidatos, por el número de ejes leído. Siempre editable. */
function sugerirTipo(resultado: ResultadoFichaTecnica, tipos: TipoVehiculo[]): string | null {
  const texto = resultado.campos.map((c) => `${c.clave ?? ""} ${c.valor ?? ""}`).join(" ").toLowerCase();
  const numEjes = resultado.ejes.length;
  const candidatos = tipos.filter((t) => {
    if (/semirremolque/.test(texto)) return t.nombre === "semirremolque";
    if (/tractora/.test(texto)) return t.nombre.includes("tractora");
    if (/\bremolque\b/.test(texto)) return t.nombre === "remolque";
    if (/autocar/.test(texto)) return t.nombre === "autocar";
    if (/aut[oó]bus|\bbus\b/.test(texto)) return t.nombre === "autobus";
    if (/furgoneta/.test(texto)) return t.nombre === "furgoneta";
    if (/turismo|autom[oó]vil/.test(texto)) return t.nombre === "turismo";
    if (/cami[oó]n/.test(texto)) return t.nombre.startsWith("camion");
    return false;
  });
  if (!candidatos.length) return null;
  if (candidatos.length === 1) return candidatos[0].id;
  const porEjes = numEjes > 0 ? candidatos.find((t) => t.numero_ejes === numEjes) : undefined;
  return (porEjes ?? candidatos[0]).id;
}

export default function CrearVehiculoDesdeFicha({ empresaId, tipos, configEjes, matriculasExistentes, onClose, onListo }: {
  empresaId: string;
  tipos: TipoVehiculo[];
  configEjes: ConfigEjes[];
  matriculasExistentes: Set<string>;
  onClose: () => void;
  onListo: (draft: Partial<VehiculoInput>, pendiente: PendienteFicha) => void;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [docId, setDocId] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoFichaTecnica | null>(null);
  const [catalogo, setCatalogo] = useState<Map<string, CampoCatalogoFicha>>(new Map());
  const [tipoVehiculoId, setTipoVehiculoId] = useState<string | null>(null);
  const [editados, setEditados] = useState<Record<string, string>>({});
  const [incluidos, setIncluidos] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listarCatalogoCamposFicha().then((filas) => setCatalogo(new Map(filas.map((f) => [f.clave, f])))).catch(() => {});
  }, []);

  async function onArchivos(files: FileList | null) {
    if (!files?.length) return;
    setSubiendo(true); setError(""); setMsg("Subiendo documento…");
    try {
      const r = await subirFichaTecnicaNueva(empresaId, Array.from(files));
      setDocId(r.documento.id);
      setMsg("Interpretando campos…");
      const datos = await procesarOcrDocumento(r.documento.id);
      setResultado(datos);
      setTipoVehiculoId(sugerirTipo(datos, tipos));
      setEditados({}); setIncluidos({});
      setMsg("");
    } catch (e: any) { setError(e?.message ?? "Error procesando la ficha"); setMsg(""); }
    finally { setSubiendo(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  const valor = (c: CampoFicha, i: number) => editados[`${c.clave ?? "x"}-${i}`] ?? c.valor;
  const incluido = (c: CampoFicha, i: number) => incluidos[`${c.clave ?? "x"}-${i}`] ?? true;

  const campo = (clave: string) => resultado?.campos.find((c) => c.clave === clave);
  const matricula = (valor(campo("matricula") ?? { valor: "" } as CampoFicha, resultado?.campos.indexOf(campo("matricula")!) ?? -1) || "").trim().toUpperCase();
  const yaExiste = matricula.length > 0 && matriculasExistentes.has(matricula);

  const tipoElegido = tipos.find((t) => t.id === tipoVehiculoId);

  function usar() {
    if (!resultado || !docId) return;
    if (!matricula) { setError("El documento no trae matrícula: escríbela abajo antes de continuar."); return; }

    const draft: Partial<VehiculoInput> = { matricula, tipo_vehiculo_id: tipoVehiculoId ?? null };
    const atributos: CampoFicha[] = [];
    resultado.campos.forEach((c, i) => {
      const v = valor(c, i);
      if (!incluido(c, i) || !v?.trim() || c.clave === "matricula") return;
      const clave = c.clave ?? "";
      if (COLUMNAS_TEXTO[clave]) (draft as any)[COLUMNAS_TEXTO[clave]] = v;
      else if (COLUMNAS_ENTERO[clave]) { const n = numeroDe(v); if (n != null) (draft as any)[COLUMNAS_ENTERO[clave]] = Math.round(n); else atributos.push({ ...c, valor: v }); }
      else if (COLUMNAS_NUMERICO[clave]) { const n = numeroDe(v); if (n != null) (draft as any)[COLUMNAS_NUMERICO[clave]] = n; else atributos.push({ ...c, valor: v }); }
      else if (COLUMNAS_FECHA[clave]) { const iso = fechaIso(v); if (iso) (draft as any)[COLUMNAS_FECHA[clave]] = iso; else atributos.push({ ...c, valor: v }); }
      else atributos.push({ ...c, valor: v }); // fuera del catálogo: no se pierde, queda como dato técnico
    });

    // La config de ejes se resuelve por nombre en el catálogo ya cargado (si
    // aún no existe, /aplicar la crea al vincular el documento tras guardar).
    if (resultado.configuracion) {
      const cfg = configEjes.find((c) => c.nombre === resultado.configuracion);
      if (cfg) draft.config_ejes_id = cfg.id;
    }

    onListo(draft, { docId, ejes: resultado.ejes, configuracion: resultado.configuracion, atributos });
  }

  return (
    <Modal title="Crear vehículo desde ficha técnica" size="xl" onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
          {resultado && (
            <button onClick={usar} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
              Usar estos datos
            </button>
          )}
        </>
      }>
      {!resultado ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
            onChange={(e) => void onArchivos(e.target.files)} />
          <p className="max-w-md text-center text-[13px] text-slate-400">
            Adjunta el PDF o fotografía las páginas de la ficha técnica: se leen los datos y se usan para
            rellenar el alta del vehículo. Podrás revisar y editar todo antes de guardar.
          </p>
          <button onClick={() => inputRef.current?.click()} disabled={subiendo}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {subiendo ? "Procesando…" : "📎 Adjuntar / escanear ficha"}
          </button>
          {msg && <div className="text-[12px] text-sky-300">{msg}</div>}
          {error && <div className="text-[12px] text-rose-300">{error}</div>}
        </div>
      ) : (
        <>
          {error && <div className="mb-2 text-[12px] text-rose-300">{error}</div>}
          {resultado.avisos.map((a) => (
            <div key={a} className="mb-2 text-[12px] font-semibold text-amber-300">⚠ {a}</div>
          ))}

          <div className="mb-3 grid gap-2 rounded-lg bg-slate-900 p-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] text-slate-400">Matrícula detectada</div>
              <div className={`text-[16px] font-black ${yaExiste ? "text-rose-300" : "text-slate-100"}`}>{matricula || "—"}</div>
              {yaExiste && <div className="text-[11px] text-rose-300">Ya existe un vehículo con esta matrícula.</div>}
            </div>
            <div>
              <div className="mb-1 text-[10px] text-slate-400">Tipo de vehículo (sugerido, edítalo si no es correcto)</div>
              <select className={inputCls} value={tipoVehiculoId ?? ""} onChange={(e) => setTipoVehiculoId(e.target.value || null)}>
                <option value="">—</option>
                {tipos.map((t) => <option key={t.id} value={t.id}>{t.descripcion ?? t.nombre}</option>)}
              </select>
              {!tipoElegido && (
                <div className="mt-1 text-[11px] text-amber-300">
                  Elige el tipo: de él depende el plano y las posiciones de neumáticos del vehículo.
                </div>
              )}
            </div>
          </div>

          <div className="mb-3 rounded-lg bg-slate-900 p-3">
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Configuración de ejes</div>
            {resultado.configuracion ? (
              <>
                <div className="text-[14px] font-bold text-emerald-300">
                  TyreControl: {resultado.configuracion}
                  {!resultado.configuracionExisteEnCatalogo && (
                    <span className="ml-2 text-[11px] font-normal text-amber-300">(se creará en el catálogo)</span>
                  )}
                </div>
                <div className="text-[12px] text-slate-400">
                  Convencional del fabricante: {resultado.configuracionConvencional ?? "No informada"}
                </div>
              </>
            ) : (
              <div className="text-[13px] text-amber-300">
                Configuración pendiente de validar. {resultado.configuracionPendiente}
              </div>
            )}
            {resultado.ejes.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {resultado.ejes.map((e: EjeFicha) => (
                  <div key={e.posicion} className="text-[12px] text-slate-300">
                    Eje {e.posicion}: {e.ruedas} neumáticos
                    {e.directriz ? " · directriz" : ""}{e.motriz ? " · motriz" : ""}{e.elevable ? " · elevable" : ""}
                    {e.medida ? ` · ${e.medida}` : ""}{e.indice_carga ? ` ${e.indice_carga}${e.codigo_velocidad ?? ""}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-2 text-[12px] text-slate-400">
            {resultado.campos.length} campo(s) detectado(s)
            {resultado.confianza != null ? ` · confianza ${Math.round(resultado.confianza * 100)}%` : ""}
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-[12px]" style={{ tableLayout: "fixed" }}>
              <thead className="sticky top-0 bg-slate-800">
                <tr className="text-left text-slate-400">
                  <th className="w-1/12 py-1">Código</th>
                  <th className="w-1/4 py-1">Campo</th>
                  <th className="w-1/3 py-1">Valor</th>
                  <th className="w-1/6 py-1">Confianza</th>
                  <th className="w-1/12 py-1">Incluir</th>
                </tr>
              </thead>
              <tbody>
                {resultado.campos.map((c, i) => {
                  const id = `${c.clave ?? "x"}-${i}`;
                  const cat = c.clave ? catalogo.get(c.clave) : undefined;
                  return (
                    <tr key={id} className="border-t border-slate-700/60 align-top">
                      <td className="py-1 pr-2 text-slate-500">{cat?.codigo ?? c.codigo_origen ?? "—"}</td>
                      <td className="py-1 pr-2 text-slate-200">{cat?.descripcion ?? c.etiqueta_origen ?? c.clave ?? "—"}</td>
                      <td className="py-1 pr-2">
                        <input className={`${inputCls} text-[12px]`} value={valor(c, i)}
                          onChange={(e) => setEditados((p) => ({ ...p, [id]: e.target.value }))} />
                      </td>
                      <td className="py-1 pr-2 text-slate-400">
                        {c.confianza != null ? `${Math.round(c.confianza * 100)}%` : "—"}
                      </td>
                      <td className="py-1">
                        <input type="checkbox" checked={incluido(c, i)}
                          onChange={(e) => setIncluidos((p) => ({ ...p, [id]: e.target.checked }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {resultado.observaciones && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Observaciones del documento</div>
              <div className="max-h-24 overflow-y-auto rounded bg-slate-900 p-2 text-[12px] text-slate-300">
                {resultado.observaciones}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
