import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

// El plano de un trabajo de cambio de neumáticos: la imagen del chasis de
// TyreControl con una caja por rueda, y en naranja las que hay que cambiar.
//
// Las coordenadas vienen en % del plano de TyreControl. La imagen se pinta más
// pequeña que el plano, con margen, y las cajas se recolocan con la misma
// cuenta que el panel (shared/planoMargen.ts): si aquí se hiciera de otra
// manera, las ruedas caerían fuera de su sitio.

const _margenCoordX = 0.12;
const _margenCoordY = 0.04;
const _margenVistaX = 0.22;
const _margenVistaY = 0.08;

/// Proporción del plano entero a partir de la de la imagen.
double aspectoPlano(double aspectoImagen) =>
    aspectoImagen * (1 - 2 * _margenVistaY) / (1 - 2 * _margenVistaX);

/// Centro de una caja, de coordenadas calibradas a coordenadas de la vista (%).
Offset centroEnVista(double x, double y) {
  const ex = (1 - 2 * _margenVistaX) / (1 - 2 * _margenCoordX);
  const ey = (1 - 2 * _margenVistaY) / (1 - 2 * _margenCoordY);
  return Offset(
    _margenVistaX * 100 + (x - _margenCoordX * 100) * ex,
    _margenVistaY * 100 + (y - _margenCoordY * 100) * ey,
  );
}

/// «E2 IZQ EXT»
String etiquetaPosicion(Map<String, dynamic> p) {
  final eje = p['eje'];
  if (eje == null) return p['codigo']?.toString() ?? '';
  final lado = (p['lado']?.toString() ?? '').toLowerCase().startsWith('d') ? 'DER' : 'IZQ';
  final ie = (p['interiorExterior']?.toString() ?? '').toLowerCase();
  final sufijo = ie.startsWith('int') ? ' INT' : ie.startsWith('ext') ? ' EXT' : '';
  return 'E$eje $lado$sufijo';
}

class PlanoRuedas extends StatefulWidget {
  /// El campo `neumaticos` de un trabajo de OTF.
  final Map<String, dynamic> neumaticos;
  final double maxAncho;
  const PlanoRuedas({super.key, required this.neumaticos, this.maxAncho = 360});

  @override
  State<PlanoRuedas> createState() => _PlanoRuedasState();
}

class _PlanoRuedasState extends State<PlanoRuedas> {
  double _aspecto = 0.6;
  ImageStream? _stream;
  ImageStreamListener? _listener;

  List<Map<String, dynamic>> get _posiciones =>
      (widget.neumaticos['posiciones'] as List<dynamic>? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  Set<String> get _seleccion =>
      (widget.neumaticos['seleccion'] as List<dynamic>? ?? []).map((e) => e.toString()).toSet();
  String? get _imagen {
    final u = widget.neumaticos['imagenUrl']?.toString() ?? '';
    return u.isEmpty ? null : u;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final url = _imagen;
    if (url == null || _stream != null) return;
    // La proporción real de la imagen: el plano se ajusta a ella.
    _listener = ImageStreamListener((info, _) {
      if (!mounted || info.image.height == 0) return;
      setState(() => _aspecto = aspectoPlano(info.image.width / info.image.height));
    }, onError: (_, __) {});
    _stream = NetworkImage(url).resolve(createLocalImageConfiguration(context))..addListener(_listener!);
  }

  @override
  void dispose() {
    if (_listener != null) _stream?.removeListener(_listener!);
    super.dispose();
  }

  Widget _caja(Map<String, dynamic> p, {double fuente = 11}) {
    final on = _seleccion.contains(p['codigo']?.toString());
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: on ? AppColors.warning : AppColors.surfaceVariant.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: on ? const Color(0xFFFFD2B0) : AppColors.cardBorder, width: 2),
      ),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Padding(
          padding: const EdgeInsets.all(2),
          child: Text(
            etiquetaPosicion(p),
            style: TextStyle(
              color: on ? AppColors.onPrimary : AppColors.textSecondary,
              fontSize: fuente,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ps = _posiciones;
    if (ps.isEmpty) return const SizedBox.shrink();
    final calibrado = ps.every((p) => p['x'] is num && p['y'] is num);

    if (!calibrado) {
      // Sin coordenadas: una fila por eje, de delante a atrás.
      final ejes = ps.map((p) => (p['eje'] as num?)?.toInt() ?? 0).toSet().toList()..sort();
      return Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('DELANTE', style: TextStyle(color: AppColors.textHint, fontSize: 11, letterSpacing: 1.5)),
        for (final e in ejes)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (final p in ps.where((p) => ((p['eje'] as num?)?.toInt() ?? 0) == e))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  child: SizedBox(width: 64, height: 48, child: _caja(p)),
                ),
            ]),
          ),
      ]);
    }

    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: widget.maxAncho),
      child: AspectRatio(
        aspectRatio: _aspecto,
        child: LayoutBuilder(builder: (_, c) {
          final w = c.maxWidth, h = c.maxHeight;
          return ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Stack(children: [
              Positioned.fill(child: Container(color: AppColors.background)),
              if (_imagen != null)
                Positioned(
                  left: w * _margenVistaX,
                  top: h * _margenVistaY,
                  width: w * (1 - 2 * _margenVistaX),
                  height: h * (1 - 2 * _margenVistaY),
                  child: Image.network(_imagen!, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const SizedBox.shrink()),
                ),
              for (final p in ps)
                () {
                  final pw = (p['w'] as num?)?.toDouble() ?? 14;
                  final ph = (p['h'] as num?)?.toDouble() ?? 14;
                  final centro = centroEnVista(
                    (p['x'] as num).toDouble() + pw / 2,
                    (p['y'] as num).toDouble() + ph / 2,
                  );
                  return Positioned(
                    left: w * (centro.dx - pw / 2) / 100,
                    top: h * (centro.dy - ph / 2) / 100,
                    width: w * pw / 100,
                    height: h * ph / 100,
                    child: _caja(p),
                  );
                }(),
            ]),
          );
        }),
      ),
    );
  }
}

/// El bloque completo para las pantallas del trabajo: título, plano, las
/// ruedas con nombre y el neumático que se monta.
class RuedasACambiar extends StatelessWidget {
  final Map<String, dynamic> trabajo;
  const RuedasACambiar({super.key, required this.trabajo});

  @override
  Widget build(BuildContext context) {
    final n = trabajo['neumaticos'];
    if (n is! Map) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.6)),
      ),
      child: Column(children: [
        const Align(
          alignment: Alignment.centerLeft,
          child: Text('Ruedas a cambiar',
              style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
        ),
        const SizedBox(height: 10),
        PlanoRuedas(neumaticos: Map<String, dynamic>.from(n)),
        const SizedBox(height: 10),
        if ((trabajo['posicionesTexto'] ?? '').toString().isNotEmpty)
          Text(trabajo['posicionesTexto'].toString(),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFFFD2B0), fontSize: 15, fontWeight: FontWeight.w800)),
        if ((trabajo['neumaticosTexto'] ?? '').toString().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(trabajo['neumaticosTexto'].toString(),
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ),
      ]),
    );
  }
}
