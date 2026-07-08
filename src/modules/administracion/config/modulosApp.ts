// Catálogo estático de módulos, roles y pantallas para la pantalla de
// Usuarios. Se mantiene aquí (y no importando código de otros módulos)
// para no acoplar Administración al resto de la aplicación.
//
// Las claves de pantalla coinciden con las rutas/keys del navigation de
// cada módulo. En esta fase el gating por pantallas solo se APLICA en
// Administración; en el resto se guarda para fases futuras.

export type RolApp = { value: string; label: string };
export type PantallaApp = { key: string; label: string };

export type ModuloApp = {
  key: "administracion" | "almacen" | "tyrecontrol" | "sea-core" | "toolcontrol" | "safety" | "presencia";
  label: string;
  roles: RolApp[];
  pantallas: PantallaApp[];
  conEmpresa?: boolean; // tyrecontrol: los usuarios tipo cliente van ligados a una empresa
};

// Rol único para los módulos de SEA Core (no tienen roles propios;
// el acceso se controla por pantallas)
const ROL_ACCESO: RolApp[] = [{ value: "usuario", label: "Usuario" }];

export const MODULOS_APP: ModuloApp[] = [
  {
    key: "administracion",
    label: "Administración",
    roles: [
      { value: "admin", label: "Admin" },
      { value: "administracion", label: "Administración" },
      { value: "recepcion", label: "Recepción" },
      { value: "supervisor", label: "Supervisor" },
      { value: "tecnico", label: "Técnico" },
    ],
    pantallas: [
      { key: "dashboard", label: "Resumen" },
      { key: "cobros-dia", label: "Cobros del día" },
      { key: "seguimiento", label: "Seguimiento de pagos" },
      { key: "recobros", label: "Recobros" },
      { key: "clientes", label: "Clientes con seguimiento" },
      { key: "formas-pago", label: "Configuración" },
      { key: "informes", label: "Informes" },
      { key: "estado-ots", label: "Estado de OTs" },
      { key: "usuarios", label: "Usuarios" },
    ],
  },
  {
    key: "almacen",
    label: "Almacén neumáticos",
    roles: [
      { value: "admin", label: "Admin" },
      { value: "responsable", label: "Responsable" },
      { value: "operario", label: "Operario" },
    ],
    pantallas: [
      { key: "dashboard", label: "Panel" },
      { key: "stock", label: "Stock operativo" },
      { key: "entradas", label: "Entradas" },
      { key: "salidas", label: "Salidas y montajes" },
      { key: "historial", label: "Historial" },
      { key: "traspasos", label: "Traspasos" },
      { key: "reposiciones", label: "Reposiciones" },
      { key: "inventarios", label: "Inventarios" },
      { key: "incidencias", label: "Incidencias" },
      { key: "productos", label: "Productos" },
      { key: "clientes", label: "Clientes" },
      { key: "vehiculos", label: "Vehículos" },
      { key: "centros", label: "Centros" },
      { key: "usuarios", label: "Usuarios" },
      { key: "auditoria", label: "Auditoría" },
      { key: "sistema", label: "Sistema" },
    ],
  },
  {
    key: "tyrecontrol",
    label: "TyreControl",
    conEmpresa: true,
    roles: [
      { value: "administrador", label: "Administrador" },
      { value: "operador", label: "Operador" },
      { value: "cliente", label: "Cliente" },
    ],
    pantallas: [
      { key: "dashboard", label: "Dashboard" },
      { key: "empresas", label: "Empresas" },
      { key: "delegaciones", label: "Delegaciones" },
      { key: "usuarios", label: "Usuarios" },
      { key: "vehiculos", label: "Vehículos" },
      { key: "neumaticos", label: "Neumáticos" },
      { key: "montajes", label: "Montajes actuales" },
      { key: "operaciones", label: "Operaciones" },
      { key: "revision-vehiculo", label: "Revisión de vehículo" },
      { key: "autorizaciones", label: "Autorizaciones" },
      { key: "medidas-neumaticos", label: "Medidas de neumáticos" },
      { key: "catalogo-neumaticos", label: "Catálogo de neumáticos" },
      { key: "configuracion", label: "Configuración" },
      { key: "perfil", label: "Perfil" },
    ],
  },
  {
    key: "sea-core",
    label: "SEA Core (RRHH)",
    roles: ROL_ACCESO,
    pantallas: [
      { key: "dashboard", label: "Panel" },
      { key: "empleados", label: "Empleados" },
      { key: "empresas", label: "Empresas" },
      { key: "centros", label: "Centros de trabajo" },
      { key: "competencias", label: "Competencias" },
      { key: "autorizaciones", label: "Autorizaciones" },
    ],
  },
  {
    key: "toolcontrol",
    label: "ToolControl",
    roles: ROL_ACCESO,
    pantallas: [
      { key: "dashboard", label: "Panel" },
      { key: "herramientas", label: "Herramientas" },
      { key: "maquinas", label: "Máquinas" },
      { key: "movimientos", label: "Movimientos" },
      { key: "mantenimiento", label: "Mantenimiento" },
      { key: "inventario", label: "Inventario" },
      { key: "incidencias", label: "Incidencias" },
      { key: "ubicaciones", label: "Ubicaciones" },
      { key: "categorias", label: "Categorías" },
    ],
  },
  {
    key: "safety",
    label: "Safety Manager",
    roles: ROL_ACCESO,
    pantallas: [
      { key: "dashboard", label: "Panel" },
      { key: "epis", label: "EPIs" },
      { key: "entregas", label: "Entregas" },
      { key: "stock", label: "Stock" },
      { key: "documentos", label: "Documentos" },
      { key: "reuniones", label: "Reuniones" },
      { key: "formacion", label: "Formación" },
      { key: "inspecciones", label: "Inspecciones" },
    ],
  },
  {
    key: "presencia",
    label: "Presencia",
    roles: ROL_ACCESO,
    pantallas: [
      { key: "dashboard", label: "Panel" },
      { key: "fichajes", label: "Fichajes" },
    ],
  },
];
