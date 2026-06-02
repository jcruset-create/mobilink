export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
        <h1 className="text-4xl font-bold">404</h1>

        <p className="mt-2 text-lg font-semibold">Página no encontrada</p>

        <p className="mt-2 text-sm text-gray-500">
          La ruta que estás intentando abrir no existe o no está disponible.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <a
            href="/"
            className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            Ir al inicio
          </a>

          <a
            href="/almacen-neumaticos"
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Ir a almacén
          </a>
        </div>
      </div>
    </div>
  );
}