import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CoreLayout from "../layouts/CoreLayout";
import { supabase } from "../../almacen-neumaticos/services/supabase";
import { apiFetch } from "../../apiFetch";
import ImportarNominas from "../components/ImportarNominas";
import FotoEmpleado from "../components/FotoEmpleado";

type Empleado = {
  id: string;
  nombre: string;
  apellidos: string | null;
  dni_nie: string | null;
  num_seguridad_social: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  poblacion: string | null;
  provincia: string | null;
  telefono: string | null;
  email: string | null;
  cargo: string | null;
  departamento: string | null;
  rol: string;
  codigo_operario: string | null;
  activo: boolean;
  roadside_capable: boolean;
  fecha_alta: string | null;
  estado_alta: string | null;
  company_id: string | null;
  work_center_id: string | null;
  sea_companies: { nombre: string } | null;
  sea_work_centers: { nombre: string } | null;
};

const ROLES = ["admin", "responsable", "operario", "prl", "almacen"];

const ROL_BADGE: Record<string, string> = {
  admin:       "bg-red-500/20 text-red-800",
  responsable: "bg-orange-100 text-orange-800",
  operario:    "bg-blue-100 text-blue-800",
  prl:         "bg-purple-100 text-purple-800",
  almacen:     "bg-green-100 text-green-800",
};

/**
 * En qué punto está el alta que rellena el propio operario.
 *
 * `completa` no se pinta: es lo que tiene toda la plantilla de siempre, y un
 * distintivo que lleva todo el mundo no distingue nada.
 */
const ESTADO_ALTA: Record<string, { label: string; clase: string }> = {
  pendiente: { label: "Sin enlace",   clase: "bg-slate-700 text-slate-300" },
  enviado:   { label: "Enlace enviado", clase: "bg-sky-500/20 text-sky-300" },
  abierto:   { label: "Rellenando",   clase: "bg-sky-500/20 text-sky-300" },
  recibida:  { label: "Por revisar",  clase: "bg-amber-500/20 text-amber-300" },
  actualizando: { label: "Actualización pedida", clase: "bg-sky-500/20 text-sky-300" },
};

/**
 * ¿Llegó el SMS del enlace? Lo dice Twilio, y el servidor se lo pregunta.
 *
 * «Enlace enviado» solo quiere decir que Twilio aceptó el mensaje. Debajo va
 * lo que pasó después, que es lo que importa: si no llegó, no hay que esperar
 * a que el trabajador rellene nada.
 */
type Entrega = {
  estado: "en_camino" | "sin_confirmar" | "entregado" | "no_entregado";
  motivo: string | null;
  telefono: string;
  enviadoAt: string;
};

const ENTREGA: Record<Entrega["estado"], { label: string; clase: string; ayuda: string }> = {
  entregado:     { label: "SMS entregado",     clase: "bg-emerald-500/20 text-emerald-300", ayuda: "La operadora confirma que ha llegado al móvil." },
  en_camino:     { label: "SMS en camino",     clase: "bg-slate-700 text-slate-300",        ayuda: "Twilio lo ha aceptado; falta que la operadora confirme la entrega." },
  sin_confirmar: { label: "SMS sin confirmar", clase: "bg-amber-500/20 text-amber-300",     ayuda: "Hace más de 15 minutos que salió y la operadora no ha confirmado que haya llegado." },
  no_entregado:  { label: "SMS no entregado",  clase: "bg-red-500/20 text-red-300",         ayuda: "No ha llegado al móvil." },
};

const EMPTY = {
  nombre: "", apellidos: "", dni_nie: "", num_seguridad_social: "", telefono: "", email: "",
  direccion: "", codigo_postal: "", poblacion: "", provincia: "",
  cargo: "", departamento: "", rol: "operario", codigo_operario: "",
  fecha_alta: "", activo: true, roadside_capable: false, company_id: "", work_center_id: "",
  alta_por_enlace: false,
};

export default function Empleados() {
  const [items, setItems] = useState<Empleado[]>([]);
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [centros, setCentros] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroRol, setFiltroRol] = useState("");
  const [filtroCentro, setFiltroCentro] = useState("");
  const [filtroActivo, setFiltroActivo] = useState<"todos" | "activos" | "inactivos">("activos");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  /** Empleado al que se le está mandando el enlace. */
  const [enviando, setEnviando] = useState<string | null>(null);
  /**
   * Número de trabajador por empleado. Viene del servidor y no de la consulta
   * de arriba: si la migración aún no se ha ejecutado, la lista sale igual y
   * solo falta esta columna (`numerosDisponibles` a false).
   */
  const [numeros, setNumeros] = useState<Record<string, string>>({});
  const [numerosDisponibles, setNumerosDisponibles] = useState(false);
  const [soloSinNumero, setSoloSinNumero] = useState(false);
  /** Dirección firmada de la foto de cada empleado que tiene. Caduca: se pide al cargar. */
  const [fotos, setFotos] = useState<Record<string, string>>({});
  /** Técnicos enlazados con foto en Taller y todavía sin foto en Core. */
  const [fotosEnTaller, setFotosEnTaller] = useState(0);
  const [trayendoFotos, setTrayendoFotos] = useState(false);
  /** Fotos guardadas antes de que existiera el fondo de la empresa. */
  const [fotosSinFondo, setFotosSinFondo] = useState(0);
  const [poniendoFondo, setPoniendoFondo] = useState(false);
  /** El importador de nóminas, abierto. */
  const [importando, setImportando] = useState(false);
  /** La entrega del SMS del enlace vivo de cada empleado que tiene uno. */
  const [entregas, setEntregas] = useState<Record<string, Entrega>>({});

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: emps }, { data: emp }, { data: cent }] = await Promise.all([
      supabase.from("sea_employees")
        .select("id, nombre, apellidos, dni_nie, num_seguridad_social, direccion, codigo_postal, poblacion, provincia, telefono, email, cargo, departamento, rol, codigo_operario, activo, fecha_alta, company_id, work_center_id, estado_alta, sea_companies(nombre), sea_work_centers(nombre)")
        .order("nombre"),
      supabase.from("sea_companies").select("id, nombre").eq("activa", true).order("nombre"),
      supabase.from("sea_work_centers").select("id, nombre").eq("activo", true).order("nombre"),
    ]);
    setItems((emps ?? []) as any);
    setEmpresas(emp ?? []);
    setCentros(cent ?? []);
    setCargando(false);
    void cargarNumeros();
    void cargarFotos();
    void cargarEntregas();
  }

  async function cargarEntregas() {
    try {
      const r = await apiFetch("/api/core/alta/entregas");
      if (!r.ok) return;
      const d = (await r.json()) as { entregas?: Record<string, Entrega> };
      setEntregas(d.entregas ?? {});
    } catch {
      // Sin esto la lista sale igual, con «Enlace enviado» a secas.
    }
  }

  /*
   * Un SMS tarda segundos en llegar: mientras haya alguno en camino se vuelve
   * a mirar sola, para no tener que recargar la página. Se para sola también:
   * a los 15 minutos el servidor deja de llamarlo «en camino».
   */
  const hayEnCamino = Object.values(entregas).some((x) => x.estado === "en_camino");
  useEffect(() => {
    if (!hayEnCamino) return;
    const reloj = setTimeout(() => void cargarEntregas(), 20_000);
    return () => clearTimeout(reloj);
  }, [hayEnCamino, entregas]);

  async function cargarFotos() {
    try {
      const r = await apiFetch("/api/core/empleados/fotos");
      if (!r.ok) return;
      const d = (await r.json()) as { fotos?: Record<string, string>; pendientesDeTaller?: number; sinFondo?: number };
      setFotos(d.fotos ?? {});
      setFotosEnTaller(d.pendientesDeTaller ?? 0);
      setFotosSinFondo(d.sinFondo ?? 0);
    } catch {
      // Sin fotos la lista sale igual, con las iniciales.
    }
  }

  /**
   * Les pone el fondo de la empresa a las fotos que ya estaban guardadas.
   *
   * El servidor lo hace por tandas (cada foto son un par de segundos), así que
   * se le vuelve a pedir mientras queden y vaya avanzando.
   */
  async function ponerFondoALasFotos() {
    setPoniendoFondo(true);
    setError("");
    try {
      let puestos = 0;
      const saltados: { nombre: string; motivo: string }[] = [];
      for (let tanda = 0; tanda < 10; tanda++) {
        const r = await apiFetch("/api/core/empleados/fotos/poner-fondo", { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? "No se ha podido poner el fondo.");
        const hechos: string[] = d.puestos ?? [];
        puestos += hechos.length;
        saltados.push(...((d.saltados ?? []) as { nombre: string; motivo: string }[]));
        if (!d.quedan || hechos.length === 0) break;
      }
      setMensaje(
        `Fondo puesto en ${puestos} ${puestos === 1 ? "foto" : "fotos"}.` +
          (saltados.length ? ` Sin cambiar: ${saltados.map((x) => `${x.nombre} (${x.motivo})`).join("; ")}.` : "")
      );
      setTimeout(() => setMensaje(""), 12000);
      await cargarFotos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido poner el fondo.");
    } finally {
      setPoniendoFondo(false);
    }
  }

  /** Pasa a Core, normalizadas, las fotos que los técnicos enlazados tienen en Taller. */
  async function traerFotosDeTaller() {
    setTrayendoFotos(true);
    try {
      const r = await apiFetch("/api/core/empleados/fotos/traer-de-taller", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? "No se han podido traer las fotos.");
      const pasadas: string[] = d.pasadas ?? [];
      const saltadas: { tecnico: string; motivo: string }[] = d.saltadas ?? [];
      setMensaje(
        (pasadas.length ? `Fotos traídas de Taller: ${pasadas.join(", ")}.` : "No se ha traído ninguna foto.") +
          (saltadas.length ? ` No se ha podido con: ${saltadas.map((x) => `${x.tecnico} (${x.motivo})`).join(", ")}.` : "")
      );
      setTimeout(() => setMensaje(""), 20000);
      await cargarFotos();
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se han podido traer las fotos.");
      setTimeout(() => setMensaje(""), 8000);
    } finally {
      setTrayendoFotos(false);
    }
  }

  async function cargarNumeros() {
    try {
      const r = await apiFetch("/api/core/empleados/numeros-trabajador");
      if (!r.ok) { setNumerosDisponibles(false); return; }
      const d = (await r.json()) as { disponible: boolean; numeros: Record<string, string> };
      setNumeros(d.numeros ?? {});
      setNumerosDisponibles(Boolean(d.disponible));
    } catch {
      setNumerosDisponibles(false);
    }
  }

  const filtrados = items.filter((e) => {
    if (filtroRol && e.rol !== filtroRol) return false;
    if (filtroCentro && e.work_center_id !== filtroCentro) return false;
    if (filtroActivo === "activos" && !e.activo) return false;
    if (filtroActivo === "inactivos" && e.activo) return false;
    if (soloSinNumero && numeros[e.id]) return false;
    if (filtroTexto.trim()) {
      const t = filtroTexto.toLowerCase();
      const campos = [e.nombre, e.apellidos, e.email, e.codigo_operario, numeros[e.id], e.cargo, e.dni_nie, e.num_seguridad_social].join(" ").toLowerCase();
      if (!campos.includes(t)) return false;
    }
    return true;
  });

  /**
   * Le manda (o le vuelve a mandar) el enlace del formulario por SMS.
   *
   * Lo hace el servidor: es quien tiene las credenciales de Twilio y quien
   * guarda el token sin que el navegador llegue a verlo.
   */
  async function enviarEnlace(e: Empleado) {
    const actualizacion = e.estado_alta === "completa";
    /*
     * A quien ya está dado de alta se le pregunta antes. El botón está en una
     * fila de una lista de veintitantos: un clic de más manda un SMS a alguien
     * que lleva diez años aquí y le dice que repase su ficha.
     */
    if (actualizacion && !confirm(
      `Se le mandará un SMS a ${e.nombre} (${e.telefono ?? "sin móvil"}) pidiéndole que repase y actualice su ficha. ¿Seguimos?`
    )) return;

    setEnviando(e.id);
    setMensaje("");
    try {
      const r = await apiFetch("/api/core/alta/invitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: e.id, motivo: actualizacion ? "actualizacion" : "alta" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "No se ha podido mandar el enlace.");
      setMensaje(
        actualizacion
          ? `SMS enviado a ${e.nombre}: le hemos pedido que repase su ficha. El enlace caduca en 72 horas.`
          : `Enlace enviado a ${e.nombre} por SMS. Caduca en 72 horas.`
      );
      setTimeout(() => setMensaje(""), 5000);
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido mandar el enlace.");
    } finally {
      setEnviando(null);
    }
  }

  function abrirNuevo() {
    setForm({ ...EMPTY });
    setEditId(null);
    setError("");
    setModal(true);
  }

  function abrirEditar(e: Empleado) {
    setForm({
      nombre: e.nombre, apellidos: e.apellidos ?? "", dni_nie: e.dni_nie ?? "",
      num_seguridad_social: e.num_seguridad_social ?? "",
      direccion: e.direccion ?? "", codigo_postal: e.codigo_postal ?? "",
      poblacion: e.poblacion ?? "", provincia: e.provincia ?? "",
      telefono: e.telefono ?? "", email: e.email ?? "", cargo: e.cargo ?? "",
      departamento: e.departamento ?? "", rol: e.rol,
      codigo_operario: e.codigo_operario ?? "",
      fecha_alta: (e.fecha_alta ?? "").substring(0, 10),
      activo: e.activo,
      roadside_capable: e.roadside_capable ?? false,
      company_id: (e as any).company_id ?? "",
      work_center_id: (e as any).work_center_id ?? "",
    });
    setEditId(e.id);
    setError("");
    setModal(true);
  }

  /** «Taller (Albert), Almacén (albert@…)», para decir dónde ha tenido efecto. */
  function enQueModulos(lista: { nombre: string; usuarios: string[] }[]): string {
    return lista.map((m) => `${m.nombre} (${m.usuarios.join(", ")})`).join(", ");
  }

  async function guardar() {
    if (!form.nombre?.trim()) { setError("El nombre es obligatorio."); return; }

    /*
     * El alta y la baja de alguien que ya existe no se escriben desde aquí:
     * van por el servidor, que en el mismo paso le da de baja en todos los
     * módulos donde está enlazado (Taller, Almacén, TyreControl, acceso web).
     */
    const anterior = editId ? items.find((i) => i.id === editId) : undefined;
    const cambiaActivo = anterior !== undefined && anterior.activo !== form.activo;
    if (cambiaActivo && !form.activo && !confirm(
      `Vas a dar de baja a ${form.nombre.trim()}.\n\n` +
      "Quedará de baja en Core y también en todos los módulos donde esté: Taller, Almacén, " +
      "TyreControl, Recepciones y su acceso web. No podrá entrar en ninguna app.\n\n" +
      "Su histórico se conserva. ¿Seguimos?"
    )) return;

    setGuardando(true);
    const payload = {
      nombre:          form.nombre.trim(),
      apellidos:       form.apellidos || null,
      dni_nie:         form.dni_nie || null,
      num_seguridad_social: form.num_seguridad_social || null,
      direccion:       form.direccion || null,
      codigo_postal:   form.codigo_postal || null,
      poblacion:       form.poblacion || null,
      provincia:       form.provincia || null,
      telefono:        form.telefono || null,
      email:           form.email || null,
      cargo:           form.cargo || null,
      departamento:    form.departamento || null,
      rol:             form.rol,
      codigo_operario:  form.codigo_operario || null,
      fecha_alta:       form.fecha_alta || null,
      roadside_capable: form.roadside_capable,
      company_id:       form.company_id || null,
      work_center_id:  form.work_center_id || null,
    };
    /*
     * `estado_alta` solo se toca al crear. En una edición no: la ficha de
     * alguien que ya está dado de alta no tiene por qué volver a ponerse en
     * «pendiente» porque a alguien le cambien el teléfono.
     */
    const alta = !editId && form.alta_por_enlace === true;
    const { data: creado, error: err } = editId
      ? await supabase.from("sea_employees").update(payload).eq("id", editId).select("id").single()
      : await supabase
          .from("sea_employees")
          .insert({ ...payload, activo: form.activo, estado_alta: alta ? "pendiente" : "completa" })
          .select("id")
          .single();
    if (err) { setGuardando(false); setError(err.message); return; }

    let efecto = "";
    if (cambiaActivo && editId) {
      try {
        const r = await apiFetch(`/api/core/empleados/${editId}/activo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activo: form.activo }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? "No se ha podido cambiar el alta del empleado.");
        if (!form.activo) {
          efecto = d.bajaEn?.length
            ? ` Dado de baja también en: ${enQueModulos(d.bajaEn)}.`
            : " Dado de baja. No tenía usuario activo en ningún otro módulo.";
        } else {
          efecto = d.sigueDeBajaEn?.length
            ? ` Vuelve a estar activo en Core, pero sigue de baja en: ${enQueModulos(d.sigueDeBajaEn)}. Hay que reactivarle allí a mano.`
            : " Vuelve a estar activo.";
        }
      } catch (e) {
        // El resto de la ficha ya está guardado; lo que no ha entrado es el alta/baja.
        setGuardando(false);
        setError(e instanceof Error ? e.message : "No se ha podido cambiar el alta del empleado.");
        cargar();
        return;
      }
    }
    setGuardando(false);
    setModal(false);
    // Lo que dice dónde ha tenido efecto una baja se deja más rato a la vista.
    setTimeout(() => setMensaje(""), efecto ? 20000 : 5000);

    if (alta && creado?.id) {
      setMensaje("Empleado creado. Mandando el enlace…");
      await enviarEnlace({ id: creado.id, nombre: payload.nombre } as Empleado);
      return;
    }
    setMensaje((editId ? "Empleado actualizado." : "Empleado creado.") + efecto);
    cargar();
  }

  return (
    <CoreLayout>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Empleados</h1>
          <p className="text-sm text-slate-400">{filtrados.length} empleados</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setImportando(true)}
            title="Dar de alta a los trabajadores nuevos a partir del PDF de nóminas del mes"
            className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700/50">
            Importar de nóminas
          </button>
          <button onClick={abrirNuevo}
            className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500">
            + Nuevo empleado
          </button>
        </div>
      </div>

      {importando && <ImportarNominas onCerrar={() => setImportando(false)} onImportado={() => void cargar()} />}

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Solo mientras haga falta: cuando no queda ninguna por traer, desaparece. */}
      {fotosEnTaller > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-800 bg-sky-500/10 p-3 text-sm text-sky-100">
          <span>
            {fotosEnTaller === 1 ? "Hay 1 técnico" : `Hay ${fotosEnTaller} técnicos`} con foto en Taller que aún no la{" "}
            {fotosEnTaller === 1 ? "tiene" : "tienen"} en su ficha de Core.
          </span>
          <button onClick={() => void traerFotosDeTaller()} disabled={trayendoFotos}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-60">
            {trayendoFotos ? "Trayendo…" : "Traer fotos de Taller"}
          </button>
        </div>
      )}

      {/* Igual: solo mientras quede alguna foto de las de antes. */}
      {fotosSinFondo > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-800 bg-sky-500/10 p-3 text-sm text-sky-100">
          <span>
            {fotosSinFondo === 1 ? "Hay 1 foto guardada" : `Hay ${fotosSinFondo} fotos guardadas`} sin el fondo de la empresa.
            Las nuevas ya salen con él.
          </span>
          <button onClick={() => void ponerFondoALasFotos()} disabled={poniendoFondo}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-60">
            {poniendoFondo ? "Poniendo el fondo…" : "Poner el fondo"}
          </button>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar nombre, email, código, nº, DNI..." className="rounded-lg border border-slate-700 px-3 py-2 text-sm w-64" />
        <select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">
          <option value="">Todos los roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filtroCentro} onChange={(e) => setFiltroCentro(e.target.value)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">
          <option value="">Todos los centros</option>
          {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <div className="flex rounded-lg border border-slate-700 overflow-hidden text-sm">
          {(["activos","todos","inactivos"] as const).map((v) => (
            <button key={v} onClick={() => setFiltroActivo(v)}
              className={`px-3 py-2 transition-colors ${filtroActivo === v ? "bg-slate-800 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700/50"}`}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        {numerosDisponibles && (
          <button onClick={() => setSoloSinNumero((v) => !v)}
            title="Empleados que todavía no tienen número de trabajador"
            className={`rounded-lg border px-3 py-2 text-sm ${soloSinNumero ? "border-amber-600 bg-amber-500/20 text-amber-200" : "border-slate-700 text-slate-300 hover:bg-slate-700/50"}`}>
            Sin número ({items.filter((e) => e.activo && !numeros[e.id]).length})
          </button>
        )}
        {(filtroTexto || filtroRol || filtroCentro || soloSinNumero) && (
          <button onClick={() => { setFiltroTexto(""); setFiltroRol(""); setFiltroCentro(""); setSoloSinNumero(false); }}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:bg-slate-700/50">Limpiar</button>
        )}
      </div>

      {/* Tabla */}
      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-800">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-800 text-left">
              <tr>
                {numerosDisponibles && <th className="p-3" title="Número de trabajador (por empresa)">Nº</th>}
                <th className="p-3">Empleado</th>
                <th className="p-3">Rol</th>
                <th className="p-3">Empresa / Centro</th>
                <th className="p-3">Contacto</th>
                <th className="p-3">Código</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((e) => (
                <tr key={e.id} className="border-t border-slate-700 hover:bg-slate-700/50">
                  {numerosDisponibles && (
                    <td className="p-3 font-mono text-slate-300">{numeros[e.id] ?? <span className="text-slate-600">—</span>}</td>
                  )}
                  <td className="p-3">
                    <Link to={`/core/empleados/${e.id}`} className="flex items-center gap-2 group">
                      {fotos[e.id] ? (
                        <img src={fotos[e.id]} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-full bg-slate-700 object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                          {e.nombre.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium group-hover:text-blue-600">{e.nombre} {e.apellidos ?? ""}</div>
                        {e.cargo && <div className="text-xs text-slate-500">{e.cargo}</div>}
                      </div>
                    </Link>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROL_BADGE[e.rol] ?? "bg-slate-700 text-slate-300"}`}>
                      {e.rol}
                    </span>
                  </td>
                  <td className="p-3 text-slate-400">
                    <div>{(e.sea_companies as any)?.nombre ?? "—"}</div>
                    <div className="text-xs">{(e.sea_work_centers as any)?.nombre ?? ""}</div>
                  </td>
                  <td className="p-3 text-slate-400">
                    <div>{e.email ?? "—"}</div>
                    <div className="text-xs">{e.telefono ?? ""}</div>
                  </td>
                  <td className="p-3 font-mono text-slate-400">{e.codigo_operario ?? "—"}</td>
                  <td className="p-3">
<div className="flex flex-col items-start gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.activo ? "bg-green-100 text-green-800" : "bg-red-500/20 text-red-300"}`}>
                        {e.activo ? "Activo" : "Inactivo"}
                      </span>
                      {ESTADO_ALTA[e.estado_alta ?? ""] && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ESTADO_ALTA[e.estado_alta!].clase}`}>
                          {ESTADO_ALTA[e.estado_alta!].label}
                        </span>
                      )}
                      {entregas[e.id] && ENTREGA[entregas[e.id].estado] && (
                        <span
                          title={`${ENTREGA[entregas[e.id].estado].ayuda} Enviado a ${entregas[e.id].telefono} el ${new Date(entregas[e.id].enviadoAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ENTREGA[entregas[e.id].estado].clase}`}
                        >
                          {ENTREGA[entregas[e.id].estado].label}
                        </span>
                      )}
                      {entregas[e.id]?.estado === "no_entregado" && entregas[e.id].motivo && (
                        <span className="max-w-[13rem] text-[11px] leading-tight text-red-300">{entregas[e.id].motivo}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Link to={`/core/empleados/${e.id}`}
                        className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100">
                        Ver ficha
                      </Link>
                      <button onClick={() => abrirEditar(e)}
                        className="rounded-lg bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
                        Editar
                      </button>
                      <button onClick={() => void enviarEnlace(e)} disabled={enviando === e.id}
                        title={e.estado_alta === "completa"
                          ? "Le manda un SMS para que repase y actualice su ficha"
                          : "Le manda por SMS el enlace para que rellene su ficha"}
                        className={`rounded-lg px-2 py-1 text-xs disabled:opacity-50 ${
                          e.estado_alta === "completa"
                            ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                            : "bg-sky-600 text-white hover:bg-sky-500"
                        }`}>
                        {enviando === e.id
                          ? "Enviando…"
                          : e.estado_alta === "completa"
                            ? "Pedir actualización"
                            : e.estado_alta === "pendiente"
                              ? "Enviar enlace"
                              : "Reenviar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Sin empleados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal crear/editar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-slate-800 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-5">{editId ? "Editar empleado" : "Nuevo empleado"}</h2>

            <div className="space-y-4">
              {/* La foto: de quien ya existe. A uno nuevo se le pone después, o se la hace él en el enlace. */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Foto</h3>
                {editId ? (
                  <FotoEmpleado
                    employeeId={editId}
                    nombre={form.nombre || "Empleado"}
                    url={fotos[editId] ?? null}
                    tamano={72}
                    onCambio={(u) =>
                      setFotos((f) => {
                        const n = { ...f };
                        if (u) n[editId] = u;
                        else delete n[editId];
                        return n;
                      })
                    }
                  />
                ) : (
                  <p className="text-xs text-slate-500">
                    Se pone una vez creado el empleado, desde aquí o desde su ficha. Si le mandas el enlace de alta, se la hace él con el móvil.
                  </p>
                )}
              </div>

              {/* Datos personales */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Datos personales</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-slate-300">Nombre *</label>
                    <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">Apellidos</label>
                    <input value={form.apellidos} onChange={(e) => setForm({ ...form, apellidos: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">DNI / NIE</label>
                    <input value={form.dni_nie} onChange={(e) => setForm({ ...form, dni_nie: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">Nº Seguridad Social</label>
                    <input value={form.num_seguridad_social} onChange={(e) => setForm({ ...form, num_seguridad_social: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div className="col-span-2"><label className="text-xs font-medium text-slate-300">Dirección</label>
                    <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">Código postal</label>
                    <input value={form.codigo_postal} onChange={(e) => setForm({ ...form, codigo_postal: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">Población</label>
                    <input value={form.poblacion} onChange={(e) => setForm({ ...form, poblacion: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div className="col-span-2"><label className="text-xs font-medium text-slate-300">Provincia</label>
                    <input value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">Teléfono personal</label>
                    <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">Email</label>
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  {!editId && (
                    <div className="col-span-2 rounded-lg border border-slate-600 bg-slate-900/60 p-3">
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                        <input type="checkbox" checked={form.alta_por_enlace === true}
                          onChange={(e) => setForm({ ...form, alta_por_enlace: e.target.checked })}
                          className="mt-0.5 h-4 w-4 accent-sky-500" />
                        <span>
                          Que rellene él su ficha.
                          <span className="text-slate-500"> Con el nombre y el móvil basta: al guardar le llega
                            un SMS con el enlace del formulario, que caduca en 72 h.</span>
                        </span>
                      </label>
                    </div>
                  )}
                  <div><label className="text-xs font-medium text-slate-300">Fecha de alta</label>
                    <input type="date" value={form.fecha_alta} onChange={(e) => setForm({ ...form, fecha_alta: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                </div>
              </div>

              {/* Puesto */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Puesto y acceso</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-slate-300">Cargo</label>
                    <input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" placeholder="Mecánico, Encargado..." /></div>
                  <div><label className="text-xs font-medium text-slate-300">Departamento</label>
                    <input value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">Rol</label>
                    <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500">
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select></div>
                  <div><label className="text-xs font-medium text-slate-300">Código operario</label>
                    <input value={form.codigo_operario}
                      onChange={(e) => setForm({ ...form, codigo_operario: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                      placeholder="1234" maxLength={4} inputMode="numeric" /></div>
                </div>
              </div>

              {/* Empresa y centro */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Organización</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-slate-300">Empresa</label>
                    <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500">
                      <option value="">Sin empresa</option>
                      {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
                    </select></div>
                  <div><label className="text-xs font-medium text-slate-300">Centro de trabajo</label>
                    <select value={form.work_center_id} onChange={(e) => setForm({ ...form, work_center_id: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500">
                      <option value="">Sin centro</option>
                      {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select></div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                Empleado activo
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.roadside_capable} onChange={(e) => setForm({ ...form, roadside_capable: e.target.checked })} />
                <span>Puede gestionar asistencias en carretera</span>
                {form.roadside_capable && !form.codigo_operario && (
                  <span className="text-xs text-orange-600">(requiere código operario)</span>
                )}
              </label>
            </div>

            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {guardando ? "Guardando..." : editId ? "Guardar cambios" : "Crear empleado"}
              </button>
            </div>
          </div>
        </div>
      )}
    </CoreLayout>
  );
}
