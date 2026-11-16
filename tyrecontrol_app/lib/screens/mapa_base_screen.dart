import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../models/mapa_base.dart';
import '../models/presencia_vista.dart';
import '../services/seguimiento_ubicacion.dart';
import '../theme/app_theme.dart';
import '../widgets/ficha_vehiculo_en_base.dart';

/// El patio de una base, en mapa: cada autobús con la revisión pendiente es
/// una etiqueta con su matrícula.
///
/// La lista dice CUÁLES hay que revisar; esto dice DÓNDE están, que en un
/// patio de ciento y pico autobuses es la mitad del trabajo.
///
/// - Rojo, sin revisión; ámbar, vencida; amarillo, próxima.
/// - Borde discontinuo y reloj: la posición tiene más de una hora.
/// - Los que se pisan se juntan en un círculo con el número; al tocarlo, el
///   mapa se acerca y se separan.
/// - Al tocar una etiqueta sale abajo la misma ficha que en la lista, con
///   «Iniciar revisión» y «cómo llegar».
///
/// El fondo es OpenStreetMap, como en Assist y Assist Lite: sin clave.
class MapaBaseScreen extends StatefulWidget {
  final BaseGeo base;
  final List<PinDeMapa> pines;
  final Map<String, String> nombreDeBase;

  /// Abre la revisión del vehículo. La pantalla de bases ya sabe hacerlo; aquí
  /// no se repite.
  final Future<void> Function(VehiculoPresencia v) onRevisar;

  /// Para las pruebas: sin mosaicos (no hay red) y con la posición de la
  /// tablet dada.
  final bool sinMosaicos;
  final Future<LatLng?> Function()? miPosicion;

  const MapaBaseScreen({
    super.key,
    required this.base,
    required this.pines,
    required this.nombreDeBase,
    required this.onRevisar,
    this.sinMosaicos = false,
    this.miPosicion,
  });

  @override
  State<MapaBaseScreen> createState() => _MapaBaseScreenState();
}

class _MapaBaseScreenState extends State<MapaBaseScreen> {
  static const _zoomInicial = 17.0;
  static const _zoomMaximo = 19.0;

  final _mapa = MapController();
  double _zoom = _zoomInicial;
  String? _elegido; // vehiculoId
  String? _abriendo;
  LatLng? _yo;

  @override
  void initState() {
    super.initState();
    unawaited(_buscarme());
  }

  /// Dónde está la tablet. Si no hay permiso o no fija, el mapa sale igual:
  /// el punto azul es una ayuda, no un requisito.
  Future<void> _buscarme() async {
    try {
      final LatLng? p;
      if (widget.miPosicion != null) {
        p = await widget.miPosicion!();
      } else {
        final pos = await SeguimientoUbicacion.instancia.posicionParaRevision();
        p = pos == null ? null : LatLng(pos.latitude, pos.longitude);
      }
      if (mounted && p != null) setState(() => _yo = p);
    } catch (_) {/* sin punto azul */}
  }

  LatLng get _centro {
    final b = widget.base;
    if (posicionUtil(b.lat, b.lng)) return LatLng(b.lat!, b.lng!);
    if (widget.pines.isNotEmpty) return LatLng(widget.pines.first.lat, widget.pines.first.lng);
    return const LatLng(41.1189, 1.2445); // Tarragona: solo si no hay nada más
  }

  /// El encuadre de entrada: la geo-zona entera, o los autobuses si la base
  /// no tiene radio.
  CameraFit? get _encuadre {
    final puntos = <LatLng>[
      for (final p in widget.pines) LatLng(p.lat, p.lng),
    ];
    final b = widget.base;
    if (posicionUtil(b.lat, b.lng)) {
      final r = (b.radioM ?? 0) > 0 ? b.radioM! : 150.0;
      const d = Distance();
      final c = LatLng(b.lat!, b.lng!);
      puntos.addAll([d.offset(c, r, 0), d.offset(c, r, 90), d.offset(c, r, 180), d.offset(c, r, 270)]);
    }
    if (puntos.length < 2) return null;
    return CameraFit.bounds(
      bounds: LatLngBounds.fromPoints(puntos),
      padding: const EdgeInsets.fromLTRB(40, 90, 40, 60),
      maxZoom: 18,
    );
  }

  Color _colorDe(String estado) => switch (estado) {
        'sin_revision' => AppColors.danger,
        'vencida' => AppColors.warning,
        _ => const Color(0xFFFDE047), // próxima
      };

  PinDeMapa? get _pinElegido {
    for (final p in widget.pines) {
      if (p.v.vehiculoId == _elegido) return p;
    }
    return null;
  }

  void _acercarA(GrupoDePines g) {
    final destino = (_zoom + 1.5).clamp(0, _zoomMaximo).toDouble();
    _mapa.move(LatLng(g.lat, g.lng), destino);
  }

  Future<void> _revisar(VehiculoPresencia v) async {
    if (_abriendo != null) return;
    setState(() => _abriendo = v.vehiculoId);
    try {
      await widget.onRevisar(v);
    } finally {
      if (mounted) setState(() => _abriendo = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pines = widget.pines;
    final grupos = agruparPines(pines, _zoom, zoomMaximo: _zoomMaximo);
    final elegido = _pinElegido;
    final b = widget.base;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(b.nombre),
            Text(
              pines.isEmpty
                  ? 'Ningún autobús pendiente dentro de la base'
                  : '${pines.length} con revisión pendiente dentro de la base',
              style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, fontWeight: FontWeight.w400),
            ),
          ],
        ),
      ),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _mapa,
            options: MapOptions(
              initialCenter: _centro,
              initialZoom: _zoomInicial,
              initialCameraFit: _encuadre,
              minZoom: 12,
              maxZoom: _zoomMaximo,
              // Sin girar: en un patio se orienta uno por el norte arriba, y un
              // mapa girado sin querer con dos dedos despista más que ayuda.
              interactionOptions: const InteractionOptions(
                flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
              ),
              onTap: (_, __) => setState(() => _elegido = null),
              onPositionChanged: (pos, _) {
                final z = pos.zoom;
                // Solo se repinta al cruzar medio nivel: reagrupar en cada
                // píxel de un pellizco haría bailar las etiquetas.
                if (z != null && (z - _zoom).abs() >= 0.5) setState(() => _zoom = z);
              },
            ),
            children: [
              if (!widget.sinMosaicos)
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'com.seatarragona.tyrecontrol_app',
                  maxNativeZoom: 19,
                ),
              if (posicionUtil(b.lat, b.lng) && (b.radioM ?? 0) > 0)
                CircleLayer(circles: [
                  CircleMarker(
                    point: LatLng(b.lat!, b.lng!),
                    radius: b.radioM!,
                    useRadiusInMeter: true,
                    color: AppColors.success.withValues(alpha: 0.07),
                    borderColor: AppColors.success,
                    borderStrokeWidth: 2,
                  ),
                ]),
              if (_yo != null)
                MarkerLayer(markers: [
                  Marker(
                    point: _yo!,
                    width: 30,
                    height: 30,
                    child: Semantics(
                      label: 'Tu posición',
                      child: Container(
                        key: const Key('mapa-mi-posicion'),
                        decoration: BoxDecoration(
                          color: AppColors.info,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 4),
                          boxShadow: [BoxShadow(color: AppColors.info.withValues(alpha: 0.35), blurRadius: 0, spreadRadius: 7)],
                        ),
                      ),
                    ),
                  ),
                ]),
              MarkerLayer(markers: [
                for (final g in grupos)
                  if (g.esUno)
                    Marker(
                      point: LatLng(g.lat, g.lng),
                      width: 124,
                      height: 52,
                      // La punta de la etiqueta, y no su centro, es el sitio
                      // del autobús.
                      alignment: Alignment.topCenter,
                      child: _Etiqueta(
                        pin: g.pines.first,
                        color: _colorDe(g.pines.first.rev.estado),
                        elegida: g.pines.first.v.vehiculoId == _elegido,
                        onTap: () => setState(() => _elegido = g.pines.first.v.vehiculoId),
                      ),
                    )
                  else
                    Marker(
                      point: LatLng(g.lat, g.lng),
                      width: 52,
                      height: 52,
                      child: _Grupo(
                        cuantos: g.pines.length,
                        color: _colorDe(g.estadoMasUrgente),
                        onTap: () => _acercarA(g),
                      ),
                    ),
              ]),
            ],
          ),

          // OpenStreetMap pide que se le cite donde se usan sus mapas.
          if (!widget.sinMosaicos)
            Positioned(
              right: 6,
              bottom: elegido == null ? 6 : null,
              top: elegido == null ? null : 6,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                color: Colors.white.withValues(alpha: 0.75),
                child: const Text('© OpenStreetMap', style: TextStyle(fontSize: 10, color: Colors.black87)),
              ),
            ),

          Positioned(left: 12, top: 12, child: _leyenda(pines)),

          Positioned(
            right: 12,
            top: 12 + (elegido == null ? 0 : 22),
            child: Column(
              children: [
                _botonMapa(Icons.center_focus_strong, 'Centrar en la base', () {
                  final f = _encuadre;
                  if (f != null) {
                    _mapa.fitCamera(f);
                  } else {
                    _mapa.move(_centro, _zoomInicial);
                  }
                }),
                const SizedBox(height: 8),
                _botonMapa(Icons.add, 'Acercar',
                    () => _mapa.move(_mapa.camera.center, (_mapa.camera.zoom + 1).clamp(12, _zoomMaximo).toDouble())),
                const SizedBox(height: 8),
                _botonMapa(Icons.remove, 'Alejar',
                    () => _mapa.move(_mapa.camera.center, (_mapa.camera.zoom - 1).clamp(12, _zoomMaximo).toDouble())),
                if (_yo != null) ...[
                  const SizedBox(height: 8),
                  _botonMapa(Icons.my_location, 'Ir a mi posición', () => _mapa.move(_yo!, 18)),
                ],
              ],
            ),
          ),

          if (pines.isEmpty)
            Positioned(
              left: 12,
              right: 12,
              bottom: 12,
              child: _tarjeta(const Text(
                'Ahora mismo no hay ningún autobús con la revisión pendiente dentro de esta base.',
                style: TextStyle(color: AppColors.textSecondary),
              )),
            ),

          if (elegido != null)
            Positioned(
              left: 12,
              right: 12,
              bottom: 12,
              child: SafeArea(
                top: false,
                child: Stack(
                  children: [
                    FichaVehiculoEnBase(
                      key: ValueKey('ficha-${elegido.v.vehiculoId}'),
                      v: elegido.v,
                      rev: elegido.rev,
                      nombreDeBase: widget.nombreDeBase,
                      abriendo: _abriendo == elegido.v.vehiculoId,
                      onRevisar: () => _revisar(elegido.v),
                    ),
                    Positioned(
                      right: 0,
                      bottom: 62,
                      child: IconButton(
                        key: const Key('mapa-cerrar-ficha'),
                        tooltip: 'Cerrar la ficha',
                        icon: const Icon(Icons.close, color: AppColors.textSecondary),
                        onPressed: () => setState(() => _elegido = null),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _tarjeta(Widget child) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: child,
      );

  Widget _botonMapa(IconData icono, String que, VoidCallback onTap) => Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.cardBorder),
        ),
        child: IconButton(
          tooltip: que,
          icon: Icon(icono, color: AppColors.textPrimary),
          onPressed: onTap,
          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        ),
      );

  Widget _leyenda(List<PinDeMapa> pines) {
    final n = cuentaPorEstado(pines);
    Widget fila(Widget marca, String texto) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            marca,
            const SizedBox(width: 8),
            Text(texto, style: const TextStyle(fontSize: 12, color: AppColors.textPrimary)),
          ]),
        );
    Widget cuadro(Color c) => Container(
          width: 14,
          height: 14,
          decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(4)),
        );
    return Container(
      key: const Key('mapa-leyenda'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          fila(cuadro(AppColors.danger), 'Sin revisión · ${n['sin_revision'] ?? 0}'),
          fila(cuadro(AppColors.warning), 'Revisión vencida · ${n['vencida'] ?? 0}'),
          if ((n['proxima'] ?? 0) > 0)
            fila(cuadro(const Color(0xFFFDE047)), 'Revisión próxima · ${n['proxima']}'),
          if (pines.any((p) => p.vieja))
            fila(
              const Icon(Icons.schedule, size: 14, color: AppColors.textSecondary),
              'Posición de hace más de 1 h',
            ),
        ],
      ),
    );
  }
}

/// La etiqueta de un autobús: su matrícula y, debajo, la punta que marca el
/// sitio.
class _Etiqueta extends StatelessWidget {
  final PinDeMapa pin;
  final Color color;
  final bool elegida;
  final VoidCallback onTap;

  const _Etiqueta({required this.pin, required this.color, required this.elegida, required this.onTap});

  @override
  Widget build(BuildContext context) {
    // Con la posición vieja, el relleno se quita y queda el contorno: se lee
    // la matrícula igual, pero no parece tan seguro como los demás.
    final relleno = pin.vieja ? AppColors.surface : color;
    final texto = pin.vieja
        ? color
        : (color == AppColors.danger ? Colors.white : const Color(0xFF2A1700));
    return Semantics(
      button: true,
      label: '${pin.v.matricula}, ${_estado(pin.rev.estado)}'
          '${pin.vieja ? ', posición de hace más de una hora' : ''}',
      child: GestureDetector(
        key: Key('pin-${pin.v.matricula}'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                color: relleno,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: elegida ? Colors.white : color,
                  width: elegida ? 3 : 2,
                ),
                boxShadow: [
                  if (elegida)
                    BoxShadow(color: Colors.white.withValues(alpha: 0.3), spreadRadius: 4)
                  else
                    const BoxShadow(color: Colors.black54, blurRadius: 5, offset: Offset(0, 2)),
                ],
              ),
              // Una matrícula larga (o un remolque, «R-1234-BBC») se encoge
              // para caber en la etiqueta en vez de desbordarla.
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (pin.vieja) ...[
                      Icon(Icons.schedule, size: 13, color: texto),
                      const SizedBox(width: 4),
                    ],
                    Text(
                      pin.v.matricula,
                      maxLines: 1,
                      style: TextStyle(
                        color: texto,
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.4,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Container(width: 2, height: 7, color: color),
            Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.background, width: 2),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _estado(String e) => switch (e) {
        'sin_revision' => 'sin revisión',
        'vencida' => 'revisión vencida',
        _ => 'revisión próxima',
      };
}

/// Varios autobuses que a este zoom se taparían: un círculo con cuántos son.
class _Grupo extends StatelessWidget {
  final int cuantos;
  final Color color;
  final VoidCallback onTap;

  const _Grupo({required this.cuantos, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$cuantos autobuses pendientes juntos: tocar para acercar',
      child: GestureDetector(
        key: Key('grupo-$cuantos'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.background, width: 3),
            boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 5, offset: Offset(0, 2))],
          ),
          child: Text(
            '$cuantos',
            style: TextStyle(
              color: color == AppColors.danger ? Colors.white : const Color(0xFF2A1700),
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }
}
