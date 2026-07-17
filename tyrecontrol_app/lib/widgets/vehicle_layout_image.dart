import 'package:flutter/material.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';

/// Plano del vehículo con la FOTO real de fondo y una tarjeta por posición,
/// colocada en las coordenadas calibradas en el panel web (pos_x/y/w/h, en %).
/// La foto se ajusta al área disponible (ancho Y alto) para que el vehículo
/// entero quepa en la tablet sin necesidad de hacer scroll.
class VehicleLayoutImage extends StatefulWidget {
  final String imagenUrl;
  final List<PosicionVehiculo> posiciones;
  final Map<String, MontajeActual> montajePorPosicion;
  final Map<String, RevisionDetalleDraft> detalles;
  final Map<String, TireStatus> estados;
  final Map<String, UltimaMedicion> ultimas; // última medición conocida por posición
  final String? seleccionadaId;
  final double? liveProf; // medida en curso de la rueda activa
  final double? livePres;
  final void Function(PosicionVehiculo) onTap;

  const VehicleLayoutImage({
    super.key,
    required this.imagenUrl,
    required this.posiciones,
    required this.montajePorPosicion,
    required this.detalles,
    required this.estados,
    this.ultimas = const {},
    required this.seleccionadaId,
    required this.liveProf,
    required this.livePres,
    required this.onTap,
  });

  @override
  State<VehicleLayoutImage> createState() => _VehicleLayoutImageState();
}

class _VehicleLayoutImageState extends State<VehicleLayoutImage> {
  double? _aspect; // ancho/alto real de la imagen
  ImageStream? _stream;
  ImageStreamListener? _listener;

  @override
  void initState() {
    super.initState();
    _resolver();
  }

  @override
  void didUpdateWidget(VehicleLayoutImage old) {
    super.didUpdateWidget(old);
    if (old.imagenUrl != widget.imagenUrl) {
      _aspect = null;
      _resolver();
    }
  }

  void _resolver() {
    _stream?.removeListener(_listener!);
    final img = NetworkImage(widget.imagenUrl);
    _stream = img.resolve(ImageConfiguration.empty);
    _listener = ImageStreamListener((info, _) {
      final w = info.image.width.toDouble();
      final h = info.image.height.toDouble();
      if (h > 0 && mounted) setState(() => _aspect = w / h);
    }, onError: (_, __) {
      if (mounted) setState(() => _aspect = 0.62); // fallback vertical
    });
    _stream!.addListener(_listener!);
  }

  @override
  void dispose() {
    if (_stream != null && _listener != null) _stream!.removeListener(_listener!);
    super.dispose();
  }

  // Coordenadas por defecto (%) si una posición aún no está calibrada.
  ({double x, double y, double w, double h}) _coords(PosicionVehiculo p, int i) {
    if (p.posX != null && p.posY != null && p.posW != null && p.posH != null) {
      return (x: p.posX!, y: p.posY!, w: p.posW!, h: p.posH!);
    }
    final col = i % 2;
    final row = i ~/ 2;
    return (x: col == 0 ? 6 : 78, y: 8 + row * 18, w: 16, h: 13);
  }

  @override
  Widget build(BuildContext context) {
    if (_aspect == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final aspect = _aspect!;
    return LayoutBuilder(
      builder: (context, c) {
        // Ajustar la imagen dentro del área disponible manteniendo su aspecto:
        // primero por ancho y, si se pasa de alto, se recorta por alto.
        double w = c.maxWidth;
        double h = w / aspect;
        if (c.maxHeight.isFinite && h > c.maxHeight) {
          h = c.maxHeight;
          w = h * aspect;
        }
        return Center(
          child: SizedBox(
            width: w,
            height: h,
            child: Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: Image.network(
                    widget.imagenUrl,
                    width: w,
                    height: h,
                    fit: BoxFit.fill, // la caja ya respeta el aspecto real
                    errorBuilder: (_, __, ___) => Container(
                      color: AppColors.surface,
                      child: const Center(child: Icon(Icons.directions_car, size: 48, color: AppColors.textHint)),
                    ),
                  ),
                ),
                for (int i = 0; i < widget.posiciones.length; i++)
                  _cardPositioned(widget.posiciones[i], i, w, h),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _cardPositioned(PosicionVehiculo p, int i, double w, double h) {
    final co = _coords(p, i);
    final cardW = (co.w / 100 * w).clamp(108.0, 210.0);
    return Positioned(
      left: (co.x / 100 * w).clamp(0.0, w - cardW),
      top: (co.y / 100 * h).clamp(0.0, h - 36),
      width: cardW,
      child: _TarjetaPosicion(
        p: p,
        neumatico: widget.montajePorPosicion[p.id]?.neumatico,
        draft: widget.detalles[p.id],
        status: widget.estados[p.id] ?? TireStatus.pendiente,
        ultima: widget.ultimas[p.id],
        seleccionada: p.id == widget.seleccionadaId,
        liveProf: p.id == widget.seleccionadaId ? widget.liveProf : null,
        livePres: p.id == widget.seleccionadaId ? widget.livePres : null,
        onTap: () => widget.onTap(p),
      ),
    );
  }
}

class _TarjetaPosicion extends StatelessWidget {
  final PosicionVehiculo p;
  final Neumatico? neumatico;
  final RevisionDetalleDraft? draft;
  final TireStatus status;
  final UltimaMedicion? ultima;
  final bool seleccionada;
  final double? liveProf;
  final double? livePres;
  final VoidCallback onTap;

  const _TarjetaPosicion({
    required this.p,
    required this.neumatico,
    required this.draft,
    required this.status,
    required this.ultima,
    required this.seleccionada,
    required this.liveProf,
    required this.livePres,
    required this.onTap,
  });

  static String _fmtFecha(DateTime d) => '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year % 100}';

  /// Medidas de la última revisión: "13.4 mm · 8.5 bar" (o null si no hay).
  String? _ultimaMedidasTxt() {
    final u = ultima;
    if (u == null) return null;
    final med = <String>[];
    if (u.profundidadMm != null) med.add('${u.profundidadMm!.toStringAsFixed(1)} mm');
    if (u.presionBar != null) med.add('${u.presionBar!.toStringAsFixed(1)} bar');
    return med.isEmpty ? null : med.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final color = seleccionada ? AppColors.tireSeleccionado : tireStatusColor(status);

    final prof = liveProf ?? draft?.profundidadMm;
    final pres = livePres ?? draft?.presionBar;
    final profTxt = prof != null ? '${prof.toStringAsFixed(1)} mm' : '— mm';
    final presTxt = pres != null ? '${pres.toStringAsFixed(1)} bar' : '— bar';

    final ic = [neumatico?.indiceCarga, neumatico?.indiceVelocidad].where((e) => e != null && e.isNotEmpty).join('');
    final medida = [neumatico?.medida, ic].where((e) => e != null && e.isNotEmpty).join(' ');

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: 0.92),
            border: Border.all(color: color, width: seleccionada ? 3 : 2),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                p.nombre ?? p.codigoPosicion,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: color),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 1),
              if (neumatico != null) ...[
                Text(
                  neumatico!.marca ?? '—',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if ((neumatico!.modelo ?? '').isNotEmpty)
                  Text(
                    neumatico!.modelo!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 10, color: AppColors.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (medida.isNotEmpty)
                  Text(
                    medida,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 9, color: AppColors.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
              ] else
                const Text('Sin neumático', style: TextStyle(fontSize: 10, color: AppColors.textHint)),
              const SizedBox(height: 1),
              Text(
                '$profTxt · $presTxt',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: color),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (ultima != null && (ultima!.fecha != null || _ultimaMedidasTxt() != null)) ...[
                const SizedBox(height: 2),
                const Divider(height: 1, thickness: 0.5, color: AppColors.cardBorder),
                const SizedBox(height: 2),
                if (ultima!.fecha != null)
                  Text(
                    'Últ. rev. ${_fmtFecha(ultima!.fecha!)}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 9, color: AppColors.textHint),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (_ultimaMedidasTxt() != null)
                  Text(
                    _ultimaMedidasTxt()!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 9, color: AppColors.textHint),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
