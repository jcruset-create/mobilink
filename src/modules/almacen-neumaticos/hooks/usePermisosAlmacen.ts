import { useEffect, useState } from "react";
import {
  cargarPermisosUsuarioActual,
  permisosIniciales,
  type PermisosAlmacen,
} from "../services/permisosAlmacen";

export function usePermisosAlmacen() {
  const [permisos, setPermisos] =
    useState<PermisosAlmacen>(permisosIniciales);
  const [cargandoPermisos, setCargandoPermisos] = useState(true);
  const [errorPermisos, setErrorPermisos] = useState("");

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargandoPermisos(true);
    setErrorPermisos("");

    try {
      const permisosCargados = await cargarPermisosUsuarioActual();

      if (!permisosCargados.perfil) {
        setPermisos(permisosIniciales);
        setErrorPermisos(
          "No se ha encontrado un perfil activo para el usuario conectado."
        );
        return;
      }

      setPermisos(permisosCargados);
    } catch {
      setPermisos(permisosIniciales);
      setErrorPermisos("Error cargando permisos del usuario conectado.");
    } finally {
      setCargandoPermisos(false);
    }
  }

  return {
    permisos,
    cargandoPermisos,
    errorPermisos,
    recargarPermisos: cargar,
  };
}