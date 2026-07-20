import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:image_picker/image_picker.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../main.dart' show exteriorMode;
import '../services/api_service.dart';
import '../services/offline_store.dart';
import '../theme/app_theme.dart';
import 'assistance_detail_screen.dart';
import 'cobros_screen.dart';
import 'history_screen.dart';
import 'login_screen.dart';
import 'otf_screen.dart';
import 'payments_screen.dart';

class AssistancesScreen extends StatefulWidget {
  final ApiService api;
  const AssistancesScreen({super.key, required this.api});

  @override
  State<AssistancesScreen> createState() => _AssistancesScreenState();
}

class _AssistancesScreenState extends State<AssistancesScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  List<Map<String, dynamic>> _assistances = [];
  bool _loading = true;
  String? _error;
  String _techName = '';
  String _appVersion = '';
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
    _loadTechName();
    _loadVersion();
    _load();
    // Al recuperar conexión, recargar (esto envía la cola de cambios pendientes)
    _connSub = Connectivity().onConnectivityChanged.listen((results) {
      final hasNet = results.any((r) => r != ConnectivityResult.none);
      if (hasNet) _load();
    });
  }

  @override
  void dispose() {
    _connSub?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadTechName() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) setState(() => _techName = prefs.getString('techName') ?? '');
  }

  Future<void> _loadVersion() async {
    final info = await PackageInfo.fromPlatform();
    if (mounted) setState(() => _appVersion = 'v${info.version}');
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await widget.api.getAssistances();
      setState(() => _assistances = data);
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _logout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        title: const Text('Cerrar sesión', style: TextStyle(color: AppColors.textPrimary)),
        content: const Text('¿Seguro que quieres salir?', style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar', style: TextStyle(color: AppColors.textSecondary))),
          TextButton(onPressed: () => Navigator.pop(context, true),  child: const Text('Salir', style: TextStyle(color: AppColors.danger))),
        ],
      ),
    );
    if (confirmed != true) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('techName');
    await prefs.remove('code');
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  Future<void> _scanPlate() async {
    final picker = ImagePicker();
    final x = await picker.pickImage(source: ImageSource.camera, maxWidth: 1600);
    if (x == null) return;
    if (!mounted) return;
    showDialog(context: context, barrierDismissible: false, builder: (_) =>
        Center(child: CircularProgressIndicator(color: AppColors.primary)));
    try {
      final r = await widget.api.scanPlate(File(x.path));
      if (mounted) Navigator.of(context).pop(); // cerrar loader
      final plate = r['plate'] as String?;
      final assistanceId = r['assistanceId'] as int?;
      if (plate == null) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('No se pudo leer la matrícula'), backgroundColor: Colors.red));
        return;
      }
      if (assistanceId != null) {
        final found = _assistances.firstWhere((a) => a['id'] == assistanceId, orElse: () => {'id': assistanceId});
        if (!mounted) return;
        await Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => AssistanceDetailScreen(api: widget.api, assistance: found)));
        _load();
      } else {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Matrícula $plate · sin asistencia abierta asignada a ti'),
          backgroundColor: AppColors.info));
      }
    } catch (e) {
      if (mounted) Navigator.of(context).pop();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.red));
    }
  }

  Future<void> _toggleExteriorMode() async {
    final newVal = !exteriorMode.value;
    exteriorMode.value = newVal;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('exteriorMode', newVal);
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final isExterior = exteriorMode.value;

    return Scaffold(
      appBar: PreferredSize(
        preferredSize: Size.fromHeight(isExterior ? 120 : 108),
        child: Container(
          color: AppColors.background,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      // Logo + nombre
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Image.asset(
                              'assets/logo_horizontal2.png',
                              height: isExterior ? 70 : 62,
                              fit: BoxFit.contain,
                              alignment: Alignment.centerLeft,
                            ),
                            if (_techName.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(left: 2, top: 2),
                                child: Text(
                                  _techName,
                                  style: tt.labelSmall?.copyWith(color: AppColors.textSecondary),
                                ),
                              ),
                            if (_appVersion.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(left: 2, top: 1),
                                child: Text(
                                  _appVersion,
                                  style: tt.labelSmall?.copyWith(color: AppColors.textHint, fontSize: 11),
                                ),
                              ),
                          ],
                        ),
                      ),
                      // Pestañas
                      TabBar(
                        controller: _tabController,
                        isScrollable: true,
                        tabAlignment: TabAlignment.start,
                        dividerColor: Colors.transparent,
                        tabs: [
                          Tab(icon: Icon(Icons.assignment_outlined, size: isExterior ? 28 : 24), text: 'Activas'),
                          Tab(icon: Icon(Icons.local_shipping_outlined, size: isExterior ? 28 : 24), text: 'OTF'),
                          Tab(icon: Icon(Icons.history,              size: isExterior ? 28 : 24), text: 'Historial'),
                          Tab(icon: Icon(Icons.receipt_long_outlined,size: isExterior ? 28 : 24), text: 'Cobros'),
                          Tab(icon: Icon(Icons.add_card_outlined,    size: isExterior ? 28 : 24), text: 'Pagos'),
                        ],
                      ),
                      // Acciones
                      const SizedBox(width: 4),
                      ValueListenableBuilder<bool>(
                        valueListenable: exteriorMode,
                        builder: (_, ext, __) => _TopBarIcon(
                          icon: ext ? Icons.wb_sunny : Icons.wb_sunny_outlined,
                          color: ext ? AppColors.primary : AppColors.textSecondary,
                          tooltip: ext ? 'Modo exterior activo' : 'Activar modo exterior',
                          onPressed: _toggleExteriorMode,
                        ),
                      ),
                      _TopBarIcon(icon: Icons.qr_code_scanner,        color: AppColors.info,          tooltip: 'Escanear matrícula', onPressed: _scanPlate),
                      _TopBarIcon(icon: Icons.refresh_outlined,      color: AppColors.textSecondary, tooltip: 'Actualizar',    onPressed: _load),
                      _TopBarIcon(icon: Icons.logout,                 color: AppColors.danger,        tooltip: 'Cerrar sesión', onPressed: _logout),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          const _OfflineBanner(),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _ActiveAssistancesTab(
                  loading: _loading,
                  error: _error,
                  assistances: _assistances,
                  onRefresh: _load,
                  api: widget.api,
                ),
                OtfListTab(api: widget.api),
                HistoryScreen(api: widget.api),
                CobrosScreen(api: widget.api),
                PaymentsScreen(api: widget.api),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Banner de conexión / pendientes de sincronizar ───────────────────────────
class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner();

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: OfflineStore.offline,
      builder: (_, isOffline, __) => ValueListenableBuilder<int>(
        valueListenable: OfflineStore.pendingCount,
        builder: (_, pending, __) {
          if (!isOffline && pending == 0) return const SizedBox.shrink();
          final color = isOffline ? AppColors.warning : AppColors.info;
          final text = isOffline
              ? (pending > 0
                  ? 'Sin conexión · $pending cambio${pending == 1 ? '' : 's'} pendiente${pending == 1 ? '' : 's'}'
                  : 'Sin conexión · trabajando offline')
              : '$pending cambio${pending == 1 ? '' : 's'} pendiente${pending == 1 ? '' : 's'} de sincronizar';
          return Container(
            width: double.infinity,
            color: color.withValues(alpha: 0.18),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(isOffline ? Icons.cloud_off : Icons.sync, size: 16, color: color),
                const SizedBox(width: 8),
                Text(text, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w700)),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ── Icono de barra superior ───────────────────────────────────────────────────
class _TopBarIcon extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String tooltip;
  final VoidCallback onPressed;

  const _TopBarIcon({required this.icon, required this.color, required this.tooltip, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 48,
          height: 48,
          child: Icon(icon, color: color, size: 26),
        ),
      ),
    );
  }
}

// ── Bloque destacado (avería / trabajos) en la tarjeta ────────────────────────
class _CardBlock extends StatelessWidget {
  final String title;
  final String text;
  final Color color;
  const _CardBlock({required this.title, required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
          const SizedBox(height: 3),
          Text(text, style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, height: 1.3)),
        ],
      ),
    );
  }
}

// ── Tab de asistencias activas ────────────────────────────────────────────────
class _ActiveAssistancesTab extends StatelessWidget {
  final bool loading;
  final String? error;
  final List<Map<String, dynamic>> assistances;
  final Future<void> Function() onRefresh;
  final ApiService api;

  const _ActiveAssistancesTab({
    required this.loading,
    required this.error,
    required this.assistances,
    required this.onRefresh,
    required this.api,
  });

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

    if (loading) {
      return Center(child: CircularProgressIndicator(color: AppColors.primary));
    }

    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off_outlined, color: AppColors.danger, size: 48),
              const SizedBox(height: 16),
              Text('Sin conexión', style: tt.titleMedium),
              const SizedBox(height: 8),
              Text(error!, style: tt.bodyMedium, textAlign: TextAlign.center),
              const SizedBox(height: 24),
              SizedBox(
                width: 200,
                child: ElevatedButton.icon(
                  onPressed: onRefresh,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Reintentar'),
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (assistances.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.assignment_outlined, color: AppColors.textHint, size: 56),
            const SizedBox(height: 16),
            Text('Sin asistencias asignadas', style: tt.bodyLarge?.copyWith(color: AppColors.textSecondary)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      backgroundColor: AppColors.surface,
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        itemCount: assistances.length,
        itemBuilder: (_, i) {
          final a = assistances[i];
          final status = a['status'] as String? ?? '';
          final color = statusColor(status);
          final label = statusLabel(status);
          final plate = (a['plate'] as String? ?? '').toUpperCase();
          final customer = a['customerName'] as String? ?? '';
          final address = a['address'] as String? ?? '';
          final averia = (a['descripcionAveria'] as String? ?? '').trim();
          final trabajos = (a['trabajosARealizar'] as String? ?? '').trim();
          final photoUrls = (a['photoUrls'] as List<dynamic>?)?.cast<String>() ?? const <String>[];

          return Card(
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => AssistanceDetailScreen(api: api, assistance: a)),
                );
                onRefresh();
              },
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: IntrinsicHeight(
                  child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Indicador de estado lateral
                    Container(
                      width: 4,
                      decoration: BoxDecoration(
                        color: color,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(width: 14),
                    // Contenido principal
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(plate, style: tt.titleMedium),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  customer,
                                  style: tt.bodyMedium,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            address,
                            style: tt.bodyMedium?.copyWith(color: AppColors.textHint),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 8),
                          // Badge de estado
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: color.withValues(alpha: 0.15),
                              border: Border.all(color: color.withValues(alpha: 0.5)),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              label,
                              style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w500),
                            ),
                          ),
                          // Avería
                          if (averia.isNotEmpty) ...[
                            const SizedBox(height: 10),
                            _CardBlock(title: '🔧 AVERÍA', text: averia, color: AppColors.warning),
                          ],
                          // Trabajos a realizar
                          if (trabajos.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            _CardBlock(title: '📋 TRABAJOS A REALIZAR', text: trabajos, color: AppColors.primary),
                          ],
                          // Fotos
                          if (photoUrls.isNotEmpty) ...[
                            const SizedBox(height: 10),
                            SizedBox(
                              height: 64,
                              child: ListView.separated(
                                scrollDirection: Axis.horizontal,
                                itemCount: photoUrls.length,
                                separatorBuilder: (_, __) => const SizedBox(width: 8),
                                itemBuilder: (_, p) => ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: Image.network(
                                    photoUrls[p],
                                    width: 64, height: 64, fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) => Container(
                                      width: 64, height: 64, color: AppColors.surfaceVariant,
                                      child: const Icon(Icons.broken_image, color: AppColors.textHint, size: 20),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Icon(Icons.chevron_right, color: color, size: 28),
                  ],
                ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
