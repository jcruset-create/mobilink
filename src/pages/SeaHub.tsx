import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

const MODULOS: Modulo[] = [
  {
    id: "core",
    titulo: "SEA Core",
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
    titulo: "SEA ToolControl",
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
    titulo: "SEA Safety Manager",
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
];

export default function SeaHub() {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState<{ nombre: string; rol: string } | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { navigate("/almacen/login"); return; }
      const { data } = await supabase
        .from("perfiles_usuario")
        .select("nombre, rol")
        .eq("user_id", session.user.id)
        .single();
      setUsuario(data ?? { nombre: session.user.email ?? "Usuario", rol: "" });
      setCargando(false);
    });
  }, [navigate]);

  async function cerrarSesion() {
    await supabase.auth.signOut();
    navigate("/almacen/login");
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gray-800 flex items-center justify-center text-white font-black text-sm">S</div>
            <div>
              <div className="font-bold text-gray-900 leading-none">SEA Platform</div>
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
            <button onClick={cerrarSesion}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors">
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Bienvenida */}
        <div>
          <h1 className="text-3xl font-black text-gray-900">
            Bienvenido{usuario?.nombre ? `, ${usuario.nombre.split(" ")[0]}` : ""}
          </h1>
          <p className="text-gray-500 mt-1">Selecciona un módulo para empezar.</p>
        </div>

        {/* Módulos */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {MODULOS.map((m) => (
            <div key={m.id} className={`rounded-2xl border-2 ${m.colorBorder} ${m.color} overflow-hidden`}>
              {/* Card header */}
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

              {/* Quick links */}
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
