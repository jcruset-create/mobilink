import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../models/cliente_activo.dart';
import '../screens/cliente_screen.dart';
import '../screens/login_screen.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Cabecera de la app: logo a 4 cm de ancho (252 px lógicos), con el nombre
/// del técnico y la versión al lado (siempre visibles; el nombre se cachea
/// para que salga también sin cobertura). A la derecha, el estado.
class TopStatusBar extends StatefulWidget implements PreferredSizeWidget {
  const TopStatusBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(148);

  @override
  State<TopStatusBar> createState() => _TopStatusBarState();
}

class _TopStatusBarState extends State<TopStatusBar> {
  String? _nombre;
  String _version = '';

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (mounted) setState(() => _version = 'v${info.version}');
    } catch (_) {/* ignore */}

    // Nombre del técnico: primero el cacheado (instantáneo, funciona sin
    // red) y después el del servidor, que refresca la caché.
    final cacheado = OfflineStore.cachedJson('perfil_nombre');
    if (cacheado is String && cacheado.isNotEmpty && mounted) {
      setState(() => _nombre = cacheado);
    }
    try {
      final perfil = await TyreControlApi.obtenerMiPerfil();
      final nombre = perfil?['nombre'] as String?;
      if (nombre != null && nombre.isNotEmpty) {
        await OfflineStore.cacheJson('perfil_nombre', nombre);
        if (mounted) setState(() => _nombre = nombre);
      }
    } catch (_) {/* sin red: se queda el cacheado */}
  }

  Future<void> _cerrarSesion(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Cerrar sesión'),
        content: const Text('¿Salir de la aplicación?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: const Text('Cancelar')),
          TextButton(
            onPressed: () => Navigator.of(c).pop(true),
            child: const Text('Cerrar sesión', style: TextStyle(color: AppColors.danger)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await TyreControlApi.signOut(); // olvida el cliente activo
    await OfflineStore.limpiarDatosCliente(); // limpia cachés del cliente
    if (!context.mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  void _cambiarCliente(BuildContext context) {
    // Vuelve a la selección de cliente, limpiando el stack (así no quedan
    // pantallas del cliente anterior).
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const ClienteScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.background,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Fila 1: logo + técnico/versión + estado de sistema
              Row(
                children: [
                  Image.asset(
                    'assets/logo_cabecera.png',
                    width: 150,
                    fit: BoxFit.contain,
                    alignment: Alignment.centerLeft,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.person, size: 18, color: AppColors.textSecondary),
                            const SizedBox(width: 5),
                            Flexible(
                              child: Text(
                                _nombre ?? '—',
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                              ),
                            ),
                          ],
                        ),
                        if (_version.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(left: 23, top: 1),
                            child: Text(_version, style: const TextStyle(fontSize: 12, color: AppColors.textHint)),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      ValueListenableBuilder<bool>(
                        valueListenable: OfflineStore.offline,
                        builder: (_, isOffline, __) => _Pill(
                          icon: isOffline ? Icons.cloud_off : Icons.cloud_done,
                          color: isOffline ? AppColors.warning : AppColors.success,
                          label: isOffline ? 'Sin conexión' : 'Conectado',
                        ),
                      ),
                      ValueListenableBuilder<int>(
                        valueListenable: OfflineStore.pendingCount,
                        builder: (_, n, __) => n == 0
                            ? const SizedBox.shrink()
                            : Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: _Pill(icon: Icons.sync, color: AppColors.info, label: '$n por sincronizar'),
                              ),
                      ),
                    ],
                  ),
                  // Cerrar sesión: a la derecha del estado, en la cabecera, para
                  // tenerlo siempre a mano al acabar la jornada.
                  const SizedBox(width: 4),
                  IconButton(
                    onPressed: () => _cerrarSesion(context),
                    icon: const Icon(Icons.logout, color: AppColors.danger),
                    tooltip: 'Cerrar sesión',
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              // Fila 2: cliente activo (siempre visible) + botón "Cambiar"
              ValueListenableBuilder<ClienteActivo?>(
                valueListenable: TyreControlApi.clienteActivo,
                builder: (_, cli, __) {
                  final esAdmin = cli?.esAdminTodos ?? false;
                  final color = esAdmin ? AppColors.warning : AppColors.primary;
                  return Container(
                    padding: const EdgeInsets.only(left: 12, right: 4, top: 4, bottom: 4),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: color.withValues(alpha: 0.55)),
                    ),
                    child: Row(
                      children: [
                        Icon(esAdmin ? Icons.admin_panel_settings : Icons.business, size: 18, color: color),
                        const SizedBox(width: 8),
                        const Text('Cliente:', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            cli?.nombre ?? 'Sin cliente',
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: color),
                          ),
                        ),
                        TextButton.icon(
                          onPressed: () => _cambiarCliente(context),
                          icon: const Icon(Icons.swap_horiz, size: 18),
                          label: const Text('Cambiar'),
                          style: TextButton.styleFrom(foregroundColor: color, visualDensity: VisualDensity.compact),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  const _Pill({required this.icon, required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
