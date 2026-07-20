import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';

class NavigationScreen extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> assistance;

  const NavigationScreen({super.key, required this.api, required this.assistance});

  @override
  State<NavigationScreen> createState() => _NavigationScreenState();
}

class _NavigationScreenState extends State<NavigationScreen> {
  final MapController _mapController = MapController();

  Position? _operatorPos;
  bool _loadingLocation = true;
  bool _loadingEta = false;
  int? _etaMinutos;
  String? _distanciaKm;
  String? _etaError;
  bool _etaSent = false;
  bool _sendingEta = false;

  double? get _destLat => _toDouble(widget.assistance['latitude']);
  double? get _destLng => _toDouble(widget.assistance['longitude']);
  String get _address => widget.assistance['address'] as String? ?? '';
  String get _customerName => widget.assistance['customerName'] as String? ?? '';
  int get _assistanceId => widget.assistance['id'] as int;

  double? _toDouble(dynamic v) {
    if (v == null) return null;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    return double.tryParse(v.toString());
  }

  @override
  void initState() {
    super.initState();
    _initLocation();
  }

  Future<void> _initLocation() async {
    setState(() => _loadingLocation = true);
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever ||
          permission == LocationPermission.denied) {
        setState(() => _loadingLocation = false);
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 10)),
      );
      setState(() {
        _operatorPos = pos;
        _loadingLocation = false;
      });
      if (_destLat != null && _destLng != null) {
        _fetchEta();
        _centerMap();
      }
    } catch (_) {
      setState(() => _loadingLocation = false);
    }
  }

  void _centerMap() {
    if (_destLat == null || _destLng == null) return;
    if (_operatorPos != null) {
      final midLat = (_operatorPos!.latitude + _destLat!) / 2;
      final midLng = (_operatorPos!.longitude + _destLng!) / 2;
      _mapController.move(LatLng(midLat, midLng), 11);
    } else {
      _mapController.move(LatLng(_destLat!, _destLng!), 14);
    }
  }

  Future<void> _fetchEta() async {
    if (_operatorPos == null || _destLat == null || _destLng == null) return;
    setState(() {
      _loadingEta = true;
      _etaError = null;
    });
    try {
      final data = await widget.api.getEta(
        originLat: _operatorPos!.latitude,
        originLng: _operatorPos!.longitude,
        destLat: _destLat!,
        destLng: _destLng!,
      );
      setState(() {
        _etaMinutos = data['etaMinutos'] as int?;
        _distanciaKm = data['etaKm']?.toString();
        _loadingEta = false;
      });
    } catch (e) {
      setState(() {
        _etaError = 'No se pudo calcular la ruta. Puedes abrir Google Maps manualmente.';
        _loadingEta = false;
      });
    }
  }

  Future<void> _openGoogleMaps() async {
    Uri uri;
    if (_destLat != null && _destLng != null) {
      uri = Uri.parse(
          'https://www.google.com/maps/dir/?api=1&destination=$_destLat,$_destLng&travelmode=driving');
    } else if (_address.isNotEmpty) {
      uri = Uri.parse(
          'https://www.google.com/maps/dir/?api=1&destination=${Uri.encodeComponent(_address)}&travelmode=driving');
    } else {
      _showSnack('No hay ubicaciÃ³n disponible para navegar.', Colors.orange);
      return;
    }
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      _showSnack('No se pudo abrir Google Maps', Colors.red);
    }
  }

  Future<void> _copyLocation() async {
    String text;
    if (_destLat != null && _destLng != null) {
      text = '$_destLat, $_destLng';
    } else if (_address.isNotEmpty) {
      text = _address;
    } else {
      _showSnack('No hay ubicaciÃ³n disponible', Colors.orange);
      return;
    }
    await Clipboard.setData(ClipboardData(text: text));
    _showSnack('UbicaciÃ³n copiada', Colors.green);
  }

  Future<void> _sendEtaWhatsApp() async {
    setState(() => _sendingEta = true);
    try {
      await widget.api.sendEtaWhatsApp(
        _assistanceId,
        etaMinutos: _etaMinutos,
        distanciaKm: _distanciaKm,
      );
      setState(() => _etaSent = true);
      _showSnack('ETA enviado al cliente por WhatsApp âœ“', Colors.green);
    } catch (_) {
      _showSnack('No se pudo enviar el WhatsApp', Colors.red);
    } finally {
      setState(() => _sendingEta = false);
    }
  }

  void _showSnack(String msg, Color color) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg), backgroundColor: color));
  }

  @override
  Widget build(BuildContext context) {
    final hasCoords = _destLat != null && _destLng != null;

    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        toolbarHeight: 110,
        title: Image.asset('assets/logo_horizontal2.png', height: 100),
        backgroundColor: const Color(0xFF16213e),
        foregroundColor: Colors.white,
      ),
      body: Row(
        children: [
          // â”€â”€ Mapa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          Expanded(
            flex: 3,
            child: hasCoords
                ? FlutterMap(
                    mapController: _mapController,
                    options: MapOptions(
                      initialCenter: LatLng(_destLat!, _destLng!),
                      initialZoom: 14,
                    ),
                    children: [
                      TileLayer(
                        urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                        userAgentPackageName: 'com.seatarragona.operario',
                      ),
                      MarkerLayer(markers: [
                        // Marcador destino
                        Marker(
                          point: LatLng(_destLat!, _destLng!),
                          width: 48,
                          height: 48,
                          child: const Icon(Icons.location_pin,
                              color: Colors.red, size: 48),
                        ),
                        // Marcador operario
                        if (_operatorPos != null)
                          Marker(
                            point: LatLng(
                                _operatorPos!.latitude, _operatorPos!.longitude),
                            width: 36,
                            height: 36,
                            child: const Icon(Icons.person_pin_circle,
                                color: Colors.blue, size: 36),
                          ),
                      ]),
                    ],
                  )
                : Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.map_outlined,
                            color: Colors.white24, size: 64),
                        const SizedBox(height: 12),
                        Text(
                          _address.isNotEmpty
                              ? _address
                              : 'Sin coordenadas disponibles',
                          style: const TextStyle(
                              color: Colors.white54, fontSize: 14),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
          ),

          // â”€â”€ Panel lateral â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          Container(
            width: 280,
            color: const Color(0xFF16213e),
            padding: const EdgeInsets.all(16),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Destino
                  const Text('DESTINO',
                      style: TextStyle(
                          color: Colors.white38,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1)),
                  const SizedBox(height: 6),
                  Text(_customerName,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  Text(_address,
                      style: const TextStyle(
                          color: Colors.white60, fontSize: 13)),
                  const Divider(color: Colors.white12, height: 24),

                  // ETA / distancia
                  if (_loadingLocation || _loadingEta)
                    const Center(
                        child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ))
                  else if (!_loadingLocation && _operatorPos == null)
                    _warningBox(
                        'No se ha podido obtener la ubicaciÃ³n actual del operario.')
                  else if (_etaError != null)
                    _warningBox(_etaError!)
                  else if (_etaMinutos != null) ...[
                    Row(children: [
                      _statCard(Icons.timer, '$_etaMinutos min', 'Tiempo'),
                      const SizedBox(width: 8),
                      _statCard(Icons.straighten,
                          _distanciaKm ?? '-', 'Distancia'),
                    ]),
                  ],

                  const SizedBox(height: 16),

                  // Botones de acciÃ³n
                  _actionButton(
                    icon: Icons.map,
                    label: 'Abrir en Google Maps',
                    color: Colors.blue,
                    onPressed: _openGoogleMaps,
                  ),
                  const SizedBox(height: 8),
                  _actionButton(
                    icon: Icons.content_copy,
                    label: 'Copiar ubicaciÃ³n',
                    color: Colors.indigo,
                    onPressed: _copyLocation,
                  ),
                  const SizedBox(height: 8),
                  _actionButton(
                    icon: Icons.chat,
                    label: _etaSent
                        ? 'ETA enviado âœ“'
                        : 'Enviar ETA por WhatsApp',
                    color: _etaSent ? Colors.green.shade700 : Colors.green,
                    onPressed: _sendingEta || _etaSent ? null : _sendEtaWhatsApp,
                    loading: _sendingEta,
                  ),
                  const SizedBox(height: 8),
                  if (_operatorPos == null && !_loadingLocation)
                    _actionButton(
                      icon: Icons.my_location,
                      label: 'Reintentar ubicaciÃ³n',
                      color: Colors.teal,
                      onPressed: _initLocation,
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _statCard(IconData icon, String value, String label) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white10,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            Icon(icon, color: Colors.white70, size: 20),
            const SizedBox(height: 4),
            Text(value,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold)),
            Text(label,
                style:
                    const TextStyle(color: Colors.white38, fontSize: 11)),
          ],
        ),
      ),
    );
  }

  Widget _warningBox(String msg) => Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.orange.withOpacity(0.15),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.orange.withOpacity(0.4)),
        ),
        child: Row(
          children: [
            const Icon(Icons.warning_amber, color: Colors.orange, size: 16),
            const SizedBox(width: 8),
            Expanded(
                child: Text(msg,
                    style: const TextStyle(
                        color: Colors.orange, fontSize: 12))),
          ],
        ),
      );

  Widget _actionButton({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback? onPressed,
    bool loading = false,
  }) =>
      SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: onPressed,
          icon: loading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Icon(icon, size: 18),
          label: Text(label, style: const TextStyle(fontSize: 13)),
          style: ElevatedButton.styleFrom(
            backgroundColor: onPressed == null ? Colors.white12 : color,
            foregroundColor: onPressed == null ? Colors.white38 : Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 12),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
      );
}
