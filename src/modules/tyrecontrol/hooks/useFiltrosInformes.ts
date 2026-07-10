import { useEffect, useState } from "react";
import { listarEmpresas } from "../services/data";
import type { Empresa } from "../types";
import type { FiltrosInformes } from "../types/informes";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Estado de los filtros globales de Informes, compartido por el Dashboard
// principal y la sección Informes. El cliente queda acotado a su empresa
// (y la RLS lo refuerza); admin/super-admin pueden elegir empresa.
export function useFiltrosInformes() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;

  const [filtros, setFiltros] = useState<FiltrosInformes>({
    empresaId: esCliente ? (perfil?.empresa_id ?? null) : null,
    desde: null,
    hasta: null,
  });
  const [empresas, setEmpresas] = useState<Empresa[]>([]);

  useEffect(() => {
    if (!esCliente) listarEmpresas().then(setEmpresas).catch(() => setEmpresas([]));
  }, [esCliente]);

  return { filtros, setFiltros, esCliente, empresas };
}
