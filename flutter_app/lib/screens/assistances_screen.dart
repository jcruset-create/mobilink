import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import 'assistance_detail_screen.dart';
import 'cobros_screen.dart';
import 'history_screen.dart';
import 'login_screen.dart';
import 'payments_screen.dart';

const _statusLabels = {
  'pendiente': 'Pendiente',
  'asignada': 'Asignada',
  'en_camino': 'En camino',
  'en_punto': 'En punto',
  'inicio_reparacion': 'Reparando',
  'finalizada': 'Finalizada',
  'llegada_taller': 'En taller',
  'cancelada': 'Cancelada',
};

const _statusColors = {
  'pendiente': Colors.orange,
  'asignada': Colors.blue,
  'en_camino': Colors.lightBlue,
  'en_punto': Colors.purple,
  'inicio_reparacion': Colors.deepOrange,
  'finalizada': Colors.green,
  'llegada_taller': Colors.teal,
  'cancelada': Colors.grey,
};

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

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
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
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('techName');
    await prefs.remove('code');
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(110),
        child: Container(
          color: const Color(0xFF16213e),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: SafeArea(
            child: Row(
              children: [
                // Logo grande
                Expanded(
                  child: Image.asset(
                    'assets/logo_horizontal.png',
                    height: 90,
                    fit: BoxFit.contain,
                    alignment: Alignment.centerLeft,
                  ),
                ),
                // Pestañas inline
                TabBar(
                  controller: _tabController,
                  isScrollable: true,
                  indicatorColor: Colors.blue,
                  labelColor: Colors.white,
                  unselectedLabelColor: Colors.white54,
                  tabAlignment: TabAlignment.start,
                  labelStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  tabs: const [
                    Tab(icon: Icon(Icons.assignment, size: 26), text: 'Activas'),
                    Tab(icon: Icon(Icons.history, size: 26), text: 'Historial'),
                    Tab(icon: Icon(Icons.receipt_long, size: 26), text: 'Cobros'),
                    Tab(icon: Icon(Icons.add_card, size: 26), text: 'Pagos'),
                  ],
                ),
                // Acciones
                IconButton(iconSize: 28, icon: const Icon(Icons.refresh, color: Colors.white), onPressed: _load),
                IconButton(iconSize: 28, icon: const Icon(Icons.logout, color: Colors.white), onPressed: _logout),
              ],
            ),
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _ActiveAssistancesTab(
            loading: _loading,
            error: _error,
            assistances: _assistances,
            onRefresh: _load,
            api: widget.api,
          ),
          HistoryScreen(api: widget.api),
          CobrosScreen(api: widget.api),
          PaymentsScreen(api: widget.api),
        ],
      ),
    );
  }
}

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
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error!, style: const TextStyle(color: Colors.redAccent)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: onRefresh, child: const Text('Reintentar')),
          ],
        ),
      );
    }
    if (assistances.isEmpty) {
      return const Center(
        child: Text('No tienes asistencias asignadas',
            style: TextStyle(color: Colors.white54)),
      );
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: assistances.length,
        itemBuilder: (_, i) {
          final a = assistances[i];
          final status = a['status'] as String? ?? '';
          final color = _statusColors[status] ?? Colors.grey;
          return Card(
            color: const Color(0xFF16213e),
            margin: const EdgeInsets.only(bottom: 12),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)),
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              title: Text(
                a['customerName'] ?? '',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold),
              ),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 4),
                  Text(a['plate'] ?? '',
                      style: const TextStyle(
                          color: Colors.white70, fontSize: 13)),
                  const SizedBox(height: 2),
                  Text(a['address'] ?? '',
                      style: const TextStyle(
                          color: Colors.white54, fontSize: 12),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis),
                ],
              ),
              trailing: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: color, width: 1),
                ),
                child: Text(
                  _statusLabels[status] ?? status,
                  style: TextStyle(
                      color: color,
                      fontSize: 11,
                      fontWeight: FontWeight.w600),
                ),
              ),
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => AssistanceDetailScreen(
                      api: api,
                      assistance: a,
                    ),
                  ),
                );
                onRefresh();
              },
            ),
          );
        },
      ),
    );
  }
}
