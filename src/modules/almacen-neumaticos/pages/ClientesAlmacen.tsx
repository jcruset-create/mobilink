import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type Empresa = { id: string; nombre: string };

type Cliente = {
  id: string;
  empresa_id?: string | null;
  codigo: string | null;
  nombre: string;
  nif: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
};

type ClienteContacto = {
  id: string;
  cliente_id: string;
  nombre: string;
  cargo: string | null;
  movil: string | null;
  email: string | null;
  observaciones: string | null;
  activo: boolean;
  created_at: string | null;
};

export default function ClientesAlmacen() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [contactos, setContactos] = useState<ClienteContacto[]>([]);

  const [empresaId, setEmpresaId] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [nif, setNif] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");

  const [clienteEditandoId, setClienteEditandoId] = useState("");
  const [clienteSeleccionadoId, setClienteSeleccionadoId] = useState("");

  const [contactoNombre, setContactoNombre] = useState("");
  const [contactoCargo, setContactoCargo] = useState("");
  const [contactoMovil, setContactoMovil] = useState("");
  const [contactoEmail, setContactoEmail] = useState("");
  const [contactoObservaciones, setContactoObservaciones] = useState("");

  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    cargarDatos();
  }, []);

  function aplicarParametrosOCR(empresasDisponibles: Empresa[]) {
    const params = new URLSearchParams(window.location.search);

    if (params.get("nuevo") !== "1") {
      return;
    }

    const codigoParam = params.get("codigo") || "";
    const nombreParam = params.get("nombre") || "";
    const direccionParam = params.get("direccion") || "";
    const empresaParam = params.get("empresa_id") || "";

    setClienteEditandoId("");
    setClienteSeleccionadoId("");
    setCodigo(codigoParam);
    setNombre(nombreParam);
    setNif("");
    setTelefono("");
    setEmail("");

    if (empresaParam) {
      setEmpresaId(empresaParam);
    } else if (empresasDisponibles.length > 0) {
      setEmpresaId(empresasDisponibles[0].id);
    }

    setMensaje(
      [
        "Cliente importado desde OCR. Revisa los datos y pulsa Crear cliente.",
        direccionParam ? `Dirección OCR: ${direccionParam}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function cargarDatos() {
    setMensaje("");

    const { data: empresasData, error: empresasError } = await supabase
      .from("empresas")
      .select("id,nombre")
      .order("nombre");

    if (empresasError) {
      setMensaje(`Error empresas: ${empresasError.message}`);
      return;
    }

    const { data: clientesData, error: clientesError } = await supabase
      .from("clientes")
      .select("id,empresa_id,codigo,nombre,nif,telefono,email,activo")
      .order("nombre");

    if (clientesError) {
      setMensaje(`Error clientes: ${clientesError.message}`);
      return;
    }

    const { data: contactosData, error: contactosError } = await supabase
      .from("cliente_contactos")
      .select("id,cliente_id,nombre,cargo,movil,email,observaciones,activo,created_at")
      .order("nombre");

    if (contactosError) {
      setMensaje(`Error contactos: ${contactosError.message}`);
      return;
    }

    const empresasFinales = (empresasData || []) as Empresa[];

    setEmpresas(empresasFinales);
    setClientes((clientesData || []) as Cliente[]);
    setContactos((contactosData || []) as ClienteContacto[]);

    if (!empresaId && empresasFinales.length > 0) {
      setEmpresaId(empresasFinales[0].id);
    }

    aplicarParametrosOCR(empresasFinales);
  }

  function limpiarFormularioCliente() {
    setClienteEditandoId("");
    setCodigo("");
    setNombre("");
    setNif("");
    setTelefono("");
    setEmail("");

    if (empresas.length > 0) {
      setEmpresaId(empresas[0].id);
    }
  }

  function limpiarFormularioContacto() {
    setContactoNombre("");
    setContactoCargo("");
    setContactoMovil("");
    setContactoEmail("");
    setContactoObservaciones("");
  }

  function editarCliente(cliente: Cliente) {
    setClienteEditandoId(cliente.id);
    setClienteSeleccionadoId(cliente.id);
    setEmpresaId(cliente.empresa_id || empresaId);
    setCodigo(cliente.codigo || "");
    setNombre(cliente.nombre || "");
    setNif(cliente.nif || "");
    setTelefono(cliente.telefono || "");
    setEmail(cliente.email || "");
    setMensaje(`Editando cliente: ${cliente.nombre}`);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function guardarCliente() {
    setMensaje("");

    if (!empresaId || !nombre.trim()) {
      setMensaje("Empresa y nombre son obligatorios.");
      return;
    }

    if (clienteEditandoId) {
      const { error } = await supabase
        .from("clientes")
        .update({
          empresa_id: empresaId,
          codigo: codigo.trim() || null,
          nombre: nombre.trim(),
          nif: nif.trim() || null,
          telefono: telefono.trim() || null,
          email: email.trim() || null,
        })
        .eq("id", clienteEditandoId);

      if (error) {
        setMensaje(`Error actualizando cliente: ${error.message}`);
        return;
      }

      setMensaje("Cliente actualizado correctamente.");
      limpiarFormularioCliente();
      cargarDatos();
      return;
    }

    const { error } = await supabase.from("clientes").insert({
      empresa_id: empresaId,
      codigo: codigo.trim() || null,
      nombre: nombre.trim(),
      nif: nif.trim() || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      activo: true,
    });

    if (error) {
      setMensaje(`Error creando cliente: ${error.message}`);
      return;
    }

    setMensaje("Cliente creado correctamente. Puedes volver a Entradas y leer de nuevo el OCR.");
    limpiarFormularioCliente();
    cargarDatos();
  }

  async function cambiarEstadoCliente(cliente: Cliente) {
    setMensaje("");

    const { error } = await supabase
      .from("clientes")
      .update({
        activo: !cliente.activo,
      })
      .eq("id", cliente.id);

    if (error) {
      setMensaje(`Error cambiando estado: ${error.message}`);
      return;
    }

    setMensaje(cliente.activo ? "Cliente dado de baja." : "Cliente reactivado.");
    cargarDatos();
  }

  async function crearContacto() {
    setMensaje("");

    if (!clienteSeleccionadoId) {
      setMensaje("Selecciona primero un cliente.");
      return;
    }

    if (!contactoNombre.trim()) {
      setMensaje("El nombre del contacto/conductor es obligatorio.");
      return;
    }

    const { error } = await supabase.from("cliente_contactos").insert({
      cliente_id: clienteSeleccionadoId,
      nombre: contactoNombre.trim(),
      cargo: contactoCargo.trim() || null,
      movil: contactoMovil.trim() || null,
      email: contactoEmail.trim() || null,
      observaciones: contactoObservaciones.trim() || null,
      activo: true,
    });

    if (error) {
      setMensaje(`Error creando contacto: ${error.message}`);
      return;
    }

    setMensaje("Contacto creado correctamente.");
    limpiarFormularioContacto();
    cargarDatos();
  }

  async function cambiarEstadoContacto(contacto: ClienteContacto) {
    setMensaje("");

    const { error } = await supabase
      .from("cliente_contactos")
      .update({
        activo: !contacto.activo,
      })
      .eq("id", contacto.id);

    if (error) {
      setMensaje(`Error cambiando contacto: ${error.message}`);
      return;
    }

    setMensaje(
      contacto.activo ? "Contacto desactivado." : "Contacto reactivado."
    );
    cargarDatos();
  }

  const clienteSeleccionado = clientes.find(
    (cliente) => cliente.id === clienteSeleccionadoId
  );

  const contactosClienteSeleccionado = contactos.filter(
    (contacto) => contacto.cliente_id === clienteSeleccionadoId
  );

  function filasExportacionClientes(): FilaExportacion[] {
    return clientes.map((cliente) => {
      const contactosCliente = contactos.filter(
        (contacto) => contacto.cliente_id === cliente.id
      );

      return {
        cliente_id: cliente.id,
        codigo: cliente.codigo || "",
        nombre: cliente.nombre,
        nif: cliente.nif || "",
        telefono: cliente.telefono || "",
        email: cliente.email || "",
        estado: cliente.activo ? "Activo" : "Baja",
        activo: cliente.activo ? "Sí" : "No",
        contactos: contactosCliente
          .map(
            (contacto) =>
              `${contacto.nombre} ${contacto.movil ? `(${contacto.movil})` : ""}`
          )
          .join(" | "),
      };
    });
  }

  function exportarClientesCsv() {
    const filas = filasExportacionClientes();

    if (filas.length === 0) {
      setMensaje("No hay clientes para exportar.");
      return;
    }

    exportarCsv("clientes-almacen", filas);
  }

  async function exportarClientesExcel() {
    const filas = filasExportacionClientes();

    if (filas.length === 0) {
      setMensaje("No hay clientes para exportar.");
      return;
    }

    await exportarExcel("clientes-almacen", "Clientes", filas);
  }

  return (
    <div className="p-6 space-y-6">
      <AlmacenMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-gray-500">
            Alta, edición y contactos/conductores por cliente.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarClientesCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={clientes.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarClientesExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={clientes.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <div>
          <h2 className="font-semibold">
            {clienteEditandoId ? "Editar cliente" : "Crear cliente"}
          </h2>

          {clienteEditandoId && (
            <p className="mt-1 text-sm font-semibold text-blue-700">
              Editando: {nombre}
            </p>
          )}
        </div>

        <select
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Empresa...</option>
          {empresas.map((empresa) => (
            <option key={empresa.id} value={empresa.id}>
              {empresa.nombre}
            </option>
          ))}
        </select>

        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Código cliente"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del cliente"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={nif}
          onChange={(e) => setNif(e.target.value)}
          placeholder="NIF / CIF"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="Teléfono"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={guardarCliente}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            {clienteEditandoId ? "Guardar cambios" : "Crear cliente"}
          </button>

          {clienteEditandoId && (
            <button
              type="button"
              onClick={limpiarFormularioCliente}
              className="rounded-xl border px-4 py-2 text-sm font-semibold"
            >
              Cancelar edición
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Código</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">NIF</th>
              <th className="p-3">Teléfono</th>
              <th className="p-3">Email</th>
              <th className="p-3">Contactos</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Acciones</th>
            </tr>
          </thead>

          <tbody>
            {clientes.map((cliente) => {
              const totalContactos = contactos.filter(
                (contacto) => contacto.cliente_id === cliente.id
              ).length;

              return (
                <tr
                  key={cliente.id}
                  className={`border-t ${
                    clienteSeleccionadoId === cliente.id ? "bg-blue-50" : ""
                  }`}
                >
                  <td className="p-3">{cliente.codigo || "-"}</td>
                  <td className="p-3 font-medium">{cliente.nombre}</td>
                  <td className="p-3">{cliente.nif || "-"}</td>
                  <td className="p-3">{cliente.telefono || "-"}</td>
                  <td className="p-3">{cliente.email || "-"}</td>
                  <td className="p-3">{totalContactos}</td>
                  <td className="p-3">{cliente.activo ? "Activo" : "Baja"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setClienteSeleccionadoId(cliente.id)}
                        className="rounded-lg border px-3 py-1 text-xs font-semibold"
                      >
                        Contactos
                      </button>

                      <button
                        type="button"
                        onClick={() => editarCliente(cliente)}
                        className="rounded-lg border px-3 py-1 text-xs font-semibold"
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => cambiarEstadoCliente(cliente)}
                        className="rounded-lg border px-3 py-1 text-xs font-semibold"
                      >
                        {cliente.activo ? "Dar baja" : "Reactivar"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {clientes.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-gray-500">
                  No hay clientes creados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Contactos / conductores del cliente</h2>

        {!clienteSeleccionado ? (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            Selecciona un cliente desde la tabla para ver o añadir contactos.
          </p>
        ) : (
          <>
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
              Cliente seleccionado: <strong>{clienteSeleccionado.nombre}</strong>
            </div>

            <div className="grid gap-3 md:grid-cols-5">
              <input
                value={contactoNombre}
                onChange={(e) => setContactoNombre(e.target.value)}
                placeholder="Nombre contacto / conductor"
                className="rounded-lg border px-3 py-2 text-sm"
              />

              <input
                value={contactoCargo}
                onChange={(e) => setContactoCargo(e.target.value)}
                placeholder="Cargo / tipo"
                className="rounded-lg border px-3 py-2 text-sm"
              />

              <input
                value={contactoMovil}
                onChange={(e) => setContactoMovil(e.target.value)}
                placeholder="Móvil"
                className="rounded-lg border px-3 py-2 text-sm"
              />

              <input
                value={contactoEmail}
                onChange={(e) => setContactoEmail(e.target.value)}
                placeholder="Email"
                className="rounded-lg border px-3 py-2 text-sm"
              />

              <input
                value={contactoObservaciones}
                onChange={(e) => setContactoObservaciones(e.target.value)}
                placeholder="Observaciones"
                className="rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <button
              type="button"
              onClick={crearContacto}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Añadir contacto
            </button>

            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="p-3">Nombre</th>
                    <th className="p-3">Cargo / tipo</th>
                    <th className="p-3">Móvil</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Observaciones</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Acción</th>
                  </tr>
                </thead>

                <tbody>
                  {contactosClienteSeleccionado.map((contacto) => (
                    <tr key={contacto.id} className="border-t">
                      <td className="p-3 font-medium">{contacto.nombre}</td>
                      <td className="p-3">{contacto.cargo || "-"}</td>
                      <td className="p-3">{contacto.movil || "-"}</td>
                      <td className="p-3">{contacto.email || "-"}</td>
                      <td className="p-3">{contacto.observaciones || "-"}</td>
                      <td className="p-3">
                        {contacto.activo ? "Activo" : "Inactivo"}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => cambiarEstadoContacto(contacto)}
                          className="rounded-lg border px-3 py-1 text-xs font-semibold"
                        >
                          {contacto.activo ? "Desactivar" : "Reactivar"}
                        </button>
                      </td>
                    </tr>
                  ))}

                  {contactosClienteSeleccionado.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-gray-500">
                        Este cliente todavía no tiene contactos.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}