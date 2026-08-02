/**
 * Connect Pro — Back office de la asistencia: contactos, empresas, operativa,
 * vehículo y facturación. Mismos bloques y campos que el back office de
 * Mobilink Assist; cuando la asistencia está en un taller con Assist, los dos
 * editan LA MISMA ficha (no hay copia ni divergencia).
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Input, Select, Button, Badge, ErrorBanner } from "./ui";
import { fmtDateTime } from "../types";

export type BackofficeData = {
  solicitanteNombre?: string | null; solicitanteTelefono?: string | null;
  solicitanteWhatsapp?: string | null; solicitanteEmail?: string | null;
  conductorTelefono?: string | null;
  responsableNombre?: string | null; responsableTelefono?: string | null; responsableCargo?: string | null;
  autorizadorNombre?: string | null; autorizadorTelefono?: string | null; autorizadorCargo?: string | null;
  empresaSolicitanteNombre?: string | null; empresaSolicitanteTelefono?: string | null; empresaSolicitanteEmail?: string | null;
  empresaServicioNombre?: string | null; empresaServicioCif?: string | null; empresaServicioTelefono?: string | null;
  empresaFacturacionNombre?: string | null; empresaFacturacionCif?: string | null; empresaFacturacionEmail?: string | null;
  expedienteExterno?: string | null; referenciaCliente?: string | null; referenciaAutorizacion?: string | null;
  tiposAsistencia?: string[] | null; tipoVehiculo?: string | null;
  estadoVehiculo?: string | null; ubicacionIncidencia?: string | null;
  marca?: string | null; modelo?: string | null; color?: string | null; vin?: string | null;
  kilometraje?: number | string | null; medidaNeumatico?: string | null;
  ejeAfectado?: string | null; posicionRueda?: string | null;
  vehiculoCargado?: boolean | null; mercancia?: string | null; adr?: boolean | null;
  facturable?: boolean | null; pendienteAutorizacion?: boolean | null;
  garantia?: boolean | null; interna?: boolean | null;
  importeAcordado?: number | string | null; observacionesFacturacion?: string | null;
  updatedAtMs?: number | null;
};

const TABS = ["Contactos", "Empresas", "Operativa", "Vehículo", "Facturación"] as const;

const TIPOS_ASISTENCIA = [
  "Neumáticos", "Mecánica", "Batería", "Arranque", "Combustible",
  "Apertura vehículo", "Remolcado", "Accidente", "Rescate", "Otros",
];
const TIPOS_VEHICULO = [
  "Turismo", "Furgoneta", "Camión rígido", "Tractora", "Remolque",
  "Semirremolque", "Autobús", "Motocicleta", "Maquinaria", "Vehículo agrícola",
];
const ESTADOS_VEHICULO = ["Puede circular", "No puede circular", "Bloqueado", "Accidentado", "Volcado"];
const UBICACIONES = [
  "Autopista", "Autovía", "Carretera nacional", "Ciudad", "Polígono",
  "Taller", "Parking", "Puerto", "Centro logístico",
];
const EJES = ["Dirección", "Tracción", "Remolque"];
const POSICIONES = ["Interior", "Exterior"];

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 border-b border-slate-700 pb-1 text-[12px] font-bold uppercase tracking-wide text-cyan-300">
        {titulo}
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export default function BackOfficeTab({ assistanceId, canOperate }: {
  assistanceId: number; canOperate: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Contactos");
  const [d, setD] = useState<BackofficeData>({});
  const [origen, setOrigen] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Extracción por IA (mismo panel que en Assist)
  const [iaAbierto, setIaAbierto] = useState(false);
  const [iaTexto, setIaTexto] = useState("");
  const [iaImagenes, setIaImagenes] = useState<string[]>([]);
  const [iaBusy, setIaBusy] = useState(false);
  const [iaMsg, setIaMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    boFetch<{ data: BackofficeData | null; origen: string }>(`/assistances/${assistanceId}/backoffice`)
      .then((r) => { setD(r.data ?? {}); setOrigen(r.origen); setCargando(false); })
      .catch((e) => { setError(e.message); setCargando(false); });
  }, [assistanceId]);
  useEffect(load, [load]);

  const set = (k: keyof BackofficeData, v: unknown) => {
    setD((prev) => ({ ...prev, [k]: v as never }));
    setGuardado(false);
  };
  const txt = (k: keyof BackofficeData) => (d[k] == null ? "" : String(d[k]));
  const bool = (k: keyof BackofficeData) => d[k] === true;

  const guardar = async () => {
    setGuardando(true); setError(null);
    try {
      const r = await boFetch<{ data: BackofficeData | null }>(`/assistances/${assistanceId}/backoffice`, {
        method: "PUT", body: d,
      });
      if (r.data) setD(r.data);
      setGuardado(true);
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  };

  const alternarTipo = (tipo: string) => {
    const actuales = d.tiposAsistencia ?? [];
    set("tiposAsistencia", actuales.includes(tipo) ? actuales.filter((x) => x !== tipo) : [...actuales, tipo]);
  };

  const añadirImagenes = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files).slice(0, Math.max(0, 6 - iaImagenes.length))) {
      if (file.size > 6 * 1024 * 1024) { setIaMsg("Cada imagen debe ocupar menos de 6 MB."); continue; }
      const lector = new FileReader();
      lector.onload = () => setIaImagenes((prev) => [...prev, String(lector.result)]);
      lector.readAsDataURL(file);
    }
  };

  const analizar = async () => {
    if (!iaTexto.trim() && iaImagenes.length === 0) {
      setIaMsg("Pega el texto o añade una captura.");
      return;
    }
    setIaBusy(true); setIaMsg(null);
    try {
      const r = await boFetch<{ data: Record<string, any> }>(`/assistances/${assistanceId}/backoffice/ai-extract`, {
        method: "POST", body: { text: iaTexto.trim(), images: iaImagenes },
      });
      let aplicados = 0;
      const siguiente: BackofficeData = { ...d };
      for (const [k, v] of Object.entries(r.data ?? {})) {
        if (v == null || v === "") continue;
        if (!(k in siguiente) && k !== "tiposAsistencia") continue;
        // Lo que ya haya escrito el operador manda sobre la IA
        const actual = (siguiente as any)[k];
        if (Array.isArray(v)) {
          if (!actual || (actual as string[]).length === 0) { (siguiente as any)[k] = v; aplicados++; }
          continue;
        }
        if (actual == null || actual === "") { (siguiente as any)[k] = v; aplicados++; }
      }
      setD(siguiente);
      setGuardado(false);
      setIaMsg(aplicados > 0
        ? `La IA ha rellenado ${aplicados} campo${aplicados !== 1 ? "s" : ""}. Revísalos y guarda.`
        : "La IA no ha encontrado datos nuevos (o ya estaban rellenos).");
    } catch (e: any) { setIaMsg(e.message); } finally { setIaBusy(false); }
  };

  if (cargando) return <p className="text-sm text-slate-500">Cargando back office…</p>;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                tab === t ? "bg-cyan-600/20 text-cyan-300" : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {canOperate && (
          <div className="flex items-center gap-2">
            {d.updatedAtMs && (
              <span className="text-[11px] text-slate-500">Actualizado {fmtDateTime(d.updatedAtMs)}</span>
            )}
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando…" : guardado ? "Guardado ✓" : "Guardar"}
            </Button>
          </div>
        )}
      </div>

      {origen === "assist" && (
        <p className="mb-3 text-[12px] text-slate-500">
          <Badge className="mr-1 border-cyan-500/40 bg-cyan-500/10 text-cyan-300">Compartido</Badge>
          Esta ficha es la misma que ve el back office de Mobilink Assist en el taller.
        </p>
      )}

      {/* Extracción por IA */}
      {canOperate && (
        <Card className="mb-4 border-violet-500/30 p-3">
          {!iaAbierto ? (
            <Button variant="ghost" onClick={() => setIaAbierto(true)}>
              ✨ Rellenar con IA (pegar WhatsApp o subir captura)
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-violet-300">Extracción por IA</span>
                <button onClick={() => setIaAbierto(false)} className="text-slate-500 hover:text-slate-300">✕</button>
              </div>
              <textarea
                value={iaTexto}
                onChange={(e) => setIaTexto(e.target.value)}
                rows={3}
                placeholder="Pega la conversación, el correo del cliente o los datos de la aseguradora…"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              />
              {iaImagenes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {iaImagenes.map((src, i) => (
                    <div key={i} className="relative">
                      <img src={src} alt="captura" className="h-14 w-14 rounded-lg border border-slate-600 object-cover" />
                      <button
                        onClick={() => setIaImagenes((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -right-1 -top-1 rounded-full bg-slate-900 px-1 text-[11px] text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-lg border border-slate-600 px-3 py-2 text-[13px] text-slate-300 hover:bg-slate-700">
                  Añadir captura
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => añadirImagenes(e.target.files)} />
                </label>
                <Button onClick={analizar} disabled={iaBusy}>
                  {iaBusy ? "Analizando…" : "Analizar y rellenar"}
                </Button>
                {iaMsg && <span className="text-[12px] text-slate-400">{iaMsg}</span>}
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === "Contactos" && (
        <>
          <Bloque titulo="Solicitante">
            <Campo label="Nombre"><Input value={txt("solicitanteNombre")} onChange={(e) => set("solicitanteNombre", e.target.value)} /></Campo>
            <Campo label="Teléfono"><Input value={txt("solicitanteTelefono")} onChange={(e) => set("solicitanteTelefono", e.target.value)} placeholder="6XX XXX XXX" /></Campo>
            <Campo label="WhatsApp"><Input value={txt("solicitanteWhatsapp")} onChange={(e) => set("solicitanteWhatsapp", e.target.value)} placeholder="+34 6XX XXX XXX" /></Campo>
            <Campo label="Email"><Input value={txt("solicitanteEmail")} onChange={(e) => set("solicitanteEmail", e.target.value)} /></Campo>
          </Bloque>
          <Bloque titulo="Conductor">
            <Campo label="Teléfono del conductor"><Input value={txt("conductorTelefono")} onChange={(e) => set("conductorTelefono", e.target.value)} /></Campo>
          </Bloque>
          <Bloque titulo="Responsable">
            <Campo label="Nombre"><Input value={txt("responsableNombre")} onChange={(e) => set("responsableNombre", e.target.value)} /></Campo>
            <Campo label="Teléfono"><Input value={txt("responsableTelefono")} onChange={(e) => set("responsableTelefono", e.target.value)} /></Campo>
            <Campo label="Cargo"><Input value={txt("responsableCargo")} onChange={(e) => set("responsableCargo", e.target.value)} /></Campo>
          </Bloque>
          <Bloque titulo="Autorizador">
            <Campo label="Nombre"><Input value={txt("autorizadorNombre")} onChange={(e) => set("autorizadorNombre", e.target.value)} /></Campo>
            <Campo label="Teléfono"><Input value={txt("autorizadorTelefono")} onChange={(e) => set("autorizadorTelefono", e.target.value)} /></Campo>
            <Campo label="Cargo"><Input value={txt("autorizadorCargo")} onChange={(e) => set("autorizadorCargo", e.target.value)} /></Campo>
          </Bloque>
        </>
      )}

      {tab === "Empresas" && (
        <>
          <Bloque titulo="Empresa solicitante">
            <Campo label="Nombre"><Input value={txt("empresaSolicitanteNombre")} onChange={(e) => set("empresaSolicitanteNombre", e.target.value)} placeholder="Europ Assistance, RACE…" /></Campo>
            <Campo label="Teléfono"><Input value={txt("empresaSolicitanteTelefono")} onChange={(e) => set("empresaSolicitanteTelefono", e.target.value)} /></Campo>
            <Campo label="Email"><Input value={txt("empresaSolicitanteEmail")} onChange={(e) => set("empresaSolicitanteEmail", e.target.value)} /></Campo>
          </Bloque>
          <Bloque titulo="Empresa destinataria del servicio">
            <Campo label="Nombre"><Input value={txt("empresaServicioNombre")} onChange={(e) => set("empresaServicioNombre", e.target.value)} placeholder="Propietaria o receptora" /></Campo>
            <Campo label="CIF / NIF"><Input value={txt("empresaServicioCif")} onChange={(e) => set("empresaServicioCif", e.target.value)} placeholder="B12345678" /></Campo>
            <Campo label="Teléfono"><Input value={txt("empresaServicioTelefono")} onChange={(e) => set("empresaServicioTelefono", e.target.value)} /></Campo>
          </Bloque>
          <Bloque titulo="Empresa de facturación">
            <Campo label="Nombre"><Input value={txt("empresaFacturacionNombre")} onChange={(e) => set("empresaFacturacionNombre", e.target.value)} placeholder="A quién se emite la factura" /></Campo>
            <Campo label="CIF / NIF"><Input value={txt("empresaFacturacionCif")} onChange={(e) => set("empresaFacturacionCif", e.target.value)} /></Campo>
            <Campo label="Email"><Input value={txt("empresaFacturacionEmail")} onChange={(e) => set("empresaFacturacionEmail", e.target.value)} /></Campo>
          </Bloque>
          <Bloque titulo="Referencias externas">
            <Campo label="Nº expediente externo"><Input value={txt("expedienteExterno")} onChange={(e) => set("expedienteExterno", e.target.value)} placeholder="EA-458921…" /></Campo>
            <Campo label="Referencia del cliente"><Input value={txt("referenciaCliente")} onChange={(e) => set("referenciaCliente", e.target.value)} /></Campo>
            <Campo label="Referencia de autorización"><Input value={txt("referenciaAutorizacion")} onChange={(e) => set("referenciaAutorizacion", e.target.value)} /></Campo>
          </Bloque>
        </>
      )}

      {tab === "Operativa" && (
        <>
          <div className="mb-4">
            <h3 className="mb-2 border-b border-slate-700 pb-1 text-[12px] font-bold uppercase tracking-wide text-cyan-300">
              Tipo de asistencia
            </h3>
            <div className="flex flex-wrap gap-2">
              {TIPOS_ASISTENCIA.map((tipo) => {
                const sel = (d.tiposAsistencia ?? []).includes(tipo);
                return (
                  <button
                    key={tipo}
                    onClick={() => alternarTipo(tipo)}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${
                      sel ? "bg-cyan-600 text-white" : "border border-slate-600 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {tipo}
                  </button>
                );
              })}
            </div>
          </div>
          <Bloque titulo="Clasificación">
            <Campo label="Tipo de vehículo">
              <Select value={txt("tipoVehiculo")} onChange={(e) => set("tipoVehiculo", e.target.value)}>
                <option value="">— Seleccionar —</option>
                {TIPOS_VEHICULO.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Campo>
            <Campo label="Estado del vehículo">
              <Select value={txt("estadoVehiculo")} onChange={(e) => set("estadoVehiculo", e.target.value)}>
                <option value="">— Seleccionar —</option>
                {ESTADOS_VEHICULO.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Campo>
            <Campo label="Ubicación de la incidencia">
              <Select value={txt("ubicacionIncidencia")} onChange={(e) => set("ubicacionIncidencia", e.target.value)}>
                <option value="">— Seleccionar —</option>
                {UBICACIONES.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Campo>
          </Bloque>
        </>
      )}

      {tab === "Vehículo" && (
        <>
          <Bloque titulo="Datos del vehículo">
            <Campo label="Marca"><Input value={txt("marca")} onChange={(e) => set("marca", e.target.value)} placeholder="Renault, Volvo…" /></Campo>
            <Campo label="Modelo"><Input value={txt("modelo")} onChange={(e) => set("modelo", e.target.value)} placeholder="Master, FH…" /></Campo>
            <Campo label="Color"><Input value={txt("color")} onChange={(e) => set("color", e.target.value)} /></Campo>
            <Campo label="Nº bastidor (VIN)"><Input value={txt("vin")} onChange={(e) => set("vin", e.target.value)} /></Campo>
            <Campo label="Kilometraje"><Input type="number" min={0} value={txt("kilometraje")} onChange={(e) => set("kilometraje", e.target.value)} /></Campo>
          </Bloque>
          <Bloque titulo="Neumáticos">
            <Campo label="Medida"><Input value={txt("medidaNeumatico")} onChange={(e) => set("medidaNeumatico", e.target.value)} placeholder="315/70R22.5" /></Campo>
            <Campo label="Eje afectado">
              <Select value={txt("ejeAfectado")} onChange={(e) => set("ejeAfectado", e.target.value)}>
                <option value="">— Seleccionar —</option>
                {EJES.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Campo>
            <Campo label="Posición de la rueda">
              <Select value={txt("posicionRueda")} onChange={(e) => set("posicionRueda", e.target.value)}>
                <option value="">— Seleccionar —</option>
                {POSICIONES.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Campo>
          </Bloque>
          <div className="mb-4">
            <h3 className="mb-2 border-b border-slate-700 pb-1 text-[12px] font-bold uppercase tracking-wide text-cyan-300">
              Carga
            </h3>
            <div className="mb-2 flex flex-wrap gap-4">
              {[
                { v: false as boolean | null, l: "Vacío" },
                { v: true as boolean | null, l: "Cargado" },
                { v: null as boolean | null, l: "No especificado" },
              ].map((o) => (
                <label key={String(o.v)} className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-300">
                  <input
                    type="radio"
                    name={`carga-${assistanceId}`}
                    checked={(d.vehiculoCargado ?? null) === o.v}
                    onChange={() => set("vehiculoCargado", o.v)}
                  />
                  {o.l}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Campo label="Mercancía"><Input value={txt("mercancia")} onChange={(e) => set("mercancia", e.target.value)} placeholder="Descripción de la carga" /></Campo>
              <label className="mt-5 flex cursor-pointer items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-300">
                <input type="checkbox" checked={bool("adr")} onChange={(e) => set("adr", e.target.checked)} />
                Mercancía peligrosa (ADR)
              </label>
            </div>
          </div>
        </>
      )}

      {tab === "Facturación" && (
        <>
          <div className="mb-4">
            <h3 className="mb-2 border-b border-slate-700 pb-1 text-[12px] font-bold uppercase tracking-wide text-cyan-300">
              Estado de facturación
            </h3>
            <div className="flex flex-wrap gap-3">
              {([
                ["facturable", "Facturable"],
                ["pendienteAutorizacion", "Pendiente de autorización"],
                ["garantia", "En garantía"],
                ["interna", "Interna (no se factura)"],
              ] as [keyof BackofficeData, string][]).map(([k, label]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-[13px] text-slate-300">
                  <input type="checkbox" checked={d[k] === true} onChange={(e) => set(k, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <Bloque titulo="Importe y observaciones">
            <Campo label="Importe acordado (€)">
              <Input type="number" min={0} step="0.01" value={txt("importeAcordado")} onChange={(e) => set("importeAcordado", e.target.value)} />
            </Campo>
          </Bloque>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Observaciones de facturación</span>
            <textarea
              value={txt("observacionesFacturacion")}
              onChange={(e) => set("observacionesFacturacion", e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
          </label>
        </>
      )}
    </div>
  );
}
