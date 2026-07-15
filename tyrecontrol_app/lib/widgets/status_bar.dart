import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Cabecera de la app: mismas dimensiones que la app de asistencias
/// (alto 108, logo a la izquierda a 50 de alto, con el nombre del técnico
/// y la versión debajo). A la derecha, el estado (conexión / pendientes).
class TopStatusBar extends StatefulWidget implements PreferredSizeWidget {
  const TopStatusBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(108);

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
      String? nombre;
      try {
        final perfil = await TyreControlApi.obtenerMiPerfil();
        nombre = perfil?['nombre'] as String?;
      } catch (_) {/* sin red: solo versión */}
      if (!mounted) return;
      setState(() {
        _nombre = nombre;
        _version = 'v${info.version}';
      });
    } catch (_) {/* ignore */}
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.background,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            children: [
              // Logo + técnico + versión (mismo patrón que asistencias)
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Image.asset(
                      'assets/logo_cabecera.png',
                      height: 50,
                      fit: BoxFit.contain,
                      alignment: Alignment.centerLeft,
                    ),
                    if (_nombre != null && _nombre!.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(left: 2, top: 2),
                        child: Text(
                          _nombre!,
                          style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary),
                        ),
                      ),
                    if (_version.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(left: 2, top: 1),
                        child: Text(
                          _version,
                          style: const TextStyle(
                              fontSize: 11, color: AppColors.textHint),
                        ),
                      ),
                  ],
                ),
              ),
              // Estado del sistema, a la derecha
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
                            child: _Pill(
                                icon: Icons.sync,
                                color: AppColors.info,
                                label: '$n por sincronizar'),
                          ),
                  ),
                ],
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
