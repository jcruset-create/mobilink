import { useEffect, useState } from "react";
import { obtenerSesionActual } from "../services/authAlmacen";

type RequireAuthProps = {
  children: React.ReactNode;
};

export default function RequireAuth({ children }: RequireAuthProps) {
  const [comprobando, setComprobando] = useState(true);
  const [autenticado, setAutenticado] = useState(false);

  useEffect(() => {
    comprobarSesion();
  }, []);

  async function comprobarSesion() {
    const { session } = await obtenerSesionActual();

    if (!session) {
      window.location.href = "/login";
      return;
    }

    setAutenticado(true);
    setComprobando(false);
  }

  if (comprobando) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-600">
        Comprobando sesión...
      </div>
    );
  }

  if (!autenticado) {
    return null;
  }

  return <>{children}</>;
}