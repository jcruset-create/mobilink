import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/supabase_service.dart';
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
  /// Valores ya resueltos por posición (revisión → neumático → catálogo /
  /// presión objetivo del eje). Si falta la posición, se usa [detalles].
  final Map<String, ({double? prof, double? pres})> valores;
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
    this.valores = const {},
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
        // primero por ancho y, si se pasa de alto, se encoge por alto. En un
        // scroll (maxHeight infinito, p.ej. la ficha) se aplica un tope propio
        // proporcional a la pantalla para que TODAS las imágenes de chasis
        // salgan con la misma medida visual, da igual su resolución o aspecto.
        final maxH = c.maxHeight.isFinite
            ? c.maxHeight
            : MediaQuery.of(context).size.height * 0.66;
        double w = c.maxWidth;
        double h = w / aspect;
        if (h > maxH) {
          h = maxH;
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
        valor: widget.valores[p.id],
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
  final ({double? prof, double? pres})? valor;
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
    required this.valor,
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
    // Recuadro pintado entero del color del estado (nuevo / bien / justo / mal).
    // Mientras se mide, la rueda activa manda: se queda con el marco azul.
    final fill = seleccionada ? null : tireStatusFill(status);
    final color = seleccionada ? AppColors.tireSeleccionado : tireStatusColor(status);
    final cTexto = fill != null ? tireStatusOnFill(status) : AppColors.textPrimary;
    final cSuave = fill != null ? cTexto.withValues(alpha: 0.72) : AppColors.textSecondary;
    final cTenue = fill != null ? cTexto.withValues(alpha: 0.60) : AppColors.textHint;
    final cAcento = fill != null ? cTexto : color;

    final prof = liveProf ?? draft?.profundidadMm ?? valor?.prof;
    final pres = livePres ?? draft?.presionBar ?? valor?.pres;
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
            color: fill ?? AppColors.surface.withValues(alpha: 0.92),
            border: Border.all(
              color: fill != null ? Color.alphaBlend(Colors.black.withValues(alpha: 0.30), fill) : color,
              width: seleccionada ? 3 : 2,
            ),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                p.nombre ?? p.codigoPosicion,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: cAcento),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 1),
              if (neumatico != null) ...[
                Text(
                  neumatico!.marca ?? '—',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: cTexto),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if ((neumatico!.modelo ?? '').isNotEmpty)
                  Text(
                    neumatico!.modelo!,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 10, color: cSuave),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (medida.isNotEmpty)
                  Text(
                    medida,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 9, color: cSuave),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                // Distintivos del propio neumático: recauchutado (lo dice la
                // marca) y reesculturado (se le han cortado dibujos nuevos).
                if (TyreControlApi.esMarcaRecauchutada(neumatico!.marca) ||
                    neumatico!.reesculturado ||
                    neumatico!.giradoEnLlanta)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Wrap(
                      alignment: WrapAlignment.center,
                      spacing: 3,
                      children: [
                        if (TyreControlApi.esMarcaRecauchutada(neumatico!.marca))
                          _EtiquetaNeu(txt: 'RECAUCH.', color: cTexto),
                        if (neumatico!.reesculturado) _EtiquetaNeu(txt: 'REESC.', color: cTexto),
                        if (neumatico!.giradoEnLlanta) _EtiquetaNeu(txt: 'GIRADO', color: cTexto),
                      ],
                    ),
                  ),
              ] else
                const Text('Sin neumático', style: TextStyle(fontSize: 10, color: AppColors.textHint)),
              const SizedBox(height: 1),
              Text(
                '$profTxt · $presTxt',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: cAcento),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (ultima != null && (ultima!.fecha != null || _ultimaMedidasTxt() != null)) ...[
                const SizedBox(height: 2),
                Divider(height: 1, thickness: 0.5, color: fill != null ? cTexto.withValues(alpha: 0.30) : AppColors.cardBorder),
                const SizedBox(height: 2),
                if (ultima!.fecha != null)
                  Text(
                    'Últ. rev. ${_fmtFecha(ultima!.fecha!)}',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 9, color: cTenue),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (_ultimaMedidasTxt() != null)
                  Text(
                    _ultimaMedidasTxt()!,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 9, color: cTenue),
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

/// Etiqueta pequeña del propio neumático (recauchutado, reesculturado, girado).
class _EtiquetaNeu extends StatelessWidget {
  final String txt;
  final Color color;
  const _EtiquetaNeu({required this.txt, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.55)),
      ),
      child: Text(txt,
          style: TextStyle(fontSize: 8, fontWeight: FontWeight.w800, color: color, height: 1.1)),
    );
  }
}
