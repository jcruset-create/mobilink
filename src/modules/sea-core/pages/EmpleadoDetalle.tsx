import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CoreLayout from "../layouts/CoreLayout";
import { supabase } from "../../almacen-neumaticos/services/supabase";

type Empleado = {
  id: string; nombre: string; apellidos: string | null;
  dni_nie: string | null; telefono: string | null; email: string | null;
  cargo: string | null; departamento: string | null; rol: string;
  codigo_operario: string | null; activo: boolean; fecha_alta: string | null;
  company_id: string | null; work_center_id: string | null;
  sea_companies: { nombre: string } | null;
  sea_work_centers: { nombre: string } | null;
};

const TABS = ["Datos personales", "Competencias", "Certificaciones", "Autorizaciones", "Formación", "Vestuario"];

const ROL_BADGE: Record<string, string> = {
  admin: "bg-red-500/20 text-red-800", responsable: "bg-orange-100 text-orange-800",
  operario: "bg-blue-100 text-blue-800", prl: "bg-purple-100 text-purple-800",
  almacen: "bg-green-100 text-green-800",
};

const NIVEL_BADGE: Record<string, string> = {
  basico: "bg-slate-700 text-slate-200", medio: "bg-blue-100 text-blue-700",
  avanzado: "bg-purple-100 text-purple-700", experto: "bg-orange-100 text-orange-700",
};

export default function EmpleadoDetalle() {
  const { id } = useParams<{ id: string }>();
  const [empleado, setEmpleado] = useState<Empleado | null>(null);
  const [tabActiva, setTabActiva] = useState(0);
  const [cargando, setCargando] = useState(true);

  // Sub-data
  const [competencias, setCompetencias] = useState<any[]>([]);
  const [certificaciones, setCertificaciones] = useState<any[]>([]);
  const [autorizaciones, setAutorizaciones] = useState<any[]>([]);
  const [formaciones, setFormaciones] = useState<any[]>([]);

  // Catálogos para añadir
  const [catCompetencias, setCatCompetencias] = useState<any[]>([]);
  const [catAutorizaciones, setCatAutorizaciones] = useState<any[]>([]);

  // Modals
  const [modalComp, setModalComp] = useState(false);
  const [modalCert, setModalCert] = useState(false);
  const [modalAut, setModalAut] = useState(false);
  const [modalForm, setModalForm] = useState(false);

  const [formComp, setFormComp] = useState({ competencia_id: "", nivel: "basico", notas: "" });
  const [formCert, setFormCert] = useState({ nombre: "", entidad_emisora: "", fecha_obtencion: "", fecha_caducidad: "", numero_certificado: "", url_certificado: "" });
  const [formAut, setFormAut] = useState({ autorizacion_id: "", fecha_emision: "", fecha_caducidad: "", numero_autorizacion: "", notas: "" });
  const [formForm, setFormForm] = useState({ nombre_curso: "", entidad_formadora: "", fecha_inicio: "", fecha_fin: "", horas: "", resultado: "superado", fecha_caducidad: "", notas: "" });

  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  // Vestuario
  const [vestuarioId, setVestuarioId] = useState<string | null>(null);
  const [formVest, setFormVest] = useState({ calzado: "", pantalon: "", camisa: "", camiseta: "", chaqueta: "", sudadera: "", chaleco: "", observaciones: "" });
  const [guardandoVest, setGuardandoVest] = useState(false);

  useEffect(() => { if (id) cargar(id); }, [id]);

  async function cargar(empId: string) {
    setCargando(true);
    const [{ data: emp }, { data: comp }, { data: cert }, { data: aut }, { data: form },
      { data: catC }, { data: catA }, { data: vest }] = await Promise.all([
      supabase.from("sea_employees")
        .select("*, sea_companies(nombre), sea_work_centers(nombre)")
        .eq("id", empId).single(),
      supabase.from("sea_employee_competencies")
        .select("*, sea_competencies(nombre, categoria)")
        .eq("employee_id", empId).order("created_at"),
      supabase.from("sea_employee_certifications")
        .select("*").eq("employee_id", empId).order("fecha_obtencion", { ascending: false }),
      supabase.from("sea_employee_authorizations")
        .select("*, sea_authorizations(nombre, descripcion)")
        .eq("employee_id", empId).order("created_at"),
      supabase.from("sea_training_records")
        .select("*").eq("employee_id", empId).order("fecha_inicio", { ascending: false }),
      supabase.from("sea_competencies").select("id, nombre, categoria").order("nombre"),
      supabase.from("sea_authorizations").select("id, nombre").order("nombre"),
      supabase.from("sea_employee_clothing").select("*").eq("employee_id", empId).maybeSingle(),
    ]);
    setEmpleado(emp as any);
    setCompetencias(comp ?? []);
    setCertificaciones(cert ?? []);
    setAutorizaciones(aut ?? []);
    setFormaciones(form ?? []);
    setCatCompetencias(catC ?? []);
    setCatAutorizaciones(catA ?? []);
    if (vest) {
      setVestuarioId(vest.id);
      setFormVest({
        calzado: vest.calzado ?? "", pantalon: vest.pantalon ?? "",
        camisa: vest.camisa ?? "", camiseta: vest.camiseta ?? "",
        chaqueta: vest.chaqueta ?? "", sudadera: vest.sudadera ?? "",
        chaleco: vest.chaleco ?? "", observaciones: vest.observaciones ?? "",
      });
    } else {
      setVestuarioId(null);
      setFormVest({ calzado: "", pantalon: "", camisa: "", camiseta: "", chaqueta: "", sudadera: "", chaleco: "", observaciones: "" });
    }
    setCargando(false);
  }

  async function addCompetencia() {
    if (!formComp.competencia_id) return;
    setGuardando(true);
    await supabase.from("sea_employee_competencies").insert({
      employee_id: id, competencia_id: formComp.competencia_id,
      nivel: formComp.nivel, notas: formComp.notas || null,
    });
    setGuardando(false);
    setModalComp(false);
    setFormComp({ competencia_id: "", nivel: "basico", notas: "" });
    setMensaje("Competencia añadida."); setTimeout(() => setMensaje(""), 3000);
    cargar(id!);
  }

  async function addCertificacion() {
    if (!formCert.nombre) return;
    setGuardando(true);
    await supabase.from("sea_employee_certifications").insert({
      employee_id: id,
      nombre: formCert.nombre, entidad_emisora: formCert.entidad_emisora || null,
      fecha_obtencion: formCert.fecha_obtencion || null,
      fecha_caducidad: formCert.fecha_caducidad || null,
      numero_certificado: formCert.numero_certificado || null,
      url_certificado: formCert.url_certificado || null,
    });
    setGuardando(false);
    setModalCert(false);
    setFormCert({ nombre: "", entidad_emisora: "", fecha_obtencion: "", fecha_caducidad: "", numero_certificado: "", url_certificado: "" });
    setMensaje("Certificación añadida."); setTimeout(() => setMensaje(""), 3000);
    cargar(id!);
  }

  async function addAutorizacion() {
    if (!formAut.autorizacion_id) return;
    setGuardando(true);
    await supabase.from("sea_employee_authorizations").insert({
      employee_id: id, autorizacion_id: formAut.autorizacion_id,
      fecha_emision: formAut.fecha_emision || null,
      fecha_caducidad: formAut.fecha_caducidad || null,
      numero_autorizacion: formAut.numero_autorizacion || null,
      notas: formAut.notas || null,
    });
    setGuardando(false);
    setModalAut(false);
    setFormAut({ autorizacion_id: "", fecha_emision: "", fecha_caducidad: "", numero_autorizacion: "", notas: "" });
    setMensaje("Autorización añadida."); setTimeout(() => setMensaje(""), 3000);
    cargar(id!);
  }

  async function addFormacion() {
    if (!formForm.nombre_curso) return;
    setGuardando(true);
    await supabase.from("sea_training_records").insert({
      employee_id: id,
      nombre_curso: formForm.nombre_curso, entidad_formadora: formForm.entidad_formadora || null,
      fecha_inicio: formForm.fecha_inicio || null, fecha_fin: formForm.fecha_fin || null,
      horas: formForm.horas ? Number(formForm.horas) : null,
      resultado: formForm.resultado,
      fecha_caducidad: formForm.fecha_caducidad || null,
      notas: formForm.notas || null,
    });
    setGuardando(false);
    setModalForm(false);
    setFormForm({ nombre_curso: "", entidad_formadora: "", fecha_inicio: "", fecha_fin: "", horas: "", resultado: "superado", fecha_caducidad: "", notas: "" });
    setMensaje("Formación añadida."); setTimeout(() => setMensaje(""), 3000);
    cargar(id!);
  }

  async function eliminarComp(compId: string) {
    if (!confirm("¿Eliminar esta competencia?")) return;
    await supabase.from("sea_employee_competencies").delete().eq("id", compId);
    cargar(id!);
  }

  async function eliminarCert(certId: string) {
    if (!confirm("¿Eliminar esta certificación?")) return;
    await supabase.from("sea_employee_certifications").delete().eq("id", certId);
    cargar(id!);
  }

  async function eliminarAut(autId: string) {
    if (!confirm("¿Eliminar esta autorización?")) return;
    await supabase.from("sea_employee_authorizations").delete().eq("id", autId);
    cargar(id!);
  }

  async function eliminarForm(formId: string) {
    if (!confirm("¿Eliminar este registro de formación?")) return;
    await supabase.from("sea_training_records").delete().eq("id", formId);
    cargar(id!);
  }

  function exportarPDF() {
    const nombre = [empleado!.nombre, empleado!.apellidos].filter(Boolean).join(" ");
    const hoy = new Date().toLocaleDateString("es-ES");

    const fila = (label: string, value: string | null | undefined) =>
      value ? `<tr><td style="color:#6b7280;padding:4px 8px 4px 0;width:40%">${label}</td><td style="padding:4px 0;font-weight:500">${value}</td></tr>` : "";

    const seccion = (titulo: string, contenido: string) =>
      `<div style="margin-bottom:20px;page-break-inside:avoid">
        <h2 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:8px">${titulo}</h2>
        ${contenido}
      </div>`;

    const tabla = (filas: string) =>
      `<table style="width:100%;font-size:12px;border-collapse:collapse">${filas}</table>`;

    const lista = (items: string[]) =>
      items.length === 0
        ? `<p style="font-size:12px;color:#9ca3af;font-style:italic">Sin registros.</p>`
        : `<ul style="margin:0;padding-left:16px;font-size:12px">${items.map((i) => `<li style="margin-bottom:4px">${i}</li>`).join("")}</ul>`;

    const diasCad = (fecha: string | null) => {
      if (!fecha) return "";
      const d = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
      if (d < 0) return ` <span style="color:#dc2626">[CADUCADO]</span>`;
      if (d <= 30) return ` <span style="color:#d97706">[Caduca en ${d}d]</span>`;
      return ` <span style="color:#16a34a">[Válido ${d}d]</span>`;
    };

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Ficha – ${nombre}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 24px; font-size: 13px; }
        @media print { body { padding: 0; } @page { margin: 15mm; } }
      </style>
    </head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #111827">
        <div>
          <h1 style="margin:0;font-size:20px">${nombre}</h1>
          <p style="margin:4px 0 0;color:#6b7280;font-size:12px">
            ${[empleado!.cargo, empleado!.departamento, (empleado!.sea_companies as any)?.nombre].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div style="text-align:right;font-size:11px;color:#9ca3af">
          <div>Mobilink Platform</div>
          <div>${hoy}</div>
          <div style="margin-top:4px;font-weight:700;color:${empleado!.activo ? "#16a34a" : "#dc2626"}">${empleado!.activo ? "ACTIVO" : "INACTIVO"}</div>
        </div>
      </div>

      ${seccion("Datos personales", tabla([
        fila("DNI / NIE", empleado!.dni_nie),
        fila("Email", empleado!.email),
        fila("Teléfono", empleado!.telefono),
        fila("Empresa", (empleado!.sea_companies as any)?.nombre),
        fila("Centro de trabajo", (empleado!.sea_work_centers as any)?.nombre),
        fila("Rol", empleado!.rol),
        fila("Código operario", empleado!.codigo_operario),
        fila("Fecha de alta", empleado!.fecha_alta ? new Date(empleado!.fecha_alta).toLocaleDateString("es-ES") : null),
      ].join("")))}

      ${competencias.length > 0 ? seccion("Competencias", lista(
        competencias.map((c) => `<strong>${c.sea_competencies?.nombre}</strong> (${c.nivel})${c.notas ? ` — ${c.notas}` : ""}`)
      )) : ""}

      ${certificaciones.length > 0 ? seccion("Certificaciones", lista(
        certificaciones.map((c) => `<strong>${c.nombre}</strong>${c.entidad_emisora ? ` · ${c.entidad_emisora}` : ""}${c.fecha_caducidad ? diasCad(c.fecha_caducidad) : ""}`)
      )) : ""}

      ${autorizaciones.length > 0 ? seccion("Autorizaciones", lista(
        autorizaciones.map((a) => `<strong>${a.sea_authorizations?.nombre}</strong>${a.numero_autorizacion ? ` Nº ${a.numero_autorizacion}` : ""}${a.fecha_caducidad ? diasCad(a.fecha_caducidad) : ""}`)
      )) : ""}

      ${formaciones.length > 0 ? seccion("Formación", lista(
        formaciones.map((f) => `<strong>${f.nombre_curso}</strong>${f.entidad_formadora ? ` · ${f.entidad_formadora}` : ""}${f.horas ? ` · ${f.horas}h` : ""} · ${f.resultado}${f.fecha_caducidad ? diasCad(f.fecha_caducidad) : ""}`)
      )) : ""}

      ${(formVest.camiseta || formVest.pantalon || formVest.calzado || formVest.camisa || formVest.chaqueta || formVest.sudadera || formVest.chaleco) ? seccion("Tallas de vestuario", tabla([
        fila("Camiseta", formVest.camiseta),
        fila("Camisa", formVest.camisa),
        fila("Pantalón", formVest.pantalon),
        fila("Calzado", formVest.calzado),
        fila("Chaqueta", formVest.chaqueta),
        fila("Sudadera", formVest.sudadera),
        fila("Chaleco", formVest.chaleco),
        fila("Observaciones", formVest.observaciones),
      ].join(""))) : ""}

      <p style="margin-top:32px;font-size:10px;color:#9ca3af;text-align:center">
        Documento generado el ${hoy} · Mobilink Platform · Confidencial
      </p>
    </body></html>`;

    const ventana = window.open("", "_blank");
    if (!ventana) return;
    ventana.document.write(html);
    ventana.document.close();
    ventana.onload = () => { ventana.print(); };
  }

  async function guardarVestuario() {
    setGuardandoVest(true);
    const payload = {
      employee_id:   id,
      calzado:       formVest.calzado || null,
      pantalon:      formVest.pantalon || null,
      camisa:        formVest.camisa || null,
      camiseta:      formVest.camiseta || null,
      chaqueta:      formVest.chaqueta || null,
      sudadera:      formVest.sudadera || null,
      chaleco:       formVest.chaleco || null,
      observaciones: formVest.observaciones || null,
    };
    if (vestuarioId) {
      await supabase.from("sea_employee_clothing").update(payload).eq("id", vestuarioId);
    } else {
      const { data } = await supabase.from("sea_employee_clothing").insert(payload).select("id").single();
      if (data) setVestuarioId(data.id);
    }
    setGuardandoVest(false);
    setMensaje("Tallas guardadas."); setTimeout(() => setMensaje(""), 3000);
  }

  function diasParaCaducidad(fecha: string | null) {
    if (!fecha) return null;
    return Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
  }

  function BadgeCaducidad({ fecha }: { fecha: string | null }) {
    const dias = diasParaCaducidad(fecha);
    if (dias === null) return null;
    if (dias < 0) return <span className="rounded-full bg-red-500/20 text-red-300 px-2 py-0.5 text-xs font-medium">Caducado</span>;
    if (dias <= 30) return <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs font-medium">Caduca en {dias}d</span>;
    return <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Válido ({dias}d)</span>;
  }

  if (cargando) return <CoreLayout><div className="py-20 text-center text-slate-500">Cargando...</div></CoreLayout>;
  if (!empleado) return <CoreLayout><div className="py-20 text-center text-slate-500">Empleado no encontrado.</div></CoreLayout>;

  return (
    <CoreLayout>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-full bg-slate-700 flex items-center justify-center text-xl font-bold text-slate-300 shrink-0">
          {empleado.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{empleado.nombre} {empleado.apellidos ?? ""}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROL_BADGE[empleado.rol] ?? "bg-slate-700"}`}>
              {empleado.rol}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${empleado.activo ? "bg-green-100 text-green-800" : "bg-red-500/20 text-red-300"}`}>
              {empleado.activo ? "Activo" : "Inactivo"}
            </span>
          </div>
          <div className="text-sm text-slate-400 mt-1">
            {empleado.cargo ?? ""}{empleado.departamento ? ` · ${empleado.departamento}` : ""}
            {(empleado.sea_companies as any)?.nombre ? ` · ${(empleado.sea_companies as any).nombre}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={exportarPDF}
            className="rounded-xl border border-slate-700 border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700/50 flex items-center gap-1">
            ⬇ Exportar PDF
          </button>
          <Link to="/sea-core/empleados" className="text-sm text-slate-400 hover:text-slate-200">← Volver</Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-700 flex gap-0 overflow-x-auto">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setTabActiva(i)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tabActiva === i ? "border-slate-700 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab: Datos personales */}
      {tabActiva === 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3">
            <h2 className="font-semibold text-slate-200">Datos personales</h2>
            {[
              { label: "Nombre completo", value: `${empleado.nombre} ${empleado.apellidos ?? ""}` },
              { label: "DNI / NIE", value: empleado.dni_nie },
              { label: "Email", value: empleado.email },
              { label: "Teléfono", value: empleado.telefono },
              { label: "Fecha de alta", value: empleado.fecha_alta ? new Date(empleado.fecha_alta).toLocaleDateString("es-ES") : null },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm border-b border-slate-700 pb-2 last:border-0 last:pb-0">
                <span className="text-slate-400">{label}</span>
                <span className="font-medium text-right">{value ?? "—"}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3">
            <h2 className="font-semibold text-slate-200">Puesto y organización</h2>
            {[
              { label: "Cargo", value: empleado.cargo },
              { label: "Departamento", value: empleado.departamento },
              { label: "Rol sistema", value: empleado.rol },
              { label: "Código operario", value: empleado.codigo_operario },
              { label: "Empresa", value: (empleado.sea_companies as any)?.nombre },
              { label: "Centro de trabajo", value: (empleado.sea_work_centers as any)?.nombre },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm border-b border-slate-700 pb-2 last:border-0 last:pb-0">
                <span className="text-slate-400">{label}</span>
                <span className="font-medium text-right">{value ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Competencias */}
      {tabActiva === 1 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">{competencias.length} competencias</h2>
            <button onClick={() => setModalComp(true)}
              className="rounded-xl bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500">
              + Añadir competencia
            </button>
          </div>
          {competencias.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">Sin competencias registradas.</div>
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800 divide-y divide-slate-700">
              {competencias.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="font-medium text-sm">{c.sea_competencies?.nombre}</div>
                    <div className="text-xs text-slate-500">{c.sea_competencies?.categoria}</div>
                    {c.notas && <div className="text-xs text-slate-400 mt-0.5">{c.notas}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${NIVEL_BADGE[c.nivel] ?? "bg-slate-700"}`}>{c.nivel}</span>
                    <button onClick={() => eliminarComp(c.id)} className="text-xs text-red-400 hover:text-red-300">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Certificaciones */}
      {tabActiva === 2 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">{certificaciones.length} certificaciones</h2>
            <button onClick={() => setModalCert(true)}
              className="rounded-xl bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500">
              + Añadir certificación
            </button>
          </div>
          {certificaciones.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">Sin certificaciones.</div>
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800 divide-y divide-slate-700">
              {certificaciones.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="font-medium text-sm">{c.nombre}</div>
                    <div className="text-xs text-slate-500">{c.entidad_emisora ?? ""}{c.numero_certificado ? ` · ${c.numero_certificado}` : ""}</div>
                    {c.fecha_obtencion && <div className="text-xs text-slate-500">Obtenido: {new Date(c.fecha_obtencion).toLocaleDateString("es-ES")}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <BadgeCaducidad fecha={c.fecha_caducidad} />
                    <button onClick={() => eliminarCert(c.id)} className="text-xs text-red-400 hover:text-red-300">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Autorizaciones */}
      {tabActiva === 3 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">{autorizaciones.length} autorizaciones</h2>
            <button onClick={() => setModalAut(true)}
              className="rounded-xl bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500">
              + Añadir autorización
            </button>
          </div>
          {autorizaciones.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">Sin autorizaciones.</div>
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800 divide-y divide-slate-700">
              {autorizaciones.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="font-medium text-sm">{a.sea_authorizations?.nombre}</div>
                    {a.numero_autorizacion && <div className="text-xs text-slate-500">Nº {a.numero_autorizacion}</div>}
                    {a.fecha_emision && <div className="text-xs text-slate-500">Emitida: {new Date(a.fecha_emision).toLocaleDateString("es-ES")}</div>}
                    {a.notas && <div className="text-xs text-slate-400 mt-0.5">{a.notas}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <BadgeCaducidad fecha={a.fecha_caducidad} />
                    <button onClick={() => eliminarAut(a.id)} className="text-xs text-red-400 hover:text-red-300">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Formación */}
      {tabActiva === 4 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">{formaciones.length} cursos</h2>
            <button onClick={() => setModalForm(true)}
              className="rounded-xl bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500">
              + Añadir formación
            </button>
          </div>
          {formaciones.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">Sin registros de formación.</div>
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800 divide-y divide-slate-700">
              {formaciones.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="font-medium text-sm">{f.nombre_curso}</div>
                    <div className="text-xs text-slate-500">
                      {f.entidad_formadora ?? ""}
                      {f.horas ? ` · ${f.horas}h` : ""}
                      {f.fecha_inicio ? ` · ${new Date(f.fecha_inicio).toLocaleDateString("es-ES")}` : ""}
                    </div>
                    {f.notas && <div className="text-xs text-slate-400 mt-0.5">{f.notas}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      f.resultado === "superado" ? "bg-green-100 text-green-700"
                      : f.resultado === "no_superado" ? "bg-red-500/20 text-red-300"
                      : "bg-slate-700 text-slate-300"
                    }`}>{f.resultado}</span>
                    <BadgeCaducidad fecha={f.fecha_caducidad} />
                    <button onClick={() => eliminarForm(f.id)} className="text-xs text-red-400 hover:text-red-300">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Vestuario */}
      {tabActiva === 5 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-4 max-w-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-200">Tallas de vestuario</h2>
            {vestuarioId && <span className="text-xs text-slate-500">Última actualización guardada</span>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "camiseta",  label: "Camiseta",  placeholder: "S, M, L, XL..." },
              { key: "camisa",    label: "Camisa",    placeholder: "S, M, L, XL..." },
              { key: "pantalon",  label: "Pantalón",  placeholder: "38, 40, 42..." },
              { key: "calzado",   label: "Calzado",   placeholder: "40, 41, 42..." },
              { key: "chaqueta",  label: "Chaqueta",  placeholder: "S, M, L, XL..." },
              { key: "sudadera",  label: "Sudadera",  placeholder: "S, M, L, XL..." },
              { key: "chaleco",   label: "Chaleco",   placeholder: "S, M, L, XL..." },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-xs font-medium text-slate-400">{label}</label>
                <input
                  value={(formVest as any)[key]}
                  onChange={(e) => setFormVest({ ...formVest, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400">Observaciones</label>
            <textarea
              value={formVest.observaciones}
              onChange={(e) => setFormVest({ ...formVest, observaciones: e.target.value })}
              placeholder="Alergias a materiales, preferencias especiales..."
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
          </div>

          <button
            onClick={guardarVestuario}
            disabled={guardandoVest}
            className="rounded-xl bg-slate-800 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
            {guardandoVest ? "Guardando..." : "Guardar tallas"}
          </button>
        </div>
      )}

      {/* Modal: Competencia */}
      {modalComp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-slate-800 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Añadir competencia</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-slate-300">Competencia *</label>
                <select value={formComp.competencia_id} onChange={(e) => setFormComp({ ...formComp, competencia_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500">
                  <option value="">Seleccionar...</option>
                  {catCompetencias.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.categoria})</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-slate-300">Nivel</label>
                <select value={formComp.nivel} onChange={(e) => setFormComp({ ...formComp, nivel: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500">
                  {["basico", "medio", "avanzado", "experto"].map((n) => <option key={n} value={n}>{n}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-slate-300">Notas</label>
                <input value={formComp.notas} onChange={(e) => setFormComp({ ...formComp, notas: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setModalComp(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={addCompetencia} disabled={guardando}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {guardando ? "Guardando..." : "Añadir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Certificación */}
      {modalCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-slate-800 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Añadir certificación</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-slate-300">Nombre *</label>
                <input value={formCert.nombre} onChange={(e) => setFormCert({ ...formCert, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" placeholder="PRL Nivel Básico, ISO 9001..." /></div>
              <div><label className="text-xs font-medium text-slate-300">Entidad emisora</label>
                <input value={formCert.entidad_emisora} onChange={(e) => setFormCert({ ...formCert, entidad_emisora: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-slate-300">Fecha obtención</label>
                  <input type="date" value={formCert.fecha_obtencion} onChange={(e) => setFormCert({ ...formCert, fecha_obtencion: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs font-medium text-slate-300">Fecha caducidad</label>
                  <input type="date" value={formCert.fecha_caducidad} onChange={(e) => setFormCert({ ...formCert, fecha_caducidad: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>
              <div><label className="text-xs font-medium text-slate-300">Nº certificado</label>
                <input value={formCert.numero_certificado} onChange={(e) => setFormCert({ ...formCert, numero_certificado: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setModalCert(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={addCertificacion} disabled={guardando}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {guardando ? "Guardando..." : "Añadir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Autorización */}
      {modalAut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-slate-800 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Añadir autorización</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-slate-300">Autorización *</label>
                <select value={formAut.autorizacion_id} onChange={(e) => setFormAut({ ...formAut, autorizacion_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500">
                  <option value="">Seleccionar...</option>
                  {catAutorizaciones.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-slate-300">Fecha emisión</label>
                  <input type="date" value={formAut.fecha_emision} onChange={(e) => setFormAut({ ...formAut, fecha_emision: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs font-medium text-slate-300">Fecha caducidad</label>
                  <input type="date" value={formAut.fecha_caducidad} onChange={(e) => setFormAut({ ...formAut, fecha_caducidad: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>
              <div><label className="text-xs font-medium text-slate-300">Nº autorización</label>
                <input value={formAut.numero_autorizacion} onChange={(e) => setFormAut({ ...formAut, numero_autorizacion: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
              <div><label className="text-xs font-medium text-slate-300">Notas</label>
                <input value={formAut.notas} onChange={(e) => setFormAut({ ...formAut, notas: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setModalAut(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={addAutorizacion} disabled={guardando}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {guardando ? "Guardando..." : "Añadir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Formación */}
      {modalForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-slate-800 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Añadir formación</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-slate-300">Nombre del curso *</label>
                <input value={formForm.nombre_curso} onChange={(e) => setFormForm({ ...formForm, nombre_curso: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
              <div><label className="text-xs font-medium text-slate-300">Entidad formadora</label>
                <input value={formForm.entidad_formadora} onChange={(e) => setFormForm({ ...formForm, entidad_formadora: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs font-medium text-slate-300">Inicio</label>
                  <input type="date" value={formForm.fecha_inicio} onChange={(e) => setFormForm({ ...formForm, fecha_inicio: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs font-medium text-slate-300">Fin</label>
                  <input type="date" value={formForm.fecha_fin} onChange={(e) => setFormForm({ ...formForm, fecha_fin: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs font-medium text-slate-300">Horas</label>
                  <input type="number" value={formForm.horas} onChange={(e) => setFormForm({ ...formForm, horas: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-slate-300">Resultado</label>
                  <select value={formForm.resultado} onChange={(e) => setFormForm({ ...formForm, resultado: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="superado">Superado</option>
                    <option value="no_superado">No superado</option>
                    <option value="en_progreso">En progreso</option>
                  </select></div>
                <div><label className="text-xs font-medium text-slate-300">Caducidad</label>
                  <input type="date" value={formForm.fecha_caducidad} onChange={(e) => setFormForm({ ...formForm, fecha_caducidad: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
              </div>
              <div><label className="text-xs font-medium text-slate-300">Notas</label>
                <input value={formForm.notas} onChange={(e) => setFormForm({ ...formForm, notas: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setModalForm(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={addFormacion} disabled={guardando}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {guardando ? "Guardando..." : "Añadir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </CoreLayout>
  );
}
