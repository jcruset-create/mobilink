import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../modules/almacen-neumaticos/services/supabase";
import { getPortalSession, clearPortalSession } from "./PortalLogin";

const TABS = ["Mi perfil", "Fichar", "Documentos", "Competencias", "Certificaciones", "Autorizaciones", "Formación", "Mis EPIs", "Vestuario"];

const NIVEL_BADGE: Record<string, string> = {
  basico: "bg-gray-100 text-gray-700", medio: "bg-blue-100 text-blue-700",
  avanzado: "bg-purple-100 text-purple-700", experto: "bg-orange-100 text-orange-700",
};

function BadgeCaducidad({ fecha }: { fecha: string | null }) {
  if (!fecha) return null;
  const dias = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
  if (dias < 0)   return <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">Caducado</span>;
  if (dias <= 30) return <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs font-medium">Caduca en {dias}d</span>;
  return <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Válido</span>;
}

export default function PortalFicha() {
  const navigate = useNavigate();
  const sesion = getPortalSession();

  const [tabActiva, setTabActiva] = useState(0);
  const [cargando, setCargando] = useState(true);

  const [empleado, setEmpleado]         = useState<any>(null);
  const [competencias, setCompetencias] = useState<any[]>([]);
  const [certs, setCerts]               = useState<any[]>([]);
  const [auts, setAuts]                 = useState<any[]>([]);
  const [formacion, setFormacion]       = useState<any[]>([]);
  const [epis, setEpis]                 = useState<any[]>([]);
  const [vestuario, setVestuario]       = useState<any>(null);
  const [documentos, setDocumentos]     = useState<any[]>([]);
  const [acks, setAcks]                 = useState<Record<string, any>>({});

  // Estado fichaje
  const hoy = new Date().toISOString().slice(0, 10);
  const [fichaje, setFichaje]           = useState<any>(null);
  const [fichandoIn, setFichandoIn]     = useState(false);
  const [fichandoOut, setFichandoOut]   = useState(false);
  const [histFichajes, setHistFichajes] = useState<any[]>([]);

  // Estado firma
  const [docFirmar, setDocFirmar]       = useState<any>(null);
  const [codigoFirma, setCodigoFirma]   = useState("");
  const [firmando, setFirmando]         = useState(false);
  const [errorFirma, setErrorFirma]     = useState("");
  const [docExpandido, setDocExpandido] = useState<string | null>(null);

  useEffect(() => {
    if (!sesion) { navigate("/portal"); return; }
    cargar(sesion.id);
    cargarFichaje(sesion.id);
  }, []);

  async function cargarFichaje(empId: string) {
    const [{ data: hoyRec }, { data: hist }] = await Promise.all([
      supabase.from("pres_records").select("*").eq("employee_id", empId).eq("fecha", hoy).maybeSingle(),
      supabase.from("pres_records").select("*").eq("employee_id", empId)
        .order("fecha", { ascending: false }).limit(14),
    ]);
    setFichaje(hoyRec);
    setHistFichajes(hist ?? []);
  }

  async function ficharEntrada() {
    if (!sesion) return;
    setFichandoIn(true);
    const ahora = new Date().toISOString();
    const { data } = await supabase.from("pres_records")
      .insert({ employee_id: sesion.id, fecha: hoy, hora_entrada: ahora, tipo: "normal" })
      .select().single();
    setFichaje(data);
    await cargarFichaje(sesion.id);
    setFichandoIn(false);
  }

  async function ficharSalida() {
    if (!sesion || !fichaje) return;
    setFichandoOut(true);
    const ahora = new Date().toISOString();
    await supabase.from("pres_records").update({ hora_salida: ahora }).eq("id", fichaje.id);
    await cargarFichaje(sesion.id);
    setFichandoOut(false);
  }

  async function cargar(empId: string) {
    setCargando(true);
    const [
      { data: emp },
      { data: comp },
      { data: cert },
      { data: aut },
      { data: form },
      { data: epiAsig },
      { data: vest },
      { data: docs },
      { data: acksData },
    ] = await Promise.all([
      supabase.from("sea_employees")
        .select("*, sea_companies(nombre), sea_work_centers(nombre)")
        .eq("id", empId).single(),
      supabase.from("sea_employee_competencies")
        .select("*, sea_competencies(nombre, categoria)")
        .eq("employee_id", empId).order("created_at"),
      supabase.from("sea_employee_certifications")
        .select("*").eq("employee_id", empId).order("fecha_obtencion", { ascending: false }),
      supabase.from("sea_employee_authorizations")
        .select("*, sea_authorizations(nombre)")
        .eq("employee_id", empId).order("created_at"),
      supabase.from("sea_training_records")
        .select("*").eq("employee_id", empId).order("fecha_inicio", { ascending: false }),
      supabase.from("sm_epi_assignments")
        .select("*, sm_epis(nombre, descripcion)")
        .eq("employee_id", empId).eq("estado", "activa").order("fecha_entrega", { ascending: false }),
      supabase.from("sea_employee_clothing")
        .select("*").eq("employee_id", empId).maybeSingle(),
      supabase.from("sm_safety_documents")
        .select("id, titulo, tipo, descripcion, contenido, archivo_url, version, lectura_obligatoria, created_at")
        .eq("publicado", true)
        .order("created_at", { ascending: false }),
      supabase.from("sm_document_acknowledgements")
        .select("*").eq("employee_id", empId),
    ]);

    setEmpleado(emp);
    setCompetencias(comp ?? []);
    setCerts(cert ?? []);
    setAuts(aut ?? []);
    setFormacion(form ?? []);
    setEpis(epiAsig ?? []);
    setVestuario(vest);
    setDocumentos(docs ?? []);

    // Indexar acks por document_id
    const ackMap: Record<string, any> = {};
    for (const a of acksData ?? []) ackMap[a.document_id] = a;
    setAcks(ackMap);

    setCargando(false);
  }

  async function marcarLeido(docId: string) {
    if (!sesion) return;
    const existe = acks[docId];
    if (existe?.leido) return;
    const payload = { document_id: docId, employee_id: sesion.id, leido: true, fecha_lectura: new Date().toISOString() };
    if (existe) {
      await supabase.from("sm_document_acknowledgements").update({ leido: true, fecha_lectura: new Date().toISOString() }).eq("id", existe.id);
    } else {
      await supabase.from("sm_document_acknowledgements").insert(payload);
    }
    setAcks((prev) => ({ ...prev, [docId]: { ...(prev[docId] ?? {}), ...payload } }));
  }

  async function firmarDocumento() {
    if (!sesion || !docFirmar) return;
    setErrorFirma("");
    if (codigoFirma !== sesion.codigo) { setErrorFirma("Código incorrecto."); return; }
    setFirmando(true);
    const ahora = new Date().toISOString();
    const existe = acks[docFirmar.id];
    const payload = {
      document_id: docFirmar.id, employee_id: sesion.id,
      leido: true, firmado: true,
      fecha_lectura: existe?.fecha_lectura ?? ahora,
      fecha_firma: ahora,
      dispositivo: navigator.userAgent.slice(0, 200),
    };
    if (existe) {
      await supabase.from("sm_document_acknowledgements").update({ firmado: true, fecha_firma: ahora }).eq("id", existe.id);
    } else {
      await supabase.from("sm_document_acknowledgements").insert(payload);
    }
    setAcks((prev) => ({ ...prev, [docFirmar.id]: { ...(prev[docFirmar.id] ?? {}), ...payload } }));
    setFirmando(false);
    setDocFirmar(null);
    setCodigoFirma("");
  }

  function cerrarSesion() { clearPortalSession(); navigate("/portal"); }

  if (!sesion) return null;
  if (cargando) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-400 text-sm">Cargando tu ficha...</div>
    </div>
  );

  const docsPendientes = documentos.filter((d) => d.lectura_obligatoria && !acks[d.id]?.firmado);
  const alertasCaducidad = [
    ...certs.filter((c) => c.fecha_caducidad && Math.ceil((new Date(c.fecha_caducidad).getTime() - Date.now()) / 86400000) <= 30),
    ...auts.filter((a) => a.fecha_caducidad && Math.ceil((new Date(a.fecha_caducidad).getTime() - Date.now()) / 86400000) <= 30),
    ...formacion.filter((f) => f.fecha_caducidad && Math.ceil((new Date(f.fecha_caducidad).getTime() - Date.now()) / 86400000) <= 30),
  ];

  return (
    <div className="min-h-screen bg-gray-100 pb-10">
      {/* Header */}
      <header className="bg-gray-800 text-white px-5 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm shrink-0">
              {sesion.nombre.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-bold leading-tight">{sesion.nombre}</div>
              {empleado?.cargo && <div className="text-xs text-white/70">{empleado.cargo}</div>}
            </div>
          </div>
          <button onClick={cerrarSesion}
            className="text-xs text-white/70 hover:text-white border border-white/30 rounded-lg px-3 py-1.5 transition-colors">
            Salir
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-5 space-y-4">

        {/* Alertas */}
        {(docsPendientes.length > 0 || alertasCaducidad.length > 0) && (
          <div className="space-y-2">
            {docsPendientes.length > 0 && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex gap-3 items-start cursor-pointer"
                onClick={() => setTabActiva(2)}>
                <span className="text-red-500 text-lg shrink-0">📋</span>
                <div>
                  <div className="font-semibold text-red-800 text-sm">
                    {docsPendientes.length} documento{docsPendientes.length > 1 ? "s" : ""} pendiente{docsPendientes.length > 1 ? "s" : ""} de firma
                  </div>
                  <p className="text-xs text-red-600 mt-0.5">Toca aquí para ver y firmar</p>
                </div>
              </div>
            )}
            {alertasCaducidad.length > 0 && (
              <div className="rounded-xl bg-orange-50 border border-orange-200 p-4 flex gap-3 items-start">
                <span className="text-orange-500 text-lg shrink-0">⚠️</span>
                <div className="font-semibold text-orange-800 text-sm">
                  {alertasCaducidad.length} documento{alertasCaducidad.length > 1 ? "s" : ""} próximo{alertasCaducidad.length > 1 ? "s" : ""} a caducar. Consulta con tu responsable.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-max border-b">
            {TABS.map((tab, i) => (
              <button key={tab} onClick={() => setTabActiva(i)}
                className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors relative ${
                  tabActiva === i ? "border-gray-800 text-gray-800" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}>
                {tab}
                {i === 2 && docsPendientes.length > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
                    {docsPendientes.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab 0: Mi perfil */}
        {tabActiva === 0 && empleado && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {[
              { label: "Empresa",           value: empleado.sea_companies?.nombre },
              { label: "Centro de trabajo", value: empleado.sea_work_centers?.nombre },
              { label: "Departamento",      value: empleado.departamento },
              { label: "Cargo",             value: empleado.cargo },
              { label: "Email",             value: empleado.email },
              { label: "Teléfono",          value: empleado.telefono },
              { label: "Fecha de alta",     value: empleado.fecha_alta ? new Date(empleado.fecha_alta).toLocaleDateString("es-ES") : null },
            ].filter((f) => f.value).map(({ label, value }) => (
              <div key={label} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-right">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tab 1: Fichar */}
        {tabActiva === 1 && (
          <div className="space-y-4">
            {/* Estado hoy */}
            <div className={`rounded-2xl border p-6 text-center space-y-4 ${
              !fichaje ? "bg-white" :
              fichaje.hora_entrada && !fichaje.hora_salida ? "bg-green-50 border-green-200" :
              "bg-gray-50 border-gray-200"
            }`}>
              {!fichaje ? (
                <>
                  <div className="text-4xl">⏱️</div>
                  <p className="text-gray-600 text-sm">No has fichado entrada hoy.</p>
                  <button onClick={ficharEntrada} disabled={fichandoIn}
                    className="mx-auto flex items-center gap-2 rounded-2xl bg-gray-800 px-8 py-4 text-white font-bold text-base hover:bg-gray-900 disabled:opacity-50 shadow-lg">
                    {fichandoIn ? "Registrando..." : "🟢 Fichar entrada"}
                  </button>
                </>
              ) : fichaje.hora_entrada && !fichaje.hora_salida ? (
                <>
                  <div className="text-4xl">🟢</div>
                  <p className="text-green-700 font-semibold">En planta</p>
                  <p className="text-sm text-green-600">
                    Entrada registrada a las{" "}
                    <strong>{new Date(fichaje.hora_entrada).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</strong>
                  </p>
                  <button onClick={ficharSalida} disabled={fichandoOut}
                    className="mx-auto flex items-center gap-2 rounded-2xl bg-gray-800 px-8 py-4 text-white font-bold text-base hover:bg-gray-900 disabled:opacity-50 shadow-lg">
                    {fichandoOut ? "Registrando..." : "🔴 Fichar salida"}
                  </button>
                </>
              ) : (
                <>
                  <div className="text-4xl">✅</div>
                  <p className="text-gray-700 font-semibold">Jornada completada</p>
                  <div className="text-sm text-gray-500 space-y-1">
                    <p>Entrada: <strong>{new Date(fichaje.hora_entrada).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</strong></p>
                    <p>Salida: <strong>{new Date(fichaje.hora_salida).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</strong></p>
                    <p>Duración: <strong>{(() => {
                      const mins = Math.round((new Date(fichaje.hora_salida).getTime() - new Date(fichaje.hora_entrada).getTime()) / 60000);
                      return `${Math.floor(mins / 60)}h ${(mins % 60).toString().padStart(2, "0")}m`;
                    })()}</strong></p>
                  </div>
                </>
              )}
            </div>

            {/* Historial */}
            {histFichajes.length > 0 && (
              <div className="rounded-xl border bg-white overflow-hidden">
                <div className="px-4 py-3 border-b bg-gray-50">
                  <h3 className="font-semibold text-sm text-gray-700">Últimos registros</h3>
                </div>
                <div className="divide-y">
                  {histFichajes.map((r) => {
                    const entrada = r.hora_entrada ? new Date(r.hora_entrada).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—";
                    const salida  = r.hora_salida  ? new Date(r.hora_salida).toLocaleTimeString("es-ES",  { hour: "2-digit", minute: "2-digit" }) : "—";
                    return (
                      <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                        <span className="text-gray-500">
                          {new Date(r.fecha + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
                        </span>
                        <span className="font-mono text-gray-700">{entrada} → {salida}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Documentos */}
        {tabActiva === 2 && (
          <div className="space-y-3">
            {documentos.length === 0
              ? <div className="rounded-xl border bg-white p-8 text-center text-sm text-gray-400">Sin documentos publicados.</div>
              : documentos.map((doc) => {
                const ack = acks[doc.id];
                const firmado = ack?.firmado ?? false;
                const leido   = ack?.leido ?? false;
                const expandido = docExpandido === doc.id;

                return (
                  <div key={doc.id} className={`rounded-xl border bg-white overflow-hidden ${doc.lectura_obligatoria && !firmado ? "border-red-300" : ""}`}>
                    {/* Cabecera */}
                    <div className="flex items-start justify-between p-4 gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{doc.titulo}</span>
                          <span className="text-xs text-gray-400">v{doc.version}</span>
                          {doc.lectura_obligatoria && (
                            <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">Firma obligatoria</span>
                          )}
                        </div>
                        {doc.descripcion && <p className="text-xs text-gray-500 mt-1">{doc.descripcion}</p>}
                        <div className="flex gap-3 mt-2 text-xs">
                          {firmado
                            ? <span className="text-green-700 font-medium">✓ Firmado el {new Date(ack.fecha_firma).toLocaleDateString("es-ES")}</span>
                            : leido
                            ? <span className="text-blue-600">Leído · pendiente de firma</span>
                            : <span className="text-gray-400">No leído</span>
                          }
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setDocExpandido(expandido ? null : doc.id);
                          if (!leido) marcarLeido(doc.id);
                        }}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 shrink-0">
                        {expandido ? "Cerrar" : "Leer"}
                      </button>
                    </div>

                    {/* Contenido expandido */}
                    {expandido && (
                      <div className="border-t px-4 py-4 space-y-4">
                        {doc.contenido && (
                          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-3">
                            {doc.contenido}
                          </div>
                        )}
                        {doc.archivo_url && (
                          <a href={doc.archivo_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
                            📎 Ver archivo adjunto
                          </a>
                        )}
                        {/* Botón firmar */}
                        {!firmado && (
                          <button
                            onClick={() => { setDocFirmar(doc); setCodigoFirma(""); setErrorFirma(""); }}
                            className="w-full rounded-xl bg-gray-800 py-3 text-sm font-bold text-white hover:bg-gray-900">
                            ✍️ Firmar este documento
                          </button>
                        )}
                        {firmado && (
                          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-2 text-green-800 text-sm">
                            <span className="text-lg">✅</span>
                            Firmado el {new Date(ack.fecha_firma).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {/* Tab 3: Competencias */}
        {tabActiva === 3 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {competencias.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">Sin competencias registradas.</p>
              : competencias.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-medium text-sm">{c.sea_competencies?.nombre}</div>
                    <div className="text-xs text-gray-400 capitalize">{c.sea_competencies?.categoria}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${NIVEL_BADGE[c.nivel] ?? "bg-gray-100"}`}>{c.nivel}</span>
                </div>
              ))}
          </div>
        )}

        {/* Tab 4: Certificaciones */}
        {tabActiva === 4 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {certs.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">Sin certificaciones.</p>
              : certs.map((c) => (
                <div key={c.id} className="flex items-start justify-between px-4 py-3 gap-2">
                  <div>
                    <div className="font-medium text-sm">{c.nombre}</div>
                    {c.entidad_emisora && <div className="text-xs text-gray-400">{c.entidad_emisora}</div>}
                    {c.fecha_obtencion && <div className="text-xs text-gray-400">Obtenida: {new Date(c.fecha_obtencion).toLocaleDateString("es-ES")}</div>}
                  </div>
                  <BadgeCaducidad fecha={c.fecha_caducidad} />
                </div>
              ))}
          </div>
        )}

        {/* Tab 5: Autorizaciones */}
        {tabActiva === 5 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {auts.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">Sin autorizaciones.</p>
              : auts.map((a) => (
                <div key={a.id} className="flex items-start justify-between px-4 py-3 gap-2">
                  <div>
                    <div className="font-medium text-sm">{a.sea_authorizations?.nombre}</div>
                    {a.numero_autorizacion && <div className="text-xs text-gray-400">Nº {a.numero_autorizacion}</div>}
                    {a.fecha_emision && <div className="text-xs text-gray-400">Emitida: {new Date(a.fecha_emision).toLocaleDateString("es-ES")}</div>}
                  </div>
                  <BadgeCaducidad fecha={a.fecha_caducidad} />
                </div>
              ))}
          </div>
        )}

        {/* Tab 6: Formación */}
        {tabActiva === 6 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {formacion.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">Sin registros de formación.</p>
              : formacion.map((f) => (
                <div key={f.id} className="flex items-start justify-between px-4 py-3 gap-2">
                  <div>
                    <div className="font-medium text-sm">{f.nombre_curso}</div>
                    <div className="text-xs text-gray-400">
                      {[f.entidad_formadora, f.horas ? `${f.horas}h` : null, f.fecha_inicio ? new Date(f.fecha_inicio).toLocaleDateString("es-ES") : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.resultado === "superado" ? "bg-green-100 text-green-700" : f.resultado === "no_superado" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                      {f.resultado?.replace("_", " ")}
                    </span>
                    <BadgeCaducidad fecha={f.fecha_caducidad} />
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Tab 7: Mis EPIs */}
        {tabActiva === 7 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {epis.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">No tienes EPIs asignados actualmente.</p>
              : epis.map((e) => (
                <div key={e.id} className="px-4 py-3">
                  <div className="font-medium text-sm">{e.sm_epis?.nombre}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {e.cantidad && `${e.cantidad} ud. · `}
                    Entregado: {e.fecha_entrega ? new Date(e.fecha_entrega).toLocaleDateString("es-ES") : "—"}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Tab 8: Vestuario */}
        {tabActiva === 8 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {!vestuario
              ? <p className="p-6 text-center text-sm text-gray-400">No hay tallas registradas. Consulta con RRHH.</p>
              : [
                  { label: "Camiseta", value: vestuario.camiseta },
                  { label: "Camisa",   value: vestuario.camisa },
                  { label: "Pantalón", value: vestuario.pantalon },
                  { label: "Calzado",  value: vestuario.calzado },
                  { label: "Chaqueta", value: vestuario.chaqueta },
                  { label: "Sudadera", value: vestuario.sudadera },
                  { label: "Chaleco",  value: vestuario.chaleco },
                ].filter((f) => f.value).map(({ label, value }) => (
                  <div key={label} className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-bold">{value}</span>
                  </div>
                ))}
            {vestuario?.observaciones && (
              <div className="px-4 py-3 text-xs text-gray-400">{vestuario.observaciones}</div>
            )}
          </div>
        )}
      </div>

      {/* Modal firma */}
      {docFirmar && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div>
              <h2 className="font-bold text-gray-900">Firmar documento</h2>
              <p className="text-sm text-gray-500 mt-1">{docFirmar.titulo}</p>
            </div>
            <p className="text-sm text-gray-600">
              Al firmar confirmas que has leído y entendido el contenido de este documento.
              Introduce tu código personal para confirmar.
            </p>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tu código (4 dígitos)</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={codigoFirma}
                onChange={(e) => setCodigoFirma(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => { if (e.key === "Enter") void firmarDocumento(); }}
                placeholder="••••"
                className="mt-1 w-full rounded-xl border px-3 py-3 text-center text-2xl font-bold tracking-[1rem] outline-none focus:ring-2 focus:ring-gray-300"
                autoFocus
              />
            </div>
            {errorFirma && <p className="text-sm text-red-600">{errorFirma}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setDocFirmar(null); setCodigoFirma(""); setErrorFirma(""); }}
                className="flex-1 rounded-xl border py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={firmarDocumento} disabled={firmando || codigoFirma.length !== 4}
                className="flex-1 rounded-xl bg-gray-800 py-3 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-40">
                {firmando ? "Firmando..." : "✍️ Confirmar firma"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
