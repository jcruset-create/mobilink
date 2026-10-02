/**
 * Importar trasteros desde CSV: subir → vista previa (dry-run) con errores y
 * avisos por fila → confirmar. Nada se escribe en los trasteros hasta
 * confirmar, y el servidor lo vuelve a comprobar en ese momento.
 *
 * Columnas reconocidas: Nº trastero, zona, tipo, largo, ancho, alto, m², m³,
 * precio (base), IVA, PVP, fianza. Separador «;», «,» o tabulador.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../services/api";
import type { Importacion, Zona } from "../types";
import { Aviso, Cabecera, EmptyRow, ErrorBox, SelectField, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

const ETIQUETA_ACCION = { create: "Nuevo", update: "Actualizar", skip: "Sin cambios", error: "Error" } as const;
/** Nombre para una persona de cada campo que puede cambiar una importación. */
const CAMPO: Record<string, string> = {
  name: "nombre",
  width_cm: "ancho",
  length_cm: "largo",
  height_cm: "alto",
  area_m2: "m²",
  volume_m3: "m³",
  monthly_price: "precio base",
  tax_rate: "IVA",
  monthly_price_gross: "PVP",
  deposit_amount: "fianza",
  zone_id: "zona",
  unit_type_id: "tipo",
};

const COLOR_ACCION = {
  create: "text-emerald-300",
  update: "text-sky-300",
  skip: "text-slate-400",
  error: "text-rose-300",
} as const;

export default function Importar() {
  const { centroId, centros } = useSelfStorage();
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [zonaDefecto, setZonaDefecto] = useState("");
  const [unidad, setUnidad] = useState("auto");
  const [iva, setIva] = useState("");
  const [imp, setImp] = useState<Importacion | null>(null);
  const [historial, setHistorial] = useState<Importacion[]>([]);
  const [soloProblemas, setSoloProblemas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const fichero = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    if (!centroId) return;
    try {
      const [z, h] = await Promise.all([api.zonas(centroId), api.importaciones(centroId)]);
      setZonas(z);
      setHistorial(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [centroId]);
  useEffect(() => {
    setImp(null);
    void cargar();
  }, [cargar]);

  const validar = async (f: File) => {
    if (!centroId) return;
    setTrabajando(true);
    setError(null);
    try {
      const contenido = await f.text();
      setImp(
        await api.validarImportacion(centroId, {
          fileName: f.name,
          content: contenido,
          defaultZoneId: zonaDefecto || null,
          measureUnit: unidad,
          defaultTaxRate: iva.trim() ? Number(iva.replace(",", ".")) : undefined,
        })
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido leer el fichero");
    } finally {
      setTrabajando(false);
      if (fichero.current) fichero.current.value = "";
    }
  };

  const aplicar = async () => {
    if (!imp) return;
    setTrabajando(true);
    setError(null);
    try {
      setImp(await api.aplicarImportacion(imp.id));
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido aplicar");
    } finally {
      setTrabajando(false);
    }
  };

  if (!centroId) return <Aviso tono="info">Elige o crea un centro.</Aviso>;
  const s = imp?.summary;
  const filas = (imp?.rows ?? []).filter((r) => !soloProblemas || r.action === "error" || r.warnings.length);

  return (
    <div className="space-y-4">
      <Cabecera titulo="Importar trasteros" descripcion={`Centro: ${centros.find((c) => c.id === centroId)?.name ?? ""}`} />
      <Aviso tono="info">
        El número de trastero + centro identifica cada trastero: si ya existe se actualiza (medidas y precio), si no cambia nada se salta, y nunca se
        duplica. El estado de los trasteros y los precios de los contratos no se tocan.
      </Aviso>
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-800 p-4 sm:grid-cols-4">
        <SelectField label="Zona para los nuevos (si el CSV no la trae)" value={zonaDefecto} onChange={setZonaDefecto}>
          <option value="">—</option>
          {zonas.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Unidad de largo/ancho/alto" value={unidad} onChange={setUnidad}>
          <option value="auto">Automática (&lt; 20 = metros)</option>
          <option value="m">Metros</option>
          <option value="cm">Centímetros</option>
        </SelectField>
        <TextField label="IVA si el CSV no lo trae (%)" value={iva} onChange={setIva} placeholder="por defecto del centro" />
        <div className="flex items-end">
          <input ref={fichero} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void validar(e.target.files[0])} />
          <button className={btnPrimary} disabled={trabajando} onClick={() => fichero.current?.click()}>
            {trabajando ? "Procesando…" : "Elegir CSV y validar"}
          </button>
        </div>
      </div>

      {imp && s && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 p-3 text-sm">
            <b>{imp.fileName}</b>
            <span className="text-emerald-300">{s.create} nuevos</span>
            <span className="text-sky-300">{s.update} a actualizar</span>
            <span className="text-slate-400">{s.skip} sin cambios</span>
            <span className="text-rose-300">{s.error} con error</span>
            <span className="text-amber-300">{s.warnings} con avisos</span>
            <span className="flex-1" />
            {imp.status === "applied" ? (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                Aplicada: {s.creados ?? 0} creados, {s.actualizados ?? 0} actualizados
              </span>
            ) : (
              <>
                <button className={btnSecondary} onClick={() => setImp(null)}>
                  Descartar
                </button>
                <button className={btnPrimary} disabled={trabajando || s.error > 0 || s.create + s.update === 0} onClick={() => void aplicar()}>
                  Confirmar importación
                </button>
              </>
            )}
          </div>
          {s.error > 0 && imp.status !== "applied" && <Aviso tono="mal">Corrige las filas con error y vuelve a validar el fichero: no se importa nada mientras haya errores.</Aviso>}
          {s.columnasIgnoradas && s.columnasIgnoradas.length > 0 && (
            <Aviso tono="aviso">Columnas que no se usan: {s.columnasIgnoradas.join(", ")}.</Aviso>
          )}
          <label className="flex items-center gap-2 text-[12px] text-slate-300">
            <input type="checkbox" checked={soloProblemas} onChange={(e) => setSoloProblemas(e.target.checked)} /> Sólo filas con errores o avisos
          </label>
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Fila</th>
                <th className={thCls}>Trastero</th>
                <th className={thCls}>Acción</th>
                <th className={thCls}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <EmptyRow cols={4} text="Nada que mostrar." />}
              {filas.map((r) => (
                <tr key={r.rowNumber} className="border-t border-slate-700 align-top">
                  <td className={tdCls}>{r.rowNumber}</td>
                  <td className={tdCls}>{r.unitCode || "—"}</td>
                  <td className={`${tdCls} font-bold ${COLOR_ACCION[r.action]}`}>{ETIQUETA_ACCION[r.action]}</td>
                  <td className={`${tdCls} text-[12px]`}>
                    {r.errors.map((e, i) => (
                      <div key={`e${i}`} className="text-rose-300">
                        {e}
                      </div>
                    ))}
                    {r.warnings.map((w, i) => (
                      <div key={`w${i}`} className="text-amber-300">
                        {w}
                      </div>
                    ))}
                    {r.action === "update" && r.parsed?.cambios && <div className="text-slate-400">Cambia: {r.parsed.cambios.map((k) => CAMPO[k] ?? k).join(", ")}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}

      {historial.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">Importaciones anteriores</h2>
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Fichero</th>
                <th className={thCls}>Fecha</th>
                <th className={thCls}>Estado</th>
                <th className={thCls}>Resumen</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id} className="border-t border-slate-700">
                  <td className={tdCls}>{h.fileName}</td>
                  <td className={tdCls}>{new Date(h.createdAt).toLocaleString("es-ES")}</td>
                  <td className={tdCls}>{h.status === "applied" ? "Aplicada" : "Sin aplicar"}</td>
                  <td className={`${tdCls} text-[12px]`}>
                    {h.summary.create} nuevos · {h.summary.update} act. · {h.summary.skip} iguales · {h.summary.error} errores
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <button className={btnMini} onClick={() => void api.importacion(h.id).then(setImp)}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      )}
    </div>
  );
}
