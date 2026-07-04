import 'package:flutter/material.dart';
import '../services/offline_store.dart';
import '../theme/app_theme.dart';

/// Franja de estado del sistema, presente en (casi) toda la app.
/// Nunca bloquea: informa, no interrumpe.
class TopStatusBar extends StatelessWidget implements PreferredSizeWidget {
  const TopStatusBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(28);

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 28,
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
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
