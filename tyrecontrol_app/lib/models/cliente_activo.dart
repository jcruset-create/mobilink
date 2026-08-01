/// Cliente (empresa) activo de la sesión. Se elige en la pantalla inicial de
/// selección y filtra todos los datos mientras dura la sesión.
///
/// - [empresaId] == null  → modo "Admin (Todos los clientes)": SIN filtro.
/// - [empresaId] != null  → un cliente concreto: todo se filtra por él.
class ClienteActivo {
  final String? empresaId;
  final String nombre; // nombre de la empresa o "Admin - Todos los clientes"

  const ClienteActivo({required this.empresaId, required this.nombre});

  /// Cliente concreto seleccionado.
  const ClienteActivo.empresa(String id, this.nombre) : empresaId = id;

  /// Modo administrador: ve todos los clientes, sin filtro.
  const ClienteActivo.adminTodos()
      : empresaId = null,
        nombre = 'Admin - Todos los clientes';

  bool get esAdminTodos => empresaId == null;
}
