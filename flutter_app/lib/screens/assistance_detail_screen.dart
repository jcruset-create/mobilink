import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import 'arrival_photos_screen.dart';
import 'finish_screen.dart';

class AssistanceDetailScreen extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> assistance;

  const AssistanceDetailScreen(
      {super.key, required this.api, required this.assistance});

  @override
  State<AssistanceDetailScreen> createState() => _AssistanceDetailScreenState();
}

class _AssistanceDetailScreenState extends State<AssistanceDetailScreen> {
  late Map<String, dynamic> _a;
  bool _loading = false;
  Timer? _locationTimer;

  @override
  void initState() {
    super.initState();
    _a = widget.assistance;
    if (_status == 'en_camino') _startLocationTracking();
  }

  @override
  void dispose() {
    _locationTimer?.cancel();
    super.dispose();
  }

  void _startLocationTracking() {
    _locationTimer?.cancel();
    _sendLocation(); // envío inmediato
    _locationTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_status == 'en_camino') {
        _sendLocation();
      } else {
        _locationTimer?.cancel();
      }
    });
  }

  Future<void> _sendLocation() async {
    try {
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        await Geolocator.requestPermission();
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );
      await widget.api.sendLocation(_a['id'] as int, pos.latitude, pos.longitude);
    } catch (_) {
      // silencioso — no interrumpir al técnico por un fallo de GPS
    }
  }

  Future<void> _changeStatus(String status) async {
    setState(() => _loading = true);
    try {
      final updated = await widget.api.updateStatus(_a['id'] as int, status);
      setState(() => _a = updated);
      _locationTimer?.cancel();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Estado actualizado: $status'),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _goEnCamino() async {
    setState(() => _loading = true);
    try {
      final updated = await widget.api.enCamino(_a['id'] as int);
      setState(() => _a = updated);
      _startLocationTracking();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('En camino — se notificará al cliente por WhatsApp'),
          backgroundColor: Colors.lightBlue,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _onFinalize() async {
    final confirmed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FinishScreen(
          api: widget.api,
          assistanceId: _a['id'] as int,
        ),
      ),
    );
    if (confirmed == true) {
      await _changeStatus('finalizada');
    }
  }

  Future<void> _onHeArrived() async {
    await _changeStatus('en_punto');
    if (!mounted) return;
    // Fotos de llegada: matrícula + avería antes de reparar
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ArrivalPhotosScreen(
          api: widget.api,
          assistanceId: _a['id'] as int,
          onDone: () => _changeStatus('inicio_reparacion'),
        ),
      ),
    );
  }

  Future<void> _addExtraPhotos() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ArrivalPhotosScreen(
          api: widget.api,
          assistanceId: _a['id'] as int,
          extraMode: true,
        ),
      ),
    );
  }

  Future<void> _openMaps() async {
    final lat = _a['latitude'];
    final lng = _a['longitude'];
    final mapsUrl = _a['googleMapsUrl'] as String?;

    Uri uri;
    if (lat != null && lng != null) {
      uri = Uri.parse(
          'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving');
    } else if (mapsUrl != null && mapsUrl.isNotEmpty) {
      uri = Uri.parse(mapsUrl);
    } else {
      final address = Uri.encodeComponent(_a['address'] ?? '');
      uri = Uri.parse(
          'https://www.google.com/maps/search/?api=1&query=$address');
    }

    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo abrir Google Maps')),
      );
    }
  }

  Future<void> _call() async {
    final phone = _a['customerPhone'] as String? ?? '';
    final uri = Uri.parse('tel:$phone');
    await launchUrl(uri);
  }

  String get _status => _a['status'] as String? ?? '';

  bool get _canGoEnCamino => _status == 'asignada';
  bool get _canHeArrived => _status == 'en_camino';
  bool get _canInicioReparacion => _status == 'en_punto';
  bool get _canFinalize => _status == 'inicio_reparacion';
  bool get _canAddPhotos =>
      ['en_punto', 'inicio_reparacion'].contains(_status);
  bool get _hasPhone {
    final p = _a['customerPhone'] as String? ?? '';
    return p.isNotEmpty;
  }

  bool get _hasLocation {
    return (_a['latitude'] != null && _a['longitude'] != null) ||
        (_a['googleMapsUrl'] as String? ?? '').isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        title: Text(_a['customerName'] ?? 'Asistencia'),
        backgroundColor: const Color(0xFF16213e),
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _InfoCard(assistance: _a),
                  const SizedBox(height: 24),
                  _section('Acciones rápidas'),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _ActionButton(
                          icon: Icons.navigation,
                          label: 'Navegar',
                          color: Colors.blue,
                          enabled: _hasLocation,
                          onPressed: _openMaps,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _ActionButton(
                          icon: Icons.phone,
                          label: 'Llamar',
                          color: Colors.green,
                          enabled: _hasPhone,
                          onPressed: _call,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  _section('Cambiar estado'),
                  const SizedBox(height: 12),
                  _ActionButton(
                    icon: Icons.directions_car,
                    label: 'Estoy en camino',
                    color: Colors.lightBlue,
                    enabled: _canGoEnCamino,
                    fullWidth: true,
                    onPressed: _goEnCamino,
                  ),
                  const SizedBox(height: 12),
                  _ActionButton(
                    icon: Icons.location_on,
                    label: 'He llegado al punto',
                    color: Colors.purple,
                    enabled: _canHeArrived,
                    fullWidth: true,
                    onPressed: _onHeArrived,
                  ),
                  const SizedBox(height: 12),
                  _ActionButton(
                    icon: Icons.build,
                    label: 'Iniciar reparación',
                    color: Colors.deepOrange,
                    enabled: _canInicioReparacion,
                    fullWidth: true,
                    onPressed: () => _changeStatus('inicio_reparacion'),
                  ),
                  const SizedBox(height: 12),
                  _ActionButton(
                    icon: Icons.add_a_photo,
                    label: 'Añadir fotos',
                    color: Colors.indigo,
                    enabled: _canAddPhotos,
                    fullWidth: true,
                    onPressed: _addExtraPhotos,
                  ),
                  const SizedBox(height: 12),
                  _ActionButton(
                    icon: Icons.check_circle,
                    label: 'Finalizar asistencia',
                    color: Colors.teal,
                    enabled: _canFinalize,
                    fullWidth: true,
                    onPressed: _onFinalize,
                  ),
                  if (_status == 'en_camino') ...[
                    const SizedBox(height: 16),
                    _GpsTrackingBanner(),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _section(String label) => Text(
        label,
        style: const TextStyle(
            color: Colors.white54,
            fontSize: 12,
            fontWeight: FontWeight.w600,
            letterSpacing: 1),
      );
}

class _GpsTrackingBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.lightBlue.withOpacity(0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.lightBlue.withOpacity(0.4)),
      ),
      child: const Row(
        children: [
          Icon(Icons.my_location, size: 16, color: Colors.lightBlue),
          SizedBox(width: 8),
          Text(
            'Enviando ubicación al cliente cada 30s',
            style: TextStyle(color: Colors.lightBlue, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  final Map<String, dynamic> assistance;

  const _InfoCard({required this.assistance});

  @override
  Widget build(BuildContext context) {
    final a = assistance;
    final status = a['status'] as String? ?? '';
    final etaMin = a['etaMinutos'];
    final etaKm = a['etaKm'];

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF16213e),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _row(Icons.person, a['customerName'] ?? ''),
          _row(Icons.phone, a['customerPhone'] ?? ''),
          _row(Icons.location_on, a['address'] ?? ''),
          _row(Icons.directions_car, a['plate'] ?? ''),
          if ((a['vehicleDescription'] as String? ?? '').isNotEmpty)
            _row(Icons.info_outline, a['vehicleDescription'] ?? ''),
          if ((a['assignedVehicleName'] as String? ?? '').isNotEmpty)
            _row(Icons.local_shipping, a['assignedVehicleName'] ?? ''),
          _row(Icons.circle, _statusLabel(status),
              color: _statusColor(status)),
          if (status == 'en_camino' && etaMin != null)
            _row(Icons.timer, 'ETA: $etaMin min · ${etaKm ?? '-'} km',
                color: Colors.lightBlue),
          if ((a['notes'] as String? ?? '').isNotEmpty)
            _row(Icons.sticky_note_2, a['notes'] ?? ''),
        ],
      ),
    );
  }

  Widget _row(IconData icon, String text, {Color? color}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 16, color: color ?? Colors.white54),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                text,
                style: TextStyle(color: color ?? Colors.white70, fontSize: 14),
              ),
            ),
          ],
        ),
      );

  String _statusLabel(String s) => {
        'pendiente': 'Pendiente',
        'asignada': 'Asignada',
        'en_camino': 'En camino',
        'en_punto': 'En punto',
        'inicio_reparacion': 'Reparando',
        'finalizada': 'Finalizada',
        'llegada_taller': 'En taller',
        'cancelada': 'Cancelada',
      }[s] ??
      s;

  Color _statusColor(String s) => {
        'pendiente': Colors.orange,
        'asignada': Colors.blue,
        'en_camino': Colors.lightBlue,
        'en_punto': Colors.purple,
        'inicio_reparacion': Colors.deepOrange,
        'finalizada': Colors.green,
        'llegada_taller': Colors.teal,
        'cancelada': Colors.grey,
      }[s] ??
      Colors.grey;
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final bool enabled;
  final bool fullWidth;
  final VoidCallback onPressed;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.enabled,
    required this.onPressed,
    this.fullWidth = false,
  });

  @override
  Widget build(BuildContext context) {
    final btn = ElevatedButton.icon(
      onPressed: enabled ? onPressed : null,
      icon: Icon(icon),
      label: Text(label),
      style: ElevatedButton.styleFrom(
        backgroundColor: enabled ? color : Colors.white12,
        foregroundColor: enabled ? Colors.white : Colors.white38,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );

    return fullWidth ? SizedBox(width: double.infinity, child: btn) : btn;
  }
}
