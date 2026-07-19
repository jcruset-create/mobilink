import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../modules/almacen-neumaticos/services/supabase";
import { APP_VERSION } from "../version";

type Modulo = {
  id: string;
  titulo: string;
  descripcion: string;
  icon: string;
  color: string;
  colorBorder: string;
  colorIcon: string;
  ruta: string;
  links: { label: string; ruta: string }[];
};

type Alerta = {
  id: string;
  nivel: "critico" | "aviso" | "info";
  icono: string;
  titulo: string;
  detalle: string;
  ruta: string;
  modulo: string;
};

const MODULOS: Modulo[] = [
  {
    id: "core",
    titulo: "Mobilink Core",
    descripcion: "Gestión central de empleados, competencias, certificaciones y autorizaciones.",
    icon: "👷",
    color: "bg-gray-50",
    colorBorder: "border-gray-300",
    colorIcon: "bg-gray-800 text-white",
    ruta: "/sea-core",
    links: [
      { label: "Empleados", ruta: "/sea-core/empleados" },
      { label: "Empresas", ruta: "/sea-core/empresas" },
      { label: "Centros de trabajo", ruta: "/sea-core/centros" },
      { label: "Competencias", ruta: "/sea-core/competencias" },
    ],
  },
  {
    id: "toolcontrol",
    titulo: "Mobilink ToolControl",
    descripcion: "Control de herramientas, máquinas, mantenimiento e inventario.",
    icon: "🔧",
    color: "bg-blue-50",
    colorBorder: "border-blue-300",
    colorIcon: "bg-blue-600 text-white",
    ruta: "/toolcontrol",
    links: [
      { label: "Herramientas", ruta: "/toolcontrol/herramientas" },
      { label: "Máquinas", ruta: "/toolcontrol/maquinas" },
      { label: "Mantenimiento", ruta: "/toolcontrol/mantenimiento" },
      { label: "Incidencias", ruta: "/toolcontrol/incidencias" },
    ],
  },
  {
    id: "safety",
    titulo: "Mobilink Safety Manager",
    descripcion: "Gestión de EPIs, documentos de seguridad, formación e inspecciones.",
    icon: "🦺",
    color: "bg-yellow-50",
    colorBorder: "border-yellow-300",
    colorIcon: "bg-yellow-500 text-white",
    ruta: "/safety",
    links: [
      { label: "EPIs", ruta: "/safety/epis" },
      { label: "Entregas", ruta: "/safety/entregas" },
      { label: "Documentos", ruta: "/safety/documentos" },
      { label: "Formación", ruta: "/safety/formacion" },
    ],
  },
  {
    id: "presencia",
    titulo: "Mobilink Presencia",
    descripcion: "Control de fichajes y presencia diaria del personal.",
    icon: "🕐",
    color: "bg-violet-50",
    colorBorder: "border-violet-300",
    colorIcon: "bg-violet-600 text-white",
    ruta: "/presencia",
    links: [
      { label: "Dashboard hoy",   ruta: "/presencia" },
      { label: "Todos los fichajes", ruta: "/presencia/fichajes" },
    ],
  },
  {
    id: "almacen",
    titulo: "Almacén Neumáticos",
    descripcion: "Stock operativo, entradas, salidas, traspasos e inventarios.",
    icon: "🏭",
    color: "bg-green-50",
    colorBorder: "border-green-300",
    colorIcon: "bg-green-600 text-white",
    ruta: "/almacen",
    links: [
      { label: "Stock operativo", ruta: "/almacen/stock" },
      { label: "Entradas", ruta: "/almacen/entradas" },
      { label: "Traspasos", ruta: "/almacen/traspasos" },
      { label: "Inventarios", ruta: "/almacen/inventarios" },
    ],
  },
  {
    id: "integraciones",
    titulo: "Integration Hub",
    descripcion: "Conectores con ERP, datos técnicos y proveedores. Operaciones, errores y reproceso.",
    icon: "🔌",
    color: "bg-sky-50",
    colorBorder: "border-sky-300",
    colorIcon: "bg-sky-600 text-white",
    ruta: "/integraciones",
    links: [
      { label: "Conectores", ruta: "/integraciones" },
      { label: "Operaciones", ruta: "/integraciones" },
    ],
  },
];

const NIVEL_STYLE = {
  critico: { bar: "border-l-red-500",    badge: "bg-red-100 text-red-700",    dot: "bg-red-500" },
  aviso:   { bar: "border-l-orange-400", badge: "bg-orange-100 text-orange-700", dot: "bg-orange-400" },
  info:    { bar: "border-l-blue-400",   badge: "bg-blue-100 text-blue-700",  dot: "bg-blue-400" },
};

async function cargarAlertas(): Promise<Alerta[]> {
  const alertas: Alerta[] = [];
  const hoy = new Date();
  const en30 = new Date(hoy); en30.setDate(en30.getDate() + 30);
  const en30str = en30.toISOString().slice(0, 10);
  const hoystr = hoy.toISOString().slice(0, 10);

  const [
    { data: certsExp },
    { data: autsExp },
    { data: formExp },
    { data: herrsVencidas },
    { data: incidenciasCrit },
    { data: inspeccionesCrit },
  ] = await Promise.all([
    // Certificaciones que caducan en 30 días
    supabase.from("sea_employee_certifications")
      .select("id, nombre, fecha_caducidad, sea_employees(nombre)")
      .lte("fecha_caducidad", en30str)
      .gte("fecha_caducidad", hoystr)
      .limit(10),

    // Autorizaciones que caducan en 30 días
    supabase.from("sea_employee_authorizations")
      .select("id, fecha_caducidad, sea_employees(nombre), sea_authorizations(nombre)")
      .lte("fecha_caducidad", en30str)
      .gte("fecha_caducidad", hoystr)
      .limit(10),

    // Formaciones caducadas o por caducar
    supabase.from("sea_training_records")
      .select("id, nombre_curso, fecha_caducidad, sea_employees(nombre)")
      .lte("fecha_caducidad", en30str)
      .gte("fecha_caducidad", hoystr)
      .limit(10),

    // Herramientas con revisión vencida
    supabase.from("tc_tools")
      .select("id, nombre, proxima_revision")
      .eq("activa", true)
      .lt("proxima_revision", hoystr)
      .not("proxima_revision", "is", null)
      .limit(10),

    // Incidencias abiertas de alta gravedad
    supabase.from("tc_incidents")
      .select("id, titulo, gravedad, created_at")
      .eq("estado", "abierta")
      .eq("gravedad", "alta")
      .limit(10),

    // Inspecciones críticas recientes
    supabase.from("sm_inspections")
      .select("id, titulo, resultado, fecha_inspeccion")
      .eq("resultado", "critico")
      .is("fecha_cierre", null)
      .limit(10),
  ]);

  // EPIs bajo stock (query separada con filter JS)
  const { data: episRaw } = await supabase.from("sm_epis")
    .select("id, nombre, stock_actual, stock_minimo")
    .eq("activo", true);
  const episBajo = (episRaw ?? []).filter((e) => e.stock_actual <= e.stock_minimo);

  // Certificaciones por caducar
  for (const c of certsExp ?? []) {
    const dias = Math.ceil((new Date(c.fecha_caducidad).getTime() - hoy.getTime()) / 86400000);
    alertas.push({
      id: `cert-${c.id}`,
      nivel: dias <= 7 ? "critico" : "aviso",
      icono: "📋",
      titulo: `Certificación por caducar: ${c.nombre}`,
      detalle: `${(c as any).sea_employees?.nombre ?? "?"} · caduca en ${dias} día${dias !== 1 ? "s" : ""}`,
      ruta: "/sea-core/empleados",
      modulo: "Mobilink Core",
    });
  }

  // Autorizaciones por caducar
  for (const a of autsExp ?? []) {
    const dias = Math.ceil((new Date(a.fecha_caducidad).getTime() - hoy.getTime()) / 86400000);
    alertas.push({
      id: `aut-${a.id}`,
      nivel: dias <= 7 ? "critico" : "aviso",
      icono: "🔑",
      titulo: `Autorización por caducar: ${(a as any).sea_authorizations?.nombre ?? "?"}`,
      detalle: `${(a as any).sea_employees?.nombre ?? "?"} · caduca en ${dias} día${dias !== 1 ? "s" : ""}`,
      ruta: "/sea-core/empleados",
      modulo: "Mobilink Core",
    });
  }

  // Formaciones por caducar
  for (const f of formExp ?? []) {
    const dias = Math.ceil((new Date(f.fecha_caducidad).getTime() - hoy.getTime()) / 86400000);
    alertas.push({
      id: `form-${f.id}`,
      nivel: dias <= 7 ? "critico" : "aviso",
      icono: "🎓",
      titulo: `Formación por caducar: ${f.nombre_curso}`,
      detalle: `${(f as any).sea_employees?.nombre ?? "?"} · caduca en ${dias} día${dias !== 1 ? "s" : ""}`,
      ruta: "/safety/formacion",
      modulo: "Safety",
    });
  }

  // EPIs bajo stock
  for (const e of episBajo) {
    alertas.push({
      id: `epi-${e.id}`,
      nivel: e.stock_actual === 0 ? "critico" : "aviso",
      icono: "🦺",
      titulo: e.stock_actual === 0 ? `Sin stock: ${e.nombre}` : `Stock bajo: ${e.nombre}`,
      detalle: `Stock actual: ${e.stock_actual} · mínimo: ${e.stock_minimo}`,
      ruta: "/safety/epis",
      modulo: "Safety",
    });
  }

  // Herramientas con revisión vencida
  for (const h of herrsVencidas ?? []) {
    const diasVencida = Math.ceil((hoy.getTime() - new Date(h.proxima_revision).getTime()) / 86400000);
    alertas.push({
      id: `herr-${h.id}`,
      nivel: diasVencida > 30 ? "critico" : "aviso",
      icono: "🔧",
      titulo: `Revisión vencida: ${h.nombre}`,
      detalle: `Vencida hace ${diasVencida} día${diasVencida !== 1 ? "s" : ""}`,
      ruta: "/toolcontrol/herramientas",
      modulo: "ToolControl",
    });
  }

  // Incidencias críticas abiertas
  for (const i of incidenciasCrit ?? []) {
    alertas.push({
      id: `inc-${i.id}`,
      nivel: "critico",
      icono: "⚠️",
      titulo: `Incidencia alta sin resolver: ${i.titulo}`,
      detalle: `Abierta el ${new Date(i.created_at).toLocaleDateString("es-ES")}`,
      ruta: "/toolcontrol/incidencias",
      modulo: "ToolControl",
    });
  }

  // Inspecciones críticas abiertas
  for (const ins of inspeccionesCrit ?? []) {
    alertas.push({
      id: `insp-${ins.id}`,
      nivel: "critico",
      icono: "🚨",
      titulo: `Inspección crítica pendiente: ${ins.titulo}`,
      detalle: `Fecha: ${new Date(ins.fecha_inspeccion).toLocaleDateString("es-ES")}`,
      ruta: "/safety/inspecciones",
      modulo: "Safety",
    });
  }

  // Ordenar: críticos primero
  return alertas.sort((a, b) => {
    const orden = { critico: 0, aviso: 1, info: 2 };
    return orden[a.nivel] - orden[b.nivel];
  });
}

export default function SeaHub() {
  const [usuario] = useState<{ nombre: string; rol: string } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [cargandoAlertas, setCargandoAlertas] = useState(true);
  const [mostrarTodasAlertas, setMostrarTodasAlertas] = useState(false);

  useEffect(() => {
    setCargando(false);
    cargarAlertas().then((a) => { setAlertas(a); setCargandoAlertas(false); });
  }, []);


  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Cargando...</div>
      </div>
    );
  }

  const alertasVisibles = mostrarTodasAlertas ? alertas : alertas.slice(0, 5);
  const numCriticos = alertas.filter((a) => a.nivel === "critico").length;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gray-800 flex items-center justify-center text-white font-black text-sm">S</div>
            <div>
              <div className="font-bold text-gray-900 leading-none">Mobilink Platform</div>
              <div className="text-xs text-gray-400">{APP_VERSION}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {usuario && (
              <div className="text-right">
                <div className="text-sm font-medium text-gray-700">{usuario.nombre}</div>
                {usuario.rol && <div className="text-xs text-gray-400">{usuario.rol}</div>}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Bienvenida */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-black text-gray-900">
              Bienvenido{usuario?.nombre ? `, ${usuario.nombre.split(" ")[0]}` : ""}
            </h1>
            <p className="text-gray-500 mt-1">Selecciona un módulo para empezar.</p>
          </div>
          {!cargandoAlertas && alertas.length > 0 && (
            <div className={`rounded-xl px-4 py-2 text-sm font-semibold flex items-center gap-2 ${
              numCriticos > 0 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"
            }`}>
              {numCriticos > 0 ? "🚨" : "⚠️"}
              {numCriticos > 0
                ? `${numCriticos} alerta${numCriticos !== 1 ? "s" : ""} crítica${numCriticos !== 1 ? "s" : ""}`
                : `${alertas.length} aviso${alertas.length !== 1 ? "s" : ""}`}
            </div>
          )}
        </div>

        {/* Panel de alertas */}
        {!cargandoAlertas && alertas.length > 0 && (
          <div className="rounded-2xl border bg-white overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                Alertas activas
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  numCriticos > 0 ? "bg-red-500 text-white" : "bg-orange-400 text-white"
                }`}>{alertas.length}</span>
              </h2>
              <button onClick={() => setMostrarTodasAlertas((v) => !v)}
                className="text-xs text-blue-600 hover:underline">
                {mostrarTodasAlertas ? "Ver menos" : `Ver todas (${alertas.length})`}
              </button>
            </div>
            <div className="divide-y">
              {alertasVisibles.map((a) => {
                const s = NIVEL_STYLE[a.nivel];
                return (
                  <Link key={a.id} to={a.ruta}
                    className={`flex items-start gap-3 px-5 py-3 border-l-4 ${s.bar} hover:bg-gray-50 transition-colors`}>
                    <span className="text-xl shrink-0 mt-0.5">{a.icono}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-800 leading-tight">{a.titulo}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{a.detalle}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}>
                        {a.nivel}
                      </span>
                      <span className="text-xs text-gray-400">{a.modulo}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {!cargandoAlertas && alertas.length === 0 && (
          <div className="rounded-2xl border bg-white px-5 py-4 flex items-center gap-3 text-green-700">
            <span className="text-2xl">✅</span>
            <div>
              <div className="font-semibold">Todo en orden</div>
              <div className="text-sm text-green-600">No hay alertas activas en ningún módulo.</div>
            </div>
          </div>
        )}

        {/* Módulos */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {MODULOS.map((m) => (
            <div key={m.id} className={`rounded-2xl border-2 ${m.colorBorder} ${m.color} overflow-hidden`}>
              <Link to={m.ruta} className="flex items-center gap-4 p-5 hover:brightness-95 transition-all">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center text-2xl ${m.colorIcon} shrink-0`}>
                  {m.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-gray-900 text-lg leading-tight">{m.titulo}</div>
                  <div className="text-sm text-gray-500 mt-0.5 line-clamp-2">{m.descripcion}</div>
                </div>
                <span className="text-gray-400 text-lg shrink-0">→</span>
              </Link>
              <div className="border-t bg-white/60 px-5 py-3 flex flex-wrap gap-2">
                {m.links.map((l) => (
                  <Link key={l.ruta} to={l.ruta}
                    className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Accesos secundarios */}
        <div className="rounded-2xl border bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Operaciones</h2>
          <div className="flex flex-wrap gap-3">
            {[
              { label: "Panel taller", ruta: "/", icon: "🏗️" },
              { label: "TV Operarios", ruta: "/operario/asistencias", icon: "📺" },
              { label: "Cobros", ruta: "/cobros", icon: "💳" },
              { label: "Auditoría almacén", ruta: "/almacen/auditoria", icon: "📋" },
              { label: "Portal empleado", ruta: "/portal", icon: "👤" },
            ].map((a) => (
              <Link key={a.ruta} to={a.ruta}
                className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                <span>{a.icon}</span>{a.label}
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
