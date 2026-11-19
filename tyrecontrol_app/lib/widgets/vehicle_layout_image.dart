import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'etiqueta_neumatico.dart';
import 'plano_margen.dart';

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
    return LayoutBuilder(
      builder: (context, c) {
        // El plano se ajusta al área disponible (ver `ajustePlano`). En un
        // scroll (maxHeight infinito, p.ej. la ficha) se aplica un tope propio
        // proporcional a la pantalla para que TODAS las imágenes de chasis
        // salgan con la misma medida visual, da igual su resolución o aspecto.
        final maxH = c.maxHeight.isFinite
            ? c.maxHeight
            : MediaQuery.of(context).size.height * 0.66;
        final a = ajustePlano(c.maxWidth, maxH, _aspect!);
        final w = a.w;
        final h = a.h;
        final ri = rectImagenEnPlano(w, h, mx: a.mx, my: a.my);
        final cajas = _cajas(w, h, a.mx, a.my, ri);
        return Center(
          child: SizedBox(
            width: w,
            height: h,
            child: Stack(
              children: [
                Positioned(
                  left: ri.x, top: ri.y, width: ri.w, height: ri.h,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: Image.network(
                      widget.imagenUrl,
                      width: ri.w,
                      height: ri.h,
                      fit: BoxFit.fill, // la caja ya respeta el aspecto real
                      errorBuilder: (_, __, ___) => Container(
                        color: AppColors.surface,
                        child: const Center(child: Icon(Icons.directions_car, size: 48, color: AppColors.textHint)),
                      ),
                    ),
                  ),
                ),
                for (int i = 0; i < widget.posiciones.length; i++)
                  _cardPositioned(widget.posiciones[i], cajas[i]),
              ],
            ),
          ),
        );
      },
    );
  }

  /// Cuánto puede ensancharse una tarjeta respecto a su ancho calibrado…
  static const double _crecimientoMax = 2.2;

  /// …y hasta qué ancho: con esto ya caben sus textos enteros. Una tarjeta
  /// que ya lo mide (tablet grande, apaisado) se queda como está calibrada.
  static const double _anchoBastante = 132;

  /// Dónde va cada tarjeta, en píxeles del plano.
  ///
  /// El ancho calibrado es un % del plano, y en una tablet estrecha no da ni
  /// para «Hankook». Una tarjeta que está en el margen, fuera de la imagen,
  /// tiene sitio libre hacia el borde: se ensancha hacia FUERA —el lado que da
  /// a la rueda no se mueve— hasta el borde del plano o hasta la tarjeta que
  /// tenga al lado (ruedas gemelas). Y su alto se limita al hueco que hay
  /// hasta la tarjeta de debajo, para que no se pisen.
  List<({double left, double top, double width, double maxHeight})> _cajas(
    double w, double h, double mx, double my, ({double x, double y, double w, double h}) ri,
  ) {
    const aire = 3.0;
    final n = widget.posiciones.length;
    final izq = List<double>.filled(n, 0);
    final der = List<double>.filled(n, 0);
    final arriba = List<double>.filled(n, 0);
    final abajo = List<double>.filled(n, 0);
    for (int i = 0; i < n; i++) {
      final co = cajaAVista(_coords(widget.posiciones[i], i), mx: mx, my: my);
      final cardW = co.w / 100 * w;
      final centroX = (co.x + co.w / 2) / 100 * w;
      izq[i] = (centroX - cardW / 2).clamp(0.0, w - cardW);
      der[i] = izq[i] + cardW;
      arriba[i] = (co.y / 100 * h).clamp(0.0, h - 36);
      abajo[i] = arriba[i] + co.h / 100 * h;
    }
    bool seSolapanEnVertical(int i, int j) => arriba[i] < abajo[j] && arriba[j] < abajo[i];

    final nIzq = List<double>.from(izq);
    final nDer = List<double>.from(der);
    for (int i = 0; i < n; i++) {
      final ancho = der[i] - izq[i];
      final centro = (izq[i] + der[i]) / 2;
      var objetivo = ancho * _crecimientoMax;
      if (objetivo > _anchoBastante) objetivo = _anchoBastante;
      if (objetivo < ancho) objetivo = ancho;
      // Solo las que están en el margen: una sobre la imagen taparía la rueda.
      if (centro < ri.x + aire) {
        var limite = aire;
        for (int j = 0; j < n; j++) {
          if (j != i && seSolapanEnVertical(i, j) && der[j] <= izq[i] + 1 && der[j] + aire > limite) {
            limite = der[j] + aire;
          }
        }
        final deseado = der[i] - objetivo;
        nIzq[i] = (deseado > limite ? deseado : limite).clamp(0.0, izq[i]);
      } else if (centro > ri.x + ri.w - aire) {
        var limite = w - aire;
        for (int j = 0; j < n; j++) {
          if (j != i && seSolapanEnVertical(i, j) && izq[j] >= der[i] - 1 && izq[j] - aire < limite) {
            limite = izq[j] - aire;
          }
        }
        final deseado = izq[i] + objetivo;
        nDer[i] = (deseado < limite ? deseado : limite).clamp(der[i], w);
      }
    }

    // El hueco hasta la tarjeta de debajo que comparta columna. Se usa el
    // MENOR de todos para todas: si hay que encoger, se encogen igual y no
    // sale una tarjeta más pequeña que su vecina.
    var hueco = double.infinity;
    for (int i = 0; i < n; i++) {
      var suelo = h;
      for (int j = 0; j < n; j++) {
        if (j != i && arriba[j] > arriba[i] && nIzq[i] < nDer[j] && nIzq[j] < nDer[i] && arriba[j] < suelo) {
          suelo = arriba[j];
        }
      }
      if (suelo - arriba[i] - aire < hueco) hueco = suelo - arriba[i] - aire;
    }
    if (!hueco.isFinite || hueco < 36) hueco = 36;

    return [
      for (int i = 0; i < n; i++)
        (left: nIzq[i], top: arriba[i], width: nDer[i] - nIzq[i], maxHeight: hueco),
    ];
  }

  Widget _cardPositioned(PosicionVehiculo p, ({double left, double top, double width, double maxHeight}) caja) {
    return Positioned(
      left: caja.left,
      top: caja.top,
      width: caja.width,
      // Si el contenido no cabe en su hueco se encoge entero, en vez de pisar
      // la tarjeta de debajo.
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: caja.maxHeight),
        child: FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.topCenter,
          child: SizedBox(
            width: caja.width,
            child: _TarjetaPosicion(
              ancha: caja.width >= _TarjetaPosicion.anchoParaUnaLinea,
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
          ),
        ),
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

  /// Con sitio a lo ancho, marca y modelo van en una línea y el distintivo
  /// junto al nombre de la posición: la tarjeta sale más baja, que es lo que
  /// falta en una tablet pequeña.
  final bool ancha;

  /// A partir de este ancho caben «Hankook TH31+» y «Eje 2 izquierda REESC.».
  static const double anchoParaUnaLinea = 96;

  const _TarjetaPosicion({
    this.ancha = false,
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

  List<Widget> _distintivos(Color cTexto) {
    final n = neumatico;
    if (n == null) return const [];
    return [
      // "Nuevo" ya no se ve por el color (ahora manda la profundidad), así
      // que se dice con todas las letras.
      if (status == TireStatus.nuevo) EtiquetaNeu(txt: 'NEW', color: cTexto, fondo: AppColors.tireNuevo),
      if (TyreControlApi.esMarcaRecauchutada(n.marca)) EtiquetaNeu(txt: 'RECAUCH.', color: cTexto),
      if (n.reesculturado) EtiquetaNeu(txt: 'REESC.', color: cTexto, fondo: AppColors.reesculturado),
      if (n.giradoEnLlanta) EtiquetaNeu(txt: 'GIRADO', color: cTexto),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final prof = liveProf ?? draft?.profundidadMm ?? valor?.prof;
    final pres = livePres ?? draft?.presionBar ?? valor?.pres;

    // El recuadro se pinta con la BANDA DE PROFUNDIDAD del informe de flota:
    // el técnico ve el mismo color que verá el cliente en su informe. Sin
    // profundidad conocida se cae al color del estado (gris de pendiente…).
    // Mientras se mide, la rueda activa manda: se queda con el marco azul.
    final banda = prof != null ? bandaProfundidad(prof) : null;
    final fill = seleccionada ? null : (banda?.fondo ?? tireStatusFill(status));
    // El relleno ya no dice si la rueda está mal, así que lo dice el marco:
    // una avería con 15 mm saldría verde oscuro y, sin esto, no se
    // distinguiría de una rueda sana.
    final alerta = status == TireStatus.grave || status == TireStatus.advertencia;
    final color = seleccionada ? AppColors.tireSeleccionado : tireStatusColor(status);
    final cTexto = fill != null ? (banda?.tinta ?? tireStatusOnFill(status)) : AppColors.textPrimary;
    final cSuave = fill != null ? cTexto.withValues(alpha: 0.72) : AppColors.textSecondary;
    final cTenue = fill != null ? cTexto.withValues(alpha: 0.60) : AppColors.textHint;
    final cAcento = fill != null ? cTexto : color;
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
              color: (!seleccionada && alerta)
                  ? color
                  : (fill != null ? Color.alphaBlend(Colors.black.withValues(alpha: 0.30), fill) : color),
              width: (seleccionada || (!seleccionada && alerta)) ? 3 : 2,
            ),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              () {
                final nombre = Text(
                  p.nombre ?? p.codigoPosicion,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: cAcento),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                );
                final distintivos = _distintivos(cTexto);
                if (!ancha || distintivos.isEmpty) return nombre;
                return Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Flexible(child: nombre),
                    for (final d in distintivos) Padding(padding: const EdgeInsets.only(left: 3), child: d),
                  ],
                );
              }(),
              const SizedBox(height: 1),
              if (neumatico != null) ...[
                if (ancha)
                  Text.rich(
                    TextSpan(children: [
                      TextSpan(text: neumatico!.marca ?? '—', style: const TextStyle(fontWeight: FontWeight.w700)),
                      if ((neumatico!.modelo ?? '').isNotEmpty)
                        TextSpan(text: ' ${neumatico!.modelo!}', style: TextStyle(fontSize: 10, color: cSuave)),
                    ]),
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, color: cTexto),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  )
                else ...[
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
                ],
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
                // En la tarjeta ancha ya van arriba, junto a la posición.
                if (!ancha && _distintivos(cTexto).isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Wrap(alignment: WrapAlignment.center, spacing: 3, children: _distintivos(cTexto)),
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
