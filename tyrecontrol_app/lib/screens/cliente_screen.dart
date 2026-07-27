import 'package:flutter/material.dart';
import '../models/cliente_activo.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'home_screen.dart';

/// Pantalla inicial (tras login): el técnico elige el CLIENTE con el que va a
/// trabajar durante la sesión. Si es administrador, además puede elegir
/// "Admin (Todos los clientes)" para ver todo sin filtro.
class ClienteScreen extends StatefulWidget {
  const ClienteScreen({super.key});

  @override
  State<ClienteScreen> createState() => _ClienteScreenState();
}

class _ClienteScreenState extends State<ClienteScreen> {
  List<Map<String, dynamic>> _empresas = [];
  bool _esAdmin = false;
  bool _loading = true;
  String? _error;
  String _q = '';
  String? _nombreTecnico;

  @override
  void initState() {
    super.initState();
    _nombreTecnico = OfflineStore.cachedJson('perfil_nombre') as String?;
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        TyreControlApi.listarEmpresasCliente(),
        TyreControlApi.esAdmin(),
        TyreControlApi.obtenerMiPerfil(),
      ]);
      if (!mounted) return;
      final perfil = results[2] as Map<String, dynamic>?;
      setState(() {
        _empresas = results[0] as List<Map<String, dynamic>>;
        _esAdmin = results[1] as bool;
        _nombreTecnico = (perfil?['nombre'] as String?) ?? _nombreTecnico;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = '$e'; _loading = false; });
    }
  }

  void _seleccionar(ClienteActivo c) async {
    // Cambiar de cliente limpia los datos cacheados del cliente anterior.
    await OfflineStore.limpiarDatosCliente();
    TyreControlApi.clienteActivo.value = c;
    // Recontar pendientes ya con el cliente aplicado (para el badge de Inicio).
    TyreControlApi.contarIncidenciasPendientes();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomeScreen()),
      (_) => false,
    );
  }

  List<Map<String, dynamic>> get _filtradas {
    final q = _q.trim().toLowerCase();
    if (q.isEmpty) return _empresas;
    return _empresas.where((e) => (e['nombre'] as String? ?? '').toLowerCase().contains(q)).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 8),
                  Image.asset('assets/logo_cabecera.png', width: 260, fit: BoxFit.contain),
                  const SizedBox(height: 18),
                  const Text('Selecciona el cliente',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
                  const SizedBox(height: 4),
                  Text(
                    _nombreTecnico != null ? 'Técnico: $_nombreTecnico' : 'Con qué cliente vas a trabajar en esta sesión',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 18),
                  Expanded(child: _cuerpo()),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _cuerpo() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.error_outline, color: AppColors.danger, size: 40),
          const SizedBox(height: 10),
          Text('No se pudieron cargar los clientes.\n$_error',
              textAlign: TextAlign.center, style: const TextStyle(color: AppColors.danger)),
          const SizedBox(height: 14),
          FilledButton(onPressed: _cargar, child: const Text('Reintentar')),
        ]),
      );
    }
    final items = _filtradas;
    return Column(
      children: [
        if (_empresas.length > 6)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: TextField(
              onChanged: (v) => setState(() => _q = v),
              decoration: InputDecoration(
                hintText: 'Buscar cliente…',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: AppColors.surface,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
          ),
        Expanded(
          child: ListView(
            children: [
              // Opción de administrador (solo si el usuario es admin).
              if (_esAdmin) ...[
                _tarjetaCliente(
                  nombre: 'Admin — Todos los clientes',
                  subtitulo: 'Ver los datos de todos los clientes, sin filtro',
                  icono: Icons.admin_panel_settings,
                  destacado: true,
                  onTap: () => _seleccionar(const ClienteActivo.adminTodos()),
                ),
                const SizedBox(height: 6),
                const Divider(color: AppColors.cardBorder),
                const SizedBox(height: 6),
              ],
              if (items.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 30),
                  child: Text('No hay clientes disponibles.',
                      textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
                ),
              for (final e in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _tarjetaCliente(
                    nombre: (e['nombre'] as String?) ?? '—',
                    icono: Icons.business,
                    onTap: () => _seleccionar(ClienteActivo.empresa((e['id'] as String), (e['nombre'] as String?) ?? '—')),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _tarjetaCliente({
    required String nombre,
    String? subtitulo,
    required IconData icono,
    bool destacado = false,
    required VoidCallback onTap,
  }) {
    final bg = destacado ? AppColors.primary.withValues(alpha: 0.14) : AppColors.surface;
    final border = destacado ? AppColors.primary : AppColors.cardBorder;
    final iconColor = destacado ? AppColors.primary : AppColors.textSecondary;
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: border, width: destacado ? 2 : 1),
          ),
          child: Row(
            children: [
              Icon(icono, color: iconColor, size: 28),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(nombre,
                        style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: destacado ? AppColors.primary : AppColors.textPrimary)),
                    if (subtitulo != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(subtitulo, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                      ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: AppColors.textHint),
            ],
          ),
        ),
      ),
    );
  }
}
