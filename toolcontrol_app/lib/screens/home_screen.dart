import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../theme.dart';
import 'login_screen.dart';
import 'scan_screen.dart';
import 'tool_detail_screen.dart';

class HomeScreen extends StatefulWidget {
  final String employeeId;
  final String employeeName;
  const HomeScreen(
      {super.key, required this.employeeId, required this.employeeName});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _results = [];
  List<Map<String, dynamic>> _misTools = [];
  bool _searching = false;

  @override
  void initState() {
    super.initState();
    _loadMisTools();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadMisTools() async {
    try {
      final rows = await ApiService.misHerramientas(widget.employeeId);
      if (mounted) setState(() => _misTools = rows);
    } catch (_) {/* sin conexión: se ignora */}
  }

  void _onSearchChanged(String q) {
    _debounce?.cancel();
    if (q.trim().isEmpty) {
      setState(() => _results = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), () async {
      setState(() => _searching = true);
      try {
        final rows = await ApiService.searchTools(q);
        if (mounted) setState(() => _results = rows);
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Error buscando: $e')));
        }
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('employeeId');
    await prefs.remove('employeeName');
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  Future<void> _openDetail(String id, {bool isMachine = false}) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ToolDetailScreen(
        itemId: id,
        isMachine: isMachine,
        employeeId: widget.employeeId,
      ),
    ));
    _loadMisTools();
  }

  Future<void> _scan() async {
    final result = await Navigator.of(context).push<ScanResult>(
      MaterialPageRoute(builder: (_) => const ScanScreen()),
    );
    if (result != null) {
      _openDetail(result.id, isMachine: result.isMachine);
    }
  }

  Widget _toolTile(Map<String, dynamic> t, {bool isMine = false}) {
    final estado = (t['estado'] as String?) ?? '';
    final color = toolStatusColor(estado);
    return Card(
      color: AppColors.surface,
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: ListTile(
        leading: const Icon(Icons.handyman_outlined, color: AppColors.primary),
        title: Text('${t['codigo'] ?? ''} — ${t['nombre'] ?? ''}'),
        subtitle: Text(
          [t['marca'], t['modelo']]
              .where((e) => e != null && '$e'.isNotEmpty)
              .join(' '),
          style: const TextStyle(color: AppColors.textMuted),
        ),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: color.withOpacity(0.15),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: color.withOpacity(0.5)),
          ),
          child: Text(toolStatusLabel(estado),
              style: TextStyle(color: color, fontSize: 12)),
        ),
        onTap: () => _openDetail(t['id'] as String),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final showSearch = _searchCtrl.text.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Mobilink ToolControl',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            Text(widget.employeeName,
                style:
                    const TextStyle(fontSize: 13, color: AppColors.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout, color: AppColors.textMuted),
            tooltip: 'Cerrar sesión',
            onPressed: _logout,
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _loadMisTools,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SizedBox(
              width: double.infinity,
              height: 64,
              child: ElevatedButton.icon(
                onPressed: _scan,
                icon: const Icon(Icons.qr_code_scanner, size: 28),
                label:
                    const Text('Escanear QR', style: TextStyle(fontSize: 18)),
              ),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _searchCtrl,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                hintText: 'Buscar herramienta por código o nombre…',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: showSearch
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchCtrl.clear();
                          setState(() => _results = []);
                        },
                      )
                    : null,
              ),
            ),
            const SizedBox(height: 12),
            if (_searching)
              const Center(
                  child: Padding(
                padding: EdgeInsets.all(12),
                child: CircularProgressIndicator(color: AppColors.primary),
              )),
            if (showSearch) ...[
              if (!_searching && _results.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('Sin resultados',
                      style: TextStyle(color: AppColors.textMuted)),
                ),
              ..._results.map(_toolTile),
            ] else ...[
              const Text('Mis herramientas en uso',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              if (_misTools.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('No tienes herramientas en uso',
                      style: TextStyle(color: AppColors.textMuted)),
                ),
              ..._misTools.map((t) => _toolTile(t, isMine: true)),
            ],
          ],
        ),
      ),
    );
  }
}
