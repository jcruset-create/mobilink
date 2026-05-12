export default function AlmacenDashboard() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Almacén de Neumáticos</h1>
      <p className="text-gray-500">
        Módulo de gestión de stock de neumáticos por cliente.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <a href="/almacen-neumaticos/stock" className="rounded-xl border p-4">
          Stock operativo
        </a>

        <a href="/almacen-neumaticos/salidas" className="rounded-xl border p-4">
          Salidas / Montajes
        </a>

        <a href="/almacen-neumaticos/traspasos" className="rounded-xl border p-4">
          Traspasos
        </a>

        <a href="/almacen-neumaticos/reposiciones" className="rounded-xl border p-4">
          Reposiciones
        </a>

        <a href="/almacen-neumaticos/inventarios" className="rounded-xl border p-4">
          Inventarios
        </a>

        <a href="/almacen-neumaticos/incidencias" className="rounded-xl border p-4">
          Incidencias
        </a>
      </div>
    </div>
  );
}