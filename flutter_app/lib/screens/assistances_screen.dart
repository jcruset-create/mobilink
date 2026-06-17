import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import 'assistance_detail_screen.dart';
import 'login_screen.dart';

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

class _AssistancesScreenState extends State<AssistancesScreen> {
  List<Map<String, dynamic>> _assistances = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
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
      appBar: AppBar(
        title: const Text('Mis asistencias'),
        backgroundColor: const Color(0xFF16213e),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: _logout,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!,
                          style: const TextStyle(color: Colors.redAccent)),
                      const SizedBox(height: 16),
                      ElevatedButton(
                          onPressed: _load, child: const Text('Reintentar')),
                    ],
                  ),
                )
              : _assistances.isEmpty
                  ? const Center(
                      child: Text('No tienes asistencias asignadas',
                          style: TextStyle(color: Colors.white54)),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _assistances.length,
                        itemBuilder: (_, i) {
                          final a = _assistances[i];
                          final status = a['status'] as String? ?? '';
                          final color =
                              _statusColors[status] ?? Colors.grey;
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
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold),
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const SizedBox(height: 4),
                                  Text(
                                    a['plate'] ?? '',
                                    style: const TextStyle(
                                        color: Colors.white70, fontSize: 13),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    a['address'] ?? '',
                                    style: const TextStyle(
                                        color: Colors.white54, fontSize: 12),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
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
                                      api: widget.api,
                                      assistance: a,
                                    ),
                                  ),
                                );
                                _load();
                              },
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
