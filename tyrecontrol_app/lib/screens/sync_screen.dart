import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/offline_store.dart';
import '../theme/app_theme.dart';

class SyncScreen extends StatefulWidget {
  final bool embedded;
  const SyncScreen({super.key, this.embedded = false});

  @override
  State<SyncScreen> createState() => _SyncScreenState();
}

class _SyncScreenState extends State<SyncScreen> {
  bool _sincronizando = false;
  bool _reintentando = false;
  String? _ultimaSync;

  @override
  void initState() {
    super.initState();
    _cargarUltimaSync();
  }

  Future<void> _cargarUltimaSync() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() => _ultimaSync = prefs.getString('ultimaSync'));
  }

  Future<void> _sincronizarAhora() async {
    setState(() => _sincronizando = true);
    try {
      await OfflineStore.flush();
      final prefs = await SharedPreferences.getInstance();
      final ahora = DateTime.now();
      final texto = '${ahora.hour.toString().padLeft(2, '0')}:${ahora.minute.toString().padLeft(2, '0')}';
      await prefs.setString('ultimaSync', texto);
      setState(() => _ultimaSync = texto);
    } finally {
      if (mounted) setState(() => _sincronizando = false);
    }
  }

  Future<void> _reintentarErrores() async {
    setState(() => _reintentando = true);
    try {
      await OfflineStore.reintentarFallidos();
    } finally {
      if (mounted) setState(() => _reintentando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!widget.embedded) ...[
            Text('Sincronización', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
          ],
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  ValueListenableBuilder<bool>(
                    valueListenable: OfflineStore.offline,
                    builder: (_, off, __) => Icon(off ? Icons.cloud_off : Icons.cloud_done, color: off ? AppColors.warning : AppColors.success, size: 32),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ValueListenableBuilder<int>(
                          valueListenable: OfflineStore.pendingCount,
                          builder: (_, n, __) => Text(
                            n == 0 ? 'Todo sincronizado' : '$n cambio(s) pendientes de subir',
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                          ),
                        ),
                        if (_ultimaSync != null) Text('Última sincronización: $_ultimaSync', style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _sincronizando ? null : _sincronizarAhora,
            icon: _sincronizando
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onPrimary))
                : const Icon(Icons.sync),
            label: Text(_sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'),
          ),
          const SizedBox(height: 8),
          const Text(
            'La app trabaja online siempre que hay cobertura. Si no la hay, guarda '
            'los cambios en el dispositivo y los envía solos en cuanto vuelve la conexión.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),

          // Buzón de errores: items que el servidor rechazó (no se reintentan
          // en bucle para no bloquear). Recuperables una vez corregida la causa.
          ValueListenableBuilder<int>(
            valueListenable: OfflineStore.failedCount,
            builder: (_, n, __) {
              if (n == 0) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Card(
                  color: AppColors.warning.withValues(alpha: 0.12),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.error_outline, color: AppColors.warning),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text('$n dato(s) rechazados por el servidor',
                                  style: const TextStyle(fontWeight: FontWeight.w700)),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        const Text('No se han podido guardar en el servidor. Reintenta cuando el problema esté resuelto.',
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                        const SizedBox(height: 10),
                        OutlinedButton.icon(
                          onPressed: _reintentando ? null : _reintentarErrores,
                          icon: _reintentando
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.refresh),
                          label: Text(_reintentando ? 'Reintentando…' : 'Reintentar errores'),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
    if (widget.embedded) return body;
    return Scaffold(appBar: AppBar(title: const Text('Sincronización')), body: body);
  }
}
