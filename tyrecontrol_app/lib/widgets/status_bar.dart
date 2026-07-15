import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Cabecera de la app: logo a 4 cm de ancho (252 px lógicos), con el nombre
/// del técnico y la versión al lado (siempre visibles; el nombre se cachea
/// para que salga también sin cobertura). A la derecha, el estado.
class TopStatusBar extends StatefulWidget implements PreferredSizeWidget {
  const TopStatusBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(184);

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

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.background,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Row(
            children: [
              // Logo a 4 cm de ancho (252 px lógicos)
              Image.asset(
                'assets/logo_cabecera.png',
                width: 252,
                fit: BoxFit.contain,
                alignment: Alignment.centerLeft,
              ),
              const SizedBox(width: 14),
              // Técnico + versión, al lado del logo (siempre visibles)
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.person, size: 20, color: AppColors.textSecondary),
                        const SizedBox(width: 5),
                        Flexible(
                          child: Text(
                            _nombre ?? '—',
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary),
                          ),
                        ),
                      ],
                    ),
                    if (_version.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(left: 25, top: 2),
                        child: Text(
                          _version,
                          style: const TextStyle(
                              fontSize: 13, color: AppColors.textHint),
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
