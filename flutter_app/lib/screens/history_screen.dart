import 'package:flutter/material.dart';
import '../services/api_service.dart';

const _statusLabels = {
  'finalizada': 'Finalizada',
  'llegada_taller': 'En taller',
  'cancelada': 'Cancelada',
};

const _statusColors = {
  'finalizada': Colors.green,
  'llegada_taller': Colors.teal,
  'cancelada': Colors.grey,
};

class HistoryScreen extends StatefulWidget {
  final ApiService api;

  const HistoryScreen({super.key, required this.api});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  List<Map<String, dynamic>> _items = [];
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
      final data = await widget.api.getHistory();
      setState(() => _items = data);
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _formatDate(dynamic ms) {
    if (ms == null) return '';
    final dt = DateTime.fromMillisecondsSinceEpoch(ms as int);
    return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year}  ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return _loading
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
              : _items.isEmpty
                  ? const Center(
                      child: Text('No hay asistencias finalizadas',
                          style: TextStyle(color: Colors.white54)),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        itemBuilder: (_, i) {
                          final a = _items[i];
                          final status = a['status'] as String? ?? '';
                          final color = _statusColors[status] ?? Colors.grey;
                          return Card(
                            color: const Color(0xFF16213e),
                            margin: const EdgeInsets.only(bottom: 12),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          a['customerName'] ?? '',
                                          style: const TextStyle(
                                              color: Colors.white,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 15),
                                        ),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 10, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: color.withOpacity(0.15),
                                          borderRadius:
                                              BorderRadius.circular(20),
                                          border:
                                              Border.all(color: color, width: 1),
                                        ),
                                        child: Text(
                                          _statusLabels[status] ?? status,
                                          style: TextStyle(
                                              color: color,
                                              fontSize: 11,
                                              fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  if ((a['plate'] as String? ?? '').isNotEmpty)
                                    _row(Icons.directions_car, a['plate']),
                                  if ((a['address'] as String? ?? '').isNotEmpty)
                                    _row(Icons.location_on, a['address'],
                                        small: true),
                                  if (a['createdAtMs'] != null)
                                    _row(Icons.calendar_today,
                                        _formatDate(a['createdAtMs']),
                                        small: true),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    );
  }

  Widget _row(IconData icon, dynamic text, {bool small = false}) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(
          children: [
            Icon(icon,
                size: small ? 13 : 15,
                color: small ? Colors.white38 : Colors.white54),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                text?.toString() ?? '',
                style: TextStyle(
                    color: small ? Colors.white38 : Colors.white60,
                    fontSize: small ? 12 : 13),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      );
}
