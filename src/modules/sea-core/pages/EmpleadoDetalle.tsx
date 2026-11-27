import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CoreLayout from "../layouts/CoreLayout";
import { supabase } from "../../almacen-neumaticos/services/supabase";
import { apiFetch } from "../../apiFetch";
import FotoEmpleado from "../components/FotoEmpleado";
import { Bike, Bus, Car, Caravan, Truck } from "lucide-react";
import AccesoEmpleado from "../components/AccesoEmpleado";
import HorarioEmpleado from "../components/HorarioEmpleado";
import NominasEmpleado from "../components/NominasEmpleado";
import { useEsSuperadmin } from "../../esSuperadmin";

type Empleado = {
  id: string; nombre: string; apellidos: string | null;
  dni_nie: string | null; num_seguridad_social: string | null;
  dni_caducidad: string | null;
  /** El carnet de conducir: lo teclea el trabajador o se pasa de lo que lee la IA. */
  carnet_numero?: string | null; carnet_clases?: string | null; carnet_caducidad?: string | null;
  cap_numero?: string | null; cap_caducidad?: string | null;
  direccion: string | null; codigo_postal: string | null;
  poblacion: string | null; provincia: string | null;
  telefono: string | null; email: string | null;
  cargo: string | null; departamento: string | null; rol: string;
  codigo_operario: string | null; activo: boolean; fecha_alta: string | null;
  company_id: string | null; work_center_id: string | null;
  sea_companies: { nombre: string } | null;
  sea_work_centers: { nombre: string } | null;
};

const TABS = ["Datos personales", "Competencias", "Certificaciones", "Autorizaciones", "Formación", "Vestuario", "Documentación", "Acceso"];
// Solo el superadministrador ve y edita el horario; va al final para no mover el resto.
const TAB_HORARIO = TABS.length;
// Las nóminas, igual: solo el superadministrador, y detrás del horario.
const TAB_NOMINAS = TABS.length + 1;

const ROL_BADGE: Record<string, string> = {
  admin: "bg-red-500/20 text-red-800", responsable: "bg-orange-100 text-orange-800",
  operario: "bg-blue-100 text-blue-800", prl: "bg-purple-100 text-purple-800",
  almacen: "bg-green-100 text-green-800",
};

/**
 * Lo que el servidor cuenta de la ficha que rellenó el propio trabajador.
 *
 * Viene de `/api/core/alta/:id`, que es de administradores: si la llamada no
 * pasa, esta pantalla simplemente no enseña nada de esto. La documentación de
 * alguien no es algo que se deje a medio esconder en una pestaña por si acaso.
 */
type Revision = {
  estadoAlta: string;
  invitacion: {
    estado: string; motivo: string; enviadoAt: string | null; abiertoAt: string | null;
    recibidaAt: string | null; caducaAt: string | null; firmadoAt: string | null;
    verificadoAt: string | null;
    leidoAt: string | null;
  } | null;
  documentos: Array<{
    tipo: string;
    /** La limpia si salió; si no, la original. */
    url: string | null;
    urlOriginal: string | null;
    recortada: boolean;
    recorteNota: string | null;
    subidoAt: string;
    bytes: number | null;
  }>;
  firma: string | null;
  verificacion: { campos: Array<{ campo: string; tecleado: string | null; leido: string | null; veredicto: string; nota: string }>; resumen: string } | null;
  lectura: {
    identidad: { numero: string | null; caducidad: string | null; nota: string };
    carnet: {
      numero: string | null; caducidad: string | null;
      clases: Array<{ clase: string; caducidad: string | null }>;
      capNumero: string | null; capCaducidad: string | null; nota: string;
    };
  } | null;
  /** De cuándo es esa lectura, y si es de un envío anterior al último. */
  lecturaDe?: { leidoAt: string | null; deEnvioAnterior: boolean } | null;
  certificacionesPropuestas: Array<{ nombre: string; caducidad: string; numero: string | null }>;
  consentimientos: Array<{ tipo: string; aceptado: boolean; fecha: string | null }>;
  puedeVerificar: boolean;
};

const DOC_LABEL: Record<string, string> = {
  dni_anverso: "DNI · delante",
  dni_reverso: "DNI · detrás",
  carnet_anverso: "Carnet · delante",
  carnet_reverso: "Carnet · detrás",
};

const VEREDICTO: Record<string, { label: string; clase: string }> = {
  coincide:    { label: "Cuadra",     clase: "bg-green-500/20 text-green-300" },
  no_coincide: { label: "No cuadra",  clase: "bg-red-500/20 text-red-300" },
  ilegible:    { label: "No se lee",  clase: "bg-amber-500/20 text-amber-300" },
};

/**
 * El vehículo de cada clase del permiso.
 *
 * Una lista de «AM A1 A2 A B C1 C» no dice nada a quien no se las sabe de
 * memoria, y quien revisa una ficha normalmente no se las sabe: lo que
 * necesita ver de un vistazo es si el tío puede llevar el camión.
 *
 * La letra final E significa «con remolque» en todas (BE, C1E, CE, D1E, DE),
 * así que se dibuja el vehículo más el remolque en vez de inventar un icono
 * por cada combinación.
 */
function IconoClase({ clase }: { clase: string }) {
  const limpia = clase.toUpperCase().replace(/[\s+]/g, "");
  const conRemolque = limpia.length > 1 && limpia.endsWith("E");
  const base = conRemolque ? limpia.slice(0, -1) : limpia;

  const porLetra: Record<string, { Icono: typeof Car; que: string }> = {
    A: { Icono: Bike, que: limpia === "AM" ? "Ciclomotor" : "Motocicleta" },
    B: { Icono: Car, que: "Turismo" },
    C: { Icono: Truck, que: "Camión" },
    D: { Icono: Bus, que: "Autobús" },
  };
  const elegido = porLetra[base.charAt(0)];
  if (!elegido) return null;

  const { Icono, que } = elegido;
  const etiqueta = conRemolque ? `${que} con remolque` : que;
  return (
    <span className="flex items-center gap-1 text-slate-300" title={etiqueta}>
      <Icono className="h-4 w-4" role="img" aria-label={etiqueta} />
      {conRemolque && <Caravan className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}
    </span>
  );
}

const CONSENT_LABEL: Record<string, string> = {
  normativa_interna: "Normativa interna",
  whatsapp: "Avisos por WhatsApp",
  proteccion_datos: "Tratamiento de datos",
};

const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";

const NIVEL_BADGE: Record<string, string> = {
  basico: "bg-slate-700 text-slate-200", medio: "bg-blue-100 text-blue-700",
  avanzado: "bg-purple-100 text-purple-700", experto: "bg-orange-100 text-orange-700",
};

function direccionCompleta(e: { direccion: string | null; codigo_postal: string | null; poblacion: string | null; provincia: string | null }) {
  const localidad = [e.codigo_postal, e.poblacion].filter(Boolean).join(" ");
  const partes = [e.direccion, localidad, e.provincia].filter((x) => x && String(x).trim());
  return partes.length ? partes.join(" · ") : null;
}

export default function EmpleadoDetalle() {
  const { id } = useParams<{ id: string }>();
  const [empleado, setEmpleado] = useState<Empleado | null>(null);
  const [tabActiva, setTabActiva] = useState(0);
  const [cargando, setCargando] = useState(true);

  // Revisión del alta (solo administradores; si no, se queda en null).
  const [revision, setRevision] = useState<Revision | null>(null);
  const [accion, setAccion] = useState<"" | "aprobando" | "verificando" | "corrigiendo" | "recortando" | "leyendo" | "aplicando" | "subiendo">("");
  const [revMensaje, setRevMensaje] = useState("");
  const [revError, setRevError] = useState("");
  const esSuperadmin = useEsSuperadmin();
  const tabs = esSuperadmin ? [...TABS, "Horario", "Nóminas"] : TABS;

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

  // PIN de las APKs de operario (Presencia, Safety, ToolControl)
  const [tienePin, setTienePin] = useState<boolean | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinGuardando, setPinGuardando] = useState(false);
  const [pinMensaje, setPinMensaje] = useState("");

  // Número de trabajador (único por empresa). Lo guarda el servidor, que es
  // quien comprueba que no se repite y que quien lo cambia es administrador.
  const [numeroInput, setNumeroInput] = useState("");
  const [numeroGuardando, setNumeroGuardando] = useState(false);
  const [numeroMensaje, setNumeroMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  // La foto: en la ficha hay la ruta; la dirección (firmada) la da el servidor.
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    apiFetch("/api/core/empleados/fotos")
      .then((r) => (r.ok ? r.json() : { fotos: {} }))
      .then((d: { fotos?: Record<string, string> }) => { if (vivo) setFotoUrl(d.fotos?.[id] ?? null); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [id]);

  // Teléfono de empresa: el que enseñan los módulos (el otro es el personal).
  const [telEmpresaInput, setTelEmpresaInput] = useState("");
  const [telEmpresaGuardando, setTelEmpresaGuardando] = useState(false);
  const [telEmpresaMensaje, setTelEmpresaMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => { if (id) cargar(id); }, [id]);

  async function guardarTelefonoEmpresa() {
    if (!id) return;
    setTelEmpresaGuardando(true);
    setTelEmpresaMensaje(null);
    try {
      const r = await apiFetch(`/api/core/empleados/${id}/telefono-empresa`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefonoEmpresa: telEmpresaInput }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTelEmpresaMensaje({ ok: false, texto: d?.error || "No se ha podido guardar el teléfono." });
        return;
      }
      setEmpleado((e: any) => (e ? { ...e, telefono_empresa: d.telefonoEmpresa } : e));
      setTelEmpresaInput(d.telefonoEmpresa ?? "");
      setTelEmpresaMensaje({ ok: true, texto: d.telefonoEmpresa ? "Teléfono guardado." : "Teléfono quitado." });
    } catch {
      setTelEmpresaMensaje({ ok: false, texto: "No se ha podido guardar el teléfono." });
    } finally {
      setTelEmpresaGuardando(false);
    }
  }

  async function guardarNumero() {
    if (!id) return;
    setNumeroGuardando(true);
    setNumeroMensaje(null);
    try {
      const r = await apiFetch(`/api/core/empleados/${id}/numero-trabajador`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeroTrabajador: numeroInput }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNumeroMensaje({ ok: false, texto: d?.error || "No se ha podido guardar el número." });
        return;
      }
      setEmpleado((e: any) => (e ? { ...e, numero_trabajador: d.numeroTrabajador } : e));
      setNumeroInput(d.numeroTrabajador ?? "");
      setNumeroMensaje({ ok: true, texto: d.numeroTrabajador ? "Número guardado." : "Número quitado." });
    } catch {
      setNumeroMensaje({ ok: false, texto: "No se ha podido guardar el número." });
    } finally {
      setNumeroGuardando(false);
    }
  }

  async function cargarEstadoPin(empId: string) {
    try {
      const res = await apiFetch("/api/sea-core/employees/pin-status");
      if (!res.ok) { setTienePin(null); return; }
      const lista = (await res.json()) as { id: string; tienePin: boolean }[];
      const fila = lista.find((e) => e.id === empId);
      setTienePin(fila ? fila.tienePin : false);
    } catch {
      setTienePin(null);
    }
  }

  async function guardarPin(revocar = false) {
    if (!id) return;
    const pin = revocar ? "" : pinInput.trim();
    if (!revocar && !/^\d{4,8}$/.test(pin)) {
      setPinMensaje("El PIN debe tener entre 4 y 8 dígitos.");
      return;
    }
    setPinGuardando(true);
    setPinMensaje("");
    try {
      const res = await apiFetch(`/api/sea-core/employees/${id}/pin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPinMensaje(data?.error || "No se pudo guardar el PIN.");
        return;
      }
      setTienePin(Boolean(pin));
      setPinInput("");
      setPinMensaje(revocar ? "Acceso revocado." : "PIN asignado.");
    } catch {
      setPinMensaje("No se pudo guardar el PIN.");
    } finally {
      setPinGuardando(false);
    }
  }

  /**
   * La revisión del alta. Va con el resto de la carga de la ficha y no en un
   * efecto aparte: es un dato más de esta pantalla, y así se refresca sola
   * cuando algo la recarga.
   */
  async function cargarRevision(empId: string) {
    try {
      const r = await apiFetch(`/api/core/alta/${empId}`);
      setRevision(r.ok ? await r.json() : null);
    } catch {
      setRevision(null);
    }
  }

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
    setNumeroInput((emp as any)?.numero_trabajador ?? "");
    setNumeroMensaje(null);
    setTelEmpresaInput((emp as any)?.telefono_empresa ?? "");
    setTelEmpresaMensaje(null);
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
    void cargarRevision(empId);
    setCargando(false);
    void cargarEstadoPin(empId);
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

  /** Lanza la comprobación de lo tecleado contra las fotos. */
  async function comprobarConIA() {
    if (!id) return;
    setAccion("verificando");
    setRevError("");
    try {
      const r = await apiFetch(`/api/core/alta/${id}/verificar`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido comprobar.");
      await cargarRevision(id);
      setRevMensaje("Comprobación hecha.");
      setTimeout(() => setRevMensaje(""), 4000);
    } catch (e) {
      setRevError(e instanceof Error ? e.message : "No se ha podido comprobar.");
    } finally {
      setAccion("");
    }
  }

  /** Sube una foto desde aquí: el DNI que llega al mostrador en la mano. */
  async function subirDocumento(tipo: string, fichero: File) {
    if (!id) return;
    setAccion("subiendo");
    setRevError("");
    try {
      const cuerpo = new FormData();
      cuerpo.append("tipo", tipo);
      cuerpo.append("foto", fichero);
      const r = await apiFetch(`/api/core/alta/${id}/documento`, { method: "POST", body: cuerpo });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido subir la foto.");
      await cargarRevision(id);
      setRevMensaje("Foto subida.");
      setTimeout(() => setRevMensaje(""), 4000);
    } catch (e) {
      setRevError(e instanceof Error ? e.message : "No se ha podido subir la foto.");
    } finally {
      setAccion("");
    }
  }

  /** Le pide a la IA que lea los documentos: carnets, clases y caducidades. */
  async function leerDocumentacion() {
    if (!id) return;
    setAccion("leyendo");
    setRevError("");
    try {
      const r = await apiFetch(`/api/core/alta/${id}/leer`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido leer.");
      await cargarRevision(id);
      setRevMensaje("Documentación leída. Repásala antes de pasarla a la ficha.");
      setTimeout(() => setRevMensaje(""), 5000);
    } catch (e) {
      setRevError(e instanceof Error ? e.message : "No se ha podido leer.");
    } finally {
      setAccion("");
    }
  }

  /** Lo leído pasa a la ficha y a Certificaciones. Lo decide quien revisa. */
  async function aplicarLectura() {
    if (!id) return;
    setAccion("aplicando");
    setRevError("");
    try {
      const r = await apiFetch(`/api/core/alta/${id}/aplicar-lectura`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido pasar a la ficha.");
      await Promise.all([cargarRevision(id), cargar(id)]);
      setRevMensaje(
        d.certificaciones?.length
          ? `Ficha actualizada. Anotado en Certificaciones: ${d.certificaciones.join(", ")}.`
          : "Ficha actualizada con lo leído."
      );
      setTimeout(() => setRevMensaje(""), 7000);
    } catch (e) {
      setRevError(e instanceof Error ? e.message : "No se ha podido pasar a la ficha.");
    } finally {
      setAccion("");
    }
  }

  /** Vuelve a intentar el recorte de una foto concreta. */
  async function recortarOtraVez(tipo: string) {
    if (!id) return;
    setAccion("recortando");
    setRevError("");
    try {
      const r = await apiFetch(`/api/core/alta/${id}/documento/${tipo}/recortar`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido recortar.");
      await cargarRevision(id);
      setRevMensaje(d.recortado ? "Foto recortada." : "No se ha encontrado el documento en la foto; se queda la original.");
      setTimeout(() => setRevMensaje(""), 5000);
    } catch (e) {
      setRevError(e instanceof Error ? e.message : "No se ha podido recortar.");
    } finally {
      setAccion("");
    }
  }

  async function aprobarFicha() {
    if (!id) return;
    setAccion("aprobando");
    setRevError("");
    try {
      const r = await apiFetch(`/api/core/alta/${id}/aprobar`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido aprobar.");
      await Promise.all([cargarRevision(id), cargar(id)]);
      setRevMensaje(
        d.certificaciones?.length
          ? `Ficha aprobada. Anotado en Certificaciones: ${d.certificaciones.join(", ")}.`
          : "Ficha aprobada. El empleado queda activo."
      );
      setTimeout(() => setRevMensaje(""), 6000);
    } catch (e) {
      setRevError(e instanceof Error ? e.message : "No se ha podido aprobar.");
    } finally {
      setAccion("");
    }
  }

  /** Le devuelve el enlace con una nota de qué hay que corregir. */
  async function pedirCorreccion() {
    if (!id) return;
    const nota = prompt("¿Qué tiene que corregir? (se le manda en el SMS)", "");
    if (nota === null) return;
    setAccion("corrigiendo");
    setRevError("");
    try {
      const r = await apiFetch("/api/core/alta/invitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: id, motivo: "actualizacion", nota }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido mandar el SMS.");
      await Promise.all([cargarRevision(id), cargar(id)]);
      setRevMensaje("Enlace reenviado con tu nota. Caduca en 72 horas.");
      setTimeout(() => setRevMensaje(""), 6000);
    } catch (e) {
      setRevError(e instanceof Error ? e.message : "No se ha podido mandar el SMS.");
    } finally {
      setAccion("");
    }
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
        fila("Nº Seguridad Social", empleado!.num_seguridad_social),
        fila("Dirección", direccionCompleta(empleado!)),
        fila("Email", empleado!.email),
        fila("Teléfono de empresa", (empleado as any).telefono_empresa),
        fila("Teléfono personal", empleado!.telefono),
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
        <FotoEmpleado
          employeeId={empleado.id}
          nombre={empleado.nombre}
          url={fotoUrl}
          onCambio={setFotoUrl}
          enColumna
        />
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
          <Link to="/core/empleados" className="text-sm text-slate-400 hover:text-slate-200">← Volver</Link>
        </div>
      </div>

      {revMensaje && (
        <p className="rounded-lg border border-green-800 bg-green-900/30 p-3 text-sm text-green-200">{revMensaje}</p>
      )}
      {revError && (
        <p className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">{revError}</p>
      )}

      {revision?.estadoAlta === "recibida" && (
        <div className="rounded-xl border border-amber-700 bg-amber-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-amber-100">
            <b>La ha rellenado el propio trabajador</b> y está pendiente de revisar.
            <span className="text-amber-200/70">
              {" "}Enviada el {fechaHora(revision.invitacion?.recibidaAt)}. Mira la pestaña Documentación antes de aprobar.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {revision.puedeVerificar && (
              <button onClick={() => void comprobarConIA()} disabled={accion !== ""}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700/50 disabled:opacity-50">
                {accion === "verificando" ? "Comprobando…" : "Comprobar con IA"}
              </button>
            )}
            <button onClick={() => void pedirCorreccion()} disabled={accion !== ""}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700/50 disabled:opacity-50">
              {accion === "corrigiendo" ? "Enviando…" : "Pedirle que corrija"}
            </button>
            <button onClick={() => void aprobarFicha()} disabled={accion !== ""}
              className="rounded-lg bg-green-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-green-600 disabled:opacity-50">
              {accion === "aprobando" ? "Aprobando…" : "Aprobar y activar"}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-700 flex gap-0 overflow-x-auto">
        {tabs.map((tab, i) => (
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
              { label: "Nº Seguridad Social", value: empleado.num_seguridad_social },
              { label: "El DNI caduca el", value: empleado.dni_caducidad
                ? new Date(empleado.dni_caducidad).toLocaleDateString("es-ES") : null },
              { label: "Carnet de conducir", value: empleado.carnet_numero ?? null },
              { label: "Clases del carnet", value: empleado.carnet_clases ?? null },
              { label: "El carnet caduca el", value: empleado.carnet_caducidad
                ? new Date(empleado.carnet_caducidad).toLocaleDateString("es-ES") : null },
              // El CAP solo lo tiene quien lleva camión o autobús: sin él, ni se enseña.
              ...(empleado.cap_numero || empleado.cap_caducidad
                ? [{
                    label: "CAP",
                    value: [
                      empleado.cap_numero,
                      empleado.cap_caducidad ? `caduca el ${new Date(empleado.cap_caducidad).toLocaleDateString("es-ES")}` : null,
                    ].filter(Boolean).join(" · "),
                  }]
                : []),
              { label: "Dirección", value: direccionCompleta(empleado) },
              { label: "Email", value: empleado.email },
              ...("telefono_empresa" in (empleado as any)
                ? [{ label: "Teléfono de empresa", value: (empleado as any).telefono_empresa }]
                : []),
              { label: "Teléfono personal", value: empleado.telefono },
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

          {/*
            * Solo sale cuando la columna existe: hasta que se ejecuta
            * core_numero_trabajador.sql, `select("*")` no la trae.
            */}
          {"numero_trabajador" in (empleado as any) && (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3 md:col-span-2">
              <div>
                <h2 className="font-semibold text-slate-200">Número de trabajador</h2>
                <p className="text-xs text-slate-400">
                  Número interno de la empresa. No se puede repetir dentro de la misma empresa; sirve para
                  reconocer a esta persona en el resto de módulos.
                </p>
              </div>
              {!empleado.company_id ? (
                <p className="text-sm text-amber-300">Asígnale una empresa antes de darle número: el número es por empresa.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input value={numeroInput} onChange={(e) => setNumeroInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void guardarNumero(); }}
                    maxLength={20} placeholder="Ej. 015"
                    className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-sm" />
                  <button onClick={() => void guardarNumero()}
                    disabled={numeroGuardando || numeroInput.trim().toUpperCase() === ((empleado as any).numero_trabajador ?? "")}
                    className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50">
                    {numeroGuardando ? "Guardando…" : "Guardar número"}
                  </button>
                </div>
              )}
              {numeroMensaje && (
                <p className={`text-sm ${numeroMensaje.ok ? "text-green-300" : "text-red-300"}`}>{numeroMensaje.texto}</p>
              )}
            </div>
          )}

          {/* Igual que el número: solo cuando core_telefono_empresa.sql está ejecutada. */}
          {"telefono_empresa" in (empleado as any) && (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3 md:col-span-2">
              <div>
                <h2 className="font-semibold text-slate-200">Teléfono de empresa</h2>
                <p className="text-xs text-slate-400">
                  El móvil o la extensión que la empresa le ha asignado, si tiene. Es el que ven los módulos
                  (en Taller, también el cliente al seguir una asistencia). El personal no se enseña a los clientes.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={telEmpresaInput} onChange={(e) => setTelEmpresaInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void guardarTelefonoEmpresa(); }}
                  type="tel" maxLength={24} placeholder="6XX XXX XXX"
                  className="w-48 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm" />
                <button onClick={() => void guardarTelefonoEmpresa()}
                  disabled={telEmpresaGuardando || telEmpresaInput.replace(/[\s.()-]/g, "") === ((empleado as any).telefono_empresa ?? "")}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50">
                  {telEmpresaGuardando ? "Guardando…" : "Guardar teléfono"}
                </button>
              </div>
              {telEmpresaMensaje && (
                <p className={`text-sm ${telEmpresaMensaje.ok ? "text-green-300" : "text-red-300"}`}>{telEmpresaMensaje.texto}</p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3 md:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-200">PIN de las apps de operario</h2>
              {tienePin === null ? null : tienePin ? (
                <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                  PIN asignado
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  Sin PIN — no puede entrar
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Da acceso a Presencia, Safety y ToolControl. El PIN no se puede consultar,
              solo asignar uno nuevo. Comunícaselo al empleado en persona.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                placeholder="Nuevo PIN (4-8 dígitos)"
                className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
              <button
                onClick={() => void guardarPin(false)}
                disabled={pinGuardando}
                className="rounded-xl bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {pinGuardando ? "Guardando…" : tienePin ? "Cambiar PIN" : "Asignar PIN"}
              </button>
              {tienePin && (
                <button
                  onClick={() => void guardarPin(true)}
                  disabled={pinGuardando}
                  className="rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Revocar acceso
                </button>
              )}
            </div>
            {pinMensaje && <div className="text-sm text-slate-300">{pinMensaje}</div>}
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
      {/* Tab: Documentación */}
      {tabActiva === 6 && (
        <div className="space-y-4">
          {!revision ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 text-sm text-slate-400">
              La documentación personal solo la ve un administrador.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-slate-200">Lo que ha subido</h2>
                  <span className="text-xs text-slate-500">
                    Se enseña la versión recortada y enderezada; la original se guarda entera.
                    Los enlaces caducan en una hora: esto no vive en una URL pública.
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.keys(DOC_LABEL)
                    .filter((tipo) => !revision.documentos.some((d) => d.tipo === tipo))
                    .map((tipo) => (
                      <label key={tipo}
                        className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-600 bg-slate-900 p-2 text-center hover:border-sky-600"
                        style={{ minHeight: 190 }}>
                        <span className="text-xs font-semibold text-slate-300">{DOC_LABEL[tipo]}</span>
                        <span className="text-[11px] text-slate-500">
                          {accion === "subiendo" ? "Subiendo…" : "Falta. Toca para subirla tú."}
                        </span>
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void subirDocumento(tipo, f);
                            e.target.value = "";
                          }} />
                      </label>
                    ))}
                  {revision.documentos.map((d) => (
                    <div key={d.tipo} className="rounded-xl border border-slate-700 bg-slate-900 p-2">
                      <a href={d.url ?? undefined} target="_blank" rel="noreferrer" className="group block">
                        {d.url ? (
                          <img src={d.url} alt={DOC_LABEL[d.tipo] ?? d.tipo}
                            className="h-36 w-full rounded-lg bg-slate-950 object-contain" />
                        ) : (
                          <div className="flex h-36 items-center justify-center rounded-lg bg-slate-800 text-xs text-slate-500">
                            No se ha podido abrir
                          </div>
                        )}
                        <div className="mt-2 text-xs font-semibold text-slate-200 group-hover:text-sky-400">
                          {DOC_LABEL[d.tipo] ?? d.tipo}
                        </div>
                      </a>
                      <div className="text-[11px] text-slate-500">{fechaHora(d.subidoAt)}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={d.recortada ? "text-green-400" : "text-amber-300"}>
                          {d.recortada ? "Recortada" : "Sin recortar"}
                        </span>
                        {d.recortada && d.urlOriginal && (
                          <a href={d.urlOriginal} target="_blank" rel="noreferrer"
                            className="text-slate-400 underline hover:text-slate-200">ver original</a>
                        )}
                        {revision.puedeVerificar && (
                          <button onClick={() => void recortarOtraVez(d.tipo)} disabled={accion !== ""}
                            className="text-sky-400 underline hover:text-sky-300 disabled:opacity-50">
                            {accion === "recortando" ? "recortando…" : "recortar otra vez"}
                          </button>
                        )}
                        <label className="cursor-pointer text-slate-400 underline hover:text-slate-200">
                          cambiar foto
                          <input type="file" accept="image/*" className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void subirDocumento(d.tipo, f);
                              e.target.value = "";
                            }} />
                        </label>
                      </div>
                      {!d.recortada && d.recorteNota && (
                        <div className="mt-1 text-[11px] text-slate-500">{d.recorteNota}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-slate-200">Lo que dice la documentación</h2>
                  {revision.puedeVerificar && (
                    <div className="flex gap-2">
                      <button onClick={() => void leerDocumentacion()} disabled={accion !== ""}
                        className="rounded-lg border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700/50 disabled:opacity-50">
                        {accion === "leyendo" ? "Leyendo…" : revision.lectura ? "Volver a leer" : "Leer documentación"}
                      </button>
                      {revision.lectura && (
                        <button onClick={() => void aplicarLectura()} disabled={accion !== ""}
                          className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                          {accion === "aplicando" ? "Pasando…" : "Pasar a la ficha"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {!revision.lectura ? (
                  <p className="text-sm leading-6 text-slate-400">
                    Sin leer. La IA saca de las fotos el número y la caducidad del DNI, y del carnet
                    las clases que tiene <b className="text-slate-300">con la fecha de cada una</b>.
                    Se lee sola cuando el trabajador envía la ficha; si en un minuto no aparece aquí,
                    pulsa «Leer documentación». A la ficha pasa cuando tú le des al botón.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Documento de identidad</h3>
                      <div className="flex justify-between border-b border-slate-700 pb-2 text-sm">
                        <span className="text-slate-400">Número</span>
                        <span className="font-medium">{revision.lectura.identidad.numero ?? "—"}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-700 pb-2 text-sm">
                        <span className="text-slate-400">Caduca el</span>
                        <span className="font-medium">{revision.lectura.identidad.caducidad ?? "—"}</span>
                      </div>
                      {revision.lectura.identidad.nota && (
                        <p className="text-[11px] text-slate-500">{revision.lectura.identidad.nota}</p>
                      )}
                      <p className="pt-2 text-[11px] text-slate-500">
                        Leído el {fechaHora(revision.lecturaDe?.leidoAt ?? revision.invitacion?.leidoAt)}
                      </p>
                      {revision.lecturaDe?.deEnvioAnterior && (
                        <p className="rounded-lg border border-amber-800 bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-200">
                          Es la lectura de un envío anterior: después se le mandó otro enlace. Si ha cambiado
                          alguna foto, pulsa «Volver a leer».
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Permiso de conducción</h3>
                      <div className="flex justify-between border-b border-slate-700 pb-2 text-sm">
                        <span className="text-slate-400">Número</span>
                        <span className="font-medium">{revision.lectura.carnet.numero ?? "—"}</span>
                      </div>
                      {revision.lectura.carnet.clases.length === 0 ? (
                        <p className="text-sm text-slate-500">No se ha leído ninguna clase.</p>
                      ) : (
                        revision.lectura.carnet.clases.map((c) => (
                          <div key={c.clase} className="flex items-center justify-between border-b border-slate-700 pb-2 text-sm">
                            <span className="flex items-center gap-2">
                              <IconoClase clase={c.clase} />
                              <span className="rounded bg-slate-700 px-2 py-0.5 font-mono text-xs text-slate-200">{c.clase}</span>
                            </span>
                            <span className={c.caducidad ? "font-medium" : "text-amber-300"}>
                              {c.caducidad ?? "sin fecha"}
                            </span>
                          </div>
                        ))
                      )}
                      {revision.lectura.carnet.capCaducidad && (
                        <div className="flex justify-between border-b border-slate-700 pb-2 text-sm">
                          <span className="text-slate-400">CAP</span>
                          <span className="font-medium">{revision.lectura.carnet.capCaducidad}</span>
                        </div>
                      )}
                      {revision.lectura.carnet.nota && (
                        <p className="text-[11px] text-slate-500">{revision.lectura.carnet.nota}</p>
                      )}
                    </div>
                  </div>
                )}

                {revision.certificacionesPropuestas.length > 0 && (
                  <p className="text-xs text-slate-400">
                    Al pasarlo a la ficha se anotarán en Certificaciones:{" "}
                    <b className="text-slate-200">
                      {revision.certificacionesPropuestas.map((c) => `${c.nombre} (${c.caducidad})`).join(", ")}
                    </b>
                    .
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3">
                  <h2 className="font-semibold text-slate-200">Firma y permisos</h2>
                  {revision.firma ? (
                    <img src={revision.firma} alt="Firma del empleado"
                      className="h-24 w-full rounded-lg bg-slate-50 object-contain p-2" />
                  ) : (
                    <p className="text-sm text-slate-500">Sin firma.</p>
                  )}
                  {revision.consentimientos.map((c, i) => (
                    <div key={`${c.tipo}-${i}`} className="flex justify-between border-b border-slate-700 pb-2 text-sm last:border-0">
                      <span className="text-slate-400">{CONSENT_LABEL[c.tipo] ?? c.tipo}</span>
                      <span className={c.aceptado ? "text-green-400" : "text-slate-500"}>
                        {c.aceptado ? `Aceptado · ${fechaHora(c.fecha)}` : "No aceptado"}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-semibold text-slate-200">Lo tecleado contra la foto</h2>
                    {revision.puedeVerificar && (
                      <button onClick={() => void comprobarConIA()} disabled={accion !== ""}
                        className="rounded-lg border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700/50 disabled:opacity-50">
                        {accion === "verificando" ? "Comprobando…" : revision.verificacion ? "Volver a comprobar" : "Comprobar con IA"}
                      </button>
                    )}
                  </div>
                  {!revision.verificacion ? (
                    <p className="text-sm leading-6 text-slate-400">
                      Todavía no se ha comprobado. La IA compara lo que escribió el trabajador con sus
                      fotos y marca lo que no cuadra; <b className="text-slate-300">no corrige nada</b>,
                      decide quien revisa.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">
                        Comprobado el {fechaHora(revision.invitacion?.verificadoAt)}
                      </p>
                      <div className="space-y-2">
                        {revision.verificacion.campos.map((c) => (
                          <div key={c.campo} className="border-b border-slate-700 pb-2 last:border-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-slate-300">{c.campo}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${VEREDICTO[c.veredicto]?.clase ?? "bg-slate-700 text-slate-300"}`}>
                                {VEREDICTO[c.veredicto]?.label ?? c.veredicto}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Tecleado: {c.tecleado ?? "—"}
                              {c.leido ? ` · En la foto: ${c.leido}` : ""}
                            </div>
                            {c.nota && <div className="text-[11px] text-slate-400">{c.nota}</div>}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400">{revision.verificacion.resumen}</p>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tabActiva === 7 && <AccesoEmpleado empleado={empleado} />}
      {tabActiva === TAB_HORARIO && esSuperadmin && empleado && (
        <HorarioEmpleado empleadoId={empleado.id} nombre={[empleado.nombre, empleado.apellidos].filter(Boolean).join(" ")} />
      )}

      {tabActiva === TAB_NOMINAS && esSuperadmin && empleado && (
        <NominasEmpleado employeeId={empleado.id} nombre={[empleado.nombre, empleado.apellidos].filter(Boolean).join(" ")} />
      )}

    </CoreLayout>
  );
}
