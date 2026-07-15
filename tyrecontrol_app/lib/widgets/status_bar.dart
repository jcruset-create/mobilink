import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Cabecera de la app: logo TyreControl + usuario y versión, con la franja
/// de estado (conexión / pendientes) debajo. Nunca bloquea: informa.
class TopStatusBar extends StatefulWidget implements PreferredSizeWidget {
  const TopStatusBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(72);

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
    return Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Image.asset('assets/logo_cabecera.png', height: 34),
                const Spacer(),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_nombre != null && _nombre!.isNotEmpty)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.person, size: 14, color: AppColors.textSecondary),
                          const SizedBox(width: 4),
                          Text(_nombre!,
                              style: const TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textPrimary)),
                        ],
                      ),
                    if (_version.isNotEmpty)
                      Text(_version,
                          style: const TextStyle(
                              fontSize: 11, color: AppColors.textHint)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 4),
            SizedBox(
              height: 22,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  ValueListenableBuilder<bool>(
                    valueListenable: OfflineStore.offline,
                    builder: (_, isOffline, __) => _Pill(
                      icon: isOffline ? Icons.cloud_off : Icons.cloud_done,
                      color: isOffline ? AppColors.warning : AppColors.success,
                      label: isOffline ? 'Sin conexión' : 'Conectado',
                    ),
                  ),
                  const SizedBox(width: 8),
                  ValueListenableBuilder<int>(
                    valueListenable: OfflineStore.pendingCount,
                    builder: (_, n, __) => n == 0
                        ? const SizedBox.shrink()
                        : _Pill(icon: Icons.sync, color: AppColors.info, label: '$n por sincronizar'),
                  ),
                ],
              ),
            ),
          ],
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
