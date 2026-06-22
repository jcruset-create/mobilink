import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import 'arrival_photos_screen.dart';
import 'cobros_screen.dart';
import 'finish_screen.dart';
import 'navigation_screen.dart';

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
  Map<String, dynamic>? _whatsappCapture;
  bool _loadingCapture = false;
  Map<String, dynamic>? _cobro;
  bool _loadingCobro = false;

  @override
  void initState() {
    super.initState();
    _a = widget.assistance;
    if (_status == 'en_camino') _startLocationTracking();
    _loadWhatsAppCapture();
    _loadCobro();
  }

  @override
  void dispose() {
    _locationTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadCobro() async {
    setState(() => _loadingCobro = true);
    try {
      final cobro = await widget.api.getCobroForAssistance(_a['id'] as int);
      if (mounted) setState(() => _cobro = cobro);
    } catch (_) {
      // silencioso
    } finally {
      if (mounted) setState(() => _loadingCobro = false);
    }
  }

  void _abrirCobro(Map<String, dynamic> cobro) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF16213e),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _CobroDetailSheet(
        cobro: cobro,
        api: widget.api,
        onCobrado: () {
          Navigator.pop(context);
          _loadCobro();
        },
      ),
    );
  }

  Future<void> _loadWhatsAppCapture() async {
    setState(() => _loadingCapture = true);
    try {
      final capture = await widget.api.getWhatsAppCapture(_a['id'] as int);
      if (mounted) setState(() => _whatsappCapture = capture);
    } catch (_) {
      // silencioso — no bloquear la pantalla si WhatsApp capture falla
    } finally {
      if (mounted) setState(() => _loadingCapture = false);
    }
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
    final address = (_a['address'] as String? ?? '').trim();

    Uri uri;
    if (lat != null && lng != null) {
      uri = Uri.parse(
          'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving');
    } else if (address.isNotEmpty) {
      final encoded = Uri.encodeComponent(address);
      uri = Uri.parse(
          'https://www.google.com/maps/dir/?api=1&destination=$encoded&travelmode=driving');
    } else {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No hay ubicación disponible para navegar.'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
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
        (_a['address'] as String? ?? '').trim().isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        toolbarHeight: 110,
        title: Image.asset('assets/logo_horizontal.png', height: 90),
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
                  // Cobro asociado a esta asistencia
                  if (!_loadingCobro && _cobro != null) ...[
                    const SizedBox(height: 16),
                    _CobroMiniCard(
                      cobro: _cobro!,
                      onTap: () => _abrirCobro(_cobro!),
                    ),
                  ],
                  if (_loadingCapture) ...[
                    const SizedBox(height: 16),
                    const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                  ] else if (_whatsappCapture != null) ...[
                    const SizedBox(height: 24),
                    _WhatsAppCaptureCard(capture: _whatsappCapture!),
                  ],
                  const SizedBox(height: 24),
                  _section('Acciones rápidas'),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _ActionButton(
                          icon: Icons.navigation,
                          label: 'Navegar',
                          color: Colors.deepPurple,
                          enabled: _hasLocation,
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => NavigationScreen(
                                api: widget.api,
                                assistance: _a,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _ActionButton(
                          icon: Icons.map,
                          label: 'Google Maps',
                          color: Colors.blue,
                          enabled: _hasLocation,
                          onPressed: _openMaps,
                        ),
                      ),
                      const SizedBox(width: 8),
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
          _row(Icons.business, a['customerName'] ?? ''),
          if ((a['conductorNombre'] as String? ?? '').isNotEmpty)
            _row(Icons.person, a['conductorNombre'] ?? ''),
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

// ── Cobro mini-card dentro del detalle de asistencia ─────────────────────────

class _CobroMiniCard extends StatelessWidget {
  final Map<String, dynamic> cobro;
  final VoidCallback onTap;

  const _CobroMiniCard({required this.cobro, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final estado = cobro['estado'] as String? ?? 'pendiente';
    final yaCobrado = estado == 'cobrado';
    final color = yaCobrado ? Colors.green : Colors.orange;
    final importe = (cobro['importe_total'] as num).toDouble();
    final concepto = cobro['concepto'] as String? ?? '';

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF16213e),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withOpacity(0.5)),
        ),
        child: Row(
          children: [
            Icon(
              yaCobrado ? Icons.check_circle : Icons.receipt_long,
              color: color,
              size: 28,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    concepto.isNotEmpty ? concepto : 'Cobro pendiente',
                    style: TextStyle(
                        color: color, fontWeight: FontWeight.w700, fontSize: 14),
                  ),
                  Text(
                    '${importe.toStringAsFixed(2)} € · ${yaCobrado ? "Cobrado" : "Pendiente"}',
                    style: const TextStyle(color: Colors.white60, fontSize: 12),
                  ),
                ],
              ),
            ),
            Text(
              yaCobrado ? 'Ver' : 'Cobrar',
              style: TextStyle(
                  color: color, fontWeight: FontWeight.w700, fontSize: 13),
            ),
            const SizedBox(width: 4),
            Icon(Icons.chevron_right, color: color, size: 20),
          ],
        ),
      ),
    );
  }
}

// Reutilizar el bottom sheet de cobros (importado de cobros_screen.dart)
// El alias _CobroDetailSheet apunta a la clase pública del mismo fichero
typedef _CobroDetailSheet = CobroDetailSheet;

class _WhatsAppCaptureCard extends StatelessWidget {
  final Map<String, dynamic> capture;

  const _WhatsAppCaptureCard({required this.capture});

  @override
  Widget build(BuildContext context) {
    final resumen = capture['resumen'] as String?;
    final nombre = capture['contactoNombre'] as String?;
    final telefono = capture['contactoTelefono'] as String?;
    final imageUrls = (capture['imageUrls'] as List<dynamic>?)?.cast<String>() ?? [];
    final videoUrls = (capture['videoUrls'] as List<dynamic>?)?.cast<String>() ?? [];
    final totalMedia = imageUrls.length + videoUrls.length;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF16213e),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.green.withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.whatsapp, size: 16, color: Colors.green),
              const SizedBox(width: 8),
              const Text(
                'Archivos del cliente (WhatsApp)',
                style: TextStyle(
                  color: Colors.green,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1,
                ),
              ),
              const Spacer(),
              if (totalMedia > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.green.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '$totalMedia archivo${totalMedia != 1 ? "s" : ""}',
                    style: const TextStyle(color: Colors.green, fontSize: 11, fontWeight: FontWeight.w700),
                  ),
                ),
            ],
          ),
          if (nombre != null && nombre.isNotEmpty) ...[
            const SizedBox(height: 10),
            _row(Icons.person, nombre),
          ],
          if (telefono != null && telefono.isNotEmpty) ...[
            const SizedBox(height: 4),
            _row(Icons.phone, telefono),
          ],
          if (resumen != null && resumen.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              resumen,
              style: const TextStyle(color: Colors.white70, fontSize: 13),
            ),
          ],
          // Fotos
          if (imageUrls.isNotEmpty) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                const Icon(Icons.photo_library, size: 13, color: Colors.white38),
                const SizedBox(width: 6),
                Text(
                  'Fotos (${imageUrls.length})',
                  style: const TextStyle(color: Colors.white54, fontSize: 11, letterSpacing: 0.5),
                ),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 110,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: imageUrls.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, i) => GestureDetector(
                  onTap: () => _openUrl(context, imageUrls[i]),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.network(
                      imageUrls[i],
                      height: 110,
                      width: 110,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        height: 110,
                        width: 110,
                        color: Colors.white12,
                        child: const Icon(Icons.broken_image, color: Colors.white38),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
          // Vídeos
          if (videoUrls.isNotEmpty) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                const Icon(Icons.videocam, size: 13, color: Colors.white38),
                const SizedBox(width: 6),
                Text(
                  'Vídeos (${videoUrls.length})',
                  style: const TextStyle(color: Colors.white54, fontSize: 11, letterSpacing: 0.5),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Column(
              children: videoUrls.map((url) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: GestureDetector(
                  onTap: () => _openUrl(context, url),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: Colors.white10,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Colors.white12),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.play_circle_fill, color: Colors.white70, size: 28),
                        SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'Reproducir vídeo',
                            style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600),
                          ),
                        ),
                        Icon(Icons.open_in_new, color: Colors.white38, size: 16),
                      ],
                    ),
                  ),
                ),
              )).toList(),
            ),
          ],
          if (totalMedia == 0 && resumen == null) ...[
            const SizedBox(height: 10),
            const Text(
              'Sin archivos multimedia en esta captura.',
              style: TextStyle(color: Colors.white38, fontSize: 12),
            ),
          ],
        ],
      ),
    );
  }

  void _openUrl(BuildContext context, String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Widget _row(IconData icon, String text) => Row(
        children: [
          Icon(icon, size: 14, color: Colors.white54),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text, style: const TextStyle(color: Colors.white70, fontSize: 13)),
          ),
        ],
      );
}
