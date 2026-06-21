import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'traspaso_detalle_screen.dart';
import 'auditoria_screen.dart';
import 'login_screen.dart';
import 'nuevo_traspaso_screen.dart';

final _db = Supabase.instance.client;

const _estadoColors = {
  'pendiente_salida': Colors.orange,
  'preparado': Colors.orange,
  'en_camino': Colors.blue,
  'recibido_parcial': Colors.deepOrange,
  'recibido': Colors.green,
};

const _estadoLabels = {
  'pendiente_salida': 'Pendiente salida',
  'preparado': 'Pendiente salida',
  'en_camino': 'Pendiente recepción',
  'recibido_parcial': 'Recibido parcial',
  'recibido': 'Recibido',
};

class TraspasoListScreen extends StatefulWidget {
  final Map<String, dynamic> operario;
  const TraspasoListScreen({super.key, required this.operario});

  @override
  State<TraspasoListScreen> createState() => _TraspasoListScreenState();
}

class _TraspasoListScreenState extends State<TraspasoListScreen> {
  List<Map<String, dynamic>> _traspasos = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await _db
          .from('traspasos')
          .select('''
            id, codigo, estado, fecha_salida, fecha_recepcion,
            cantidad, cantidad_recibida, ubicacion_origen, ubicacion_destino,
            productos_neumaticos ( marca, modelo, medida, dot )
          ''')
          .inFilter('estado', ['pendiente_salida', 'preparado', 'en_camino', 'recibido_parcial'])
          .order('fecha_salida', ascending: false);

      if (mounted) setState(() => _traspasos = List<Map<String, dynamic>>.from(res));
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _codigo(Map<String, dynamic> tr) {
    final c = tr['codigo'] as String?;
    if (c != null && c.isNotEmpty) return c;
    return 'TR-${(tr['id'] as String).substring(0, 8).toUpperCase()}';
  }

  String _producto(dynamic raw) {
    final p = raw is List ? (raw.isNotEmpty ? raw.first : null) : raw;
    if (p == null) return '—';
    final medida = p['medida'] ?? '';
    final marca = p['marca'] ?? '';
    final modelo = p['modelo'] != null ? ' ${p['modelo']}' : '';
    final dot = p['dot'] != null ? ' · DOT ${p['dot']}' : '';
    return '$medida - $marca$modelo$dot';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        backgroundColor: const Color(0xFF16213e),
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('SEA Almacén',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white)),
            Text(
              widget.operario['nombre'] as String? ?? '',
              style: const TextStyle(fontSize: 11, color: Colors.white54),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _load,
          ),
          IconButton(
            icon: const Icon(Icons.history, color: Colors.white),
            tooltip: 'Auditoría',
            onPressed: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const AuditoriaScreen())),
          ),
          IconButton(
            icon: const Icon(Icons.logout, color: Colors.white),
            tooltip: 'Cerrar sesión',
            onPressed: () => Navigator.of(context).pushReplacement(
              MaterialPageRoute(builder: (_) => const LoginScreen()),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await Navigator.push(context,
              MaterialPageRoute(
                builder: (_) => NuevoTraspasoScreen(operario: widget.operario)));
          _load();
        },
        backgroundColor: Colors.green[700],
        icon: const Icon(Icons.add, color: Colors.white),
        label: const Text('Nuevo traspaso',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
      body: Column(
        children: [
          // Accesos rápidos
          Container(
            color: const Color(0xFF16213e),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                _quickBtn(Icons.inventory_2, 'Stock', null),
                const SizedBox(width: 10),
                _quickBtn(Icons.warning_amber, 'Incidencias', null),
                const SizedBox(width: 10),
                _quickBtn(Icons.history, 'Auditoría', () => Navigator.push(context,
                    MaterialPageRoute(builder: (_) => const AuditoriaScreen()))),
              ],
            ),
          ),
          const Divider(height: 1, color: Colors.white12),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Colors.blue))
                : _error != null
                    ? Center(child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                          const SizedBox(height: 12),
                          ElevatedButton(
                            onPressed: _load,
                            style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
                            child: const Text('Reintentar'),
                          ),
                        ],
                      ))
                    : _traspasos.isEmpty
                        ? const Center(child: Text('No hay traspasos pendientes.',
                            style: TextStyle(color: Colors.white54)))
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.builder(
                              padding: const EdgeInsets.all(12),
                              itemCount: _traspasos.length,
                              itemBuilder: (_, i) {
                                final tr = _traspasos[i];
                                final estado = tr['estado'] as String? ?? '';
                                final color = _estadoColors[estado] ?? Colors.grey;
                                final label = _estadoLabels[estado] ?? estado;
                                final pendiente = (tr['cantidad'] as int) -
                                    ((tr['cantidad_recibida'] as int?) ?? 0);

                                return Card(
                                  color: const Color(0xFF16213e),
                                  margin: const EdgeInsets.only(bottom: 10),
                                  shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(14)),
                                  child: InkWell(
                                    borderRadius: BorderRadius.circular(14),
                                    onTap: () async {
                                      await Navigator.push(context,
                                        MaterialPageRoute(
                                          builder: (_) => TraspasoDetalleScreen(
                                              id: tr['id'] as String),
                                        ),
                                      );
                                      _load();
                                    },
                                    child: Padding(
                                      padding: const EdgeInsets.all(14),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              Expanded(
                                                child: Text(_codigo(tr),
                                                    style: const TextStyle(
                                                        fontWeight: FontWeight.bold,
                                                        fontSize: 16,
                                                        color: Colors.white)),
                                              ),
                                              Container(
                                                padding: const EdgeInsets.symmetric(
                                                    horizontal: 10, vertical: 4),
                                                decoration: BoxDecoration(
                                                  color: color.withOpacity(0.2),
                                                  borderRadius: BorderRadius.circular(20),
                                                  border: Border.all(color: color),
                                                ),
                                                child: Text(label,
                                                    style: TextStyle(
                                                        color: color,
                                                        fontSize: 11,
                                                        fontWeight: FontWeight.bold)),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 6),
                                          Text(
                                            '${tr['ubicacion_origen'] ?? '—'} → ${tr['ubicacion_destino'] ?? '—'}',
                                            style: const TextStyle(
                                                color: Colors.white54, fontSize: 13),
                                          ),
                                          const SizedBox(height: 8),
                                          Container(
                                            padding: const EdgeInsets.all(10),
                                            decoration: BoxDecoration(
                                              color: Colors.white.withOpacity(0.05),
                                              borderRadius: BorderRadius.circular(10),
                                            ),
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                _infoRow('Cantidad', '${tr['cantidad']}'),
                                                _infoRow('Pendiente', '$pendiente',
                                                    color: pendiente > 0
                                                        ? Colors.orange
                                                        : Colors.green),
                                                _infoRow('Neumático',
                                                    _producto(tr['productos_neumaticos'])),
                                              ],
                                            ),
                                          ),
                                          const SizedBox(height: 10),
                                          SizedBox(
                                            width: double.infinity,
                                            child: ElevatedButton(
                                              onPressed: () async {
                                                await Navigator.push(context,
                                                  MaterialPageRoute(
                                                    builder: (_) => TraspasoDetalleScreen(
                                                        id: tr['id'] as String),
                                                  ),
                                                );
                                                _load();
                                              },
                                              style: ElevatedButton.styleFrom(
                                                backgroundColor: Colors.blue,
                                                foregroundColor: Colors.white,
                                                shape: RoundedRectangleBorder(
                                                    borderRadius: BorderRadius.circular(10)),
                                              ),
                                              child: const Text('Ver traspaso'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _quickBtn(IconData icon, String label, VoidCallback? onTap) {
    return Expanded(
      child: OutlinedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 16, color: Colors.white70),
        label: Text(label, style: const TextStyle(fontSize: 12, color: Colors.white70)),
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 8),
          side: const BorderSide(color: Colors.white24),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value, {Color? color}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      children: [
        Text('$label: ', style: const TextStyle(fontSize: 12, color: Colors.white54)),
        Expanded(
          child: Text(value,
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: color ?? Colors.white)),
        ),
      ],
    ),
  );
}
