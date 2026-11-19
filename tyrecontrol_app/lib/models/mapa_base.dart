// Mapa de una base: qué autobuses se pintan y cómo se agrupan los que se
// pisan. Sin Flutter y sin la librería del mapa, para poder probarlo.
import 'dart:math' as math;

import 'presencia_vista.dart';

/// Un autobús en el mapa de su base.
class PinDeMapa {
  final VehiculoPresencia v;
  final RevisionEstado rev;

  /// La posición es de hace más de una hora, o el servidor ya la da por
  /// antigua: puede haberse movido. Se pinta con el borde discontinuo.
  final bool vieja;

  const PinDeMapa({required this.v, required this.rev, required this.vieja});

  double get lat => v.lat!;
  double get lng => v.lng!;
}

/// Los autobuses de [baseId] que van al mapa: los que tienen la revisión
/// pendiente y una posición que sirva.
///
/// Entran los que están dentro con posición reciente y también los de
/// «posición antigua» de esa base: su último punto cae dentro y lo más
/// probable es que sigan ahí, y en un mapa —al contrario que en la lista— se
/// puede enseñar la duda en el propio dibujo. Los que circulan fuera no
/// entran: el mapa es del patio.
///
/// Van ordenados como la lista: primero el que más falta hace.
List<PinDeMapa> pinesDeLaBase(
  String baseId,
  List<VehiculoPresencia> vehiculos,
  Map<String, RevisionEstado> revisiones,
) {
  final out = <PinDeMapa>[];
  for (final v in vehiculos) {
    if (v.delegacionId != baseId) continue;
    if (v.estado != enBase && v.estado != posicionAntigua) continue;
    final rev = revisiones[v.vehiculoId];
    if (rev == null || !tieneRevisionPendiente(rev)) continue;
    if (!posicionUtil(v.lat, v.lng)) continue;
    out.add(PinDeMapa(
      v: v,
      rev: rev,
      vieja: v.estado == posicionAntigua || posicionVieja(v.antiguedadMin),
    ));
  }
  out.sort((a, b) {
    final p = prioridadRevision(a.rev.estado).compareTo(prioridadRevision(b.rev.estado));
    if (p != 0) return p;
    return (b.rev.diasVencido ?? 0).compareTo(a.rev.diasVencido ?? 0);
  });
  return out;
}

/// Cuántos pines hay de cada estado de revisión, para la leyenda.
Map<String, int> cuentaPorEstado(List<PinDeMapa> pines) {
  final m = <String, int>{};
  for (final p in pines) {
    m[p.rev.estado] = (m[p.rev.estado] ?? 0) + 1;
  }
  return m;
}

/// Uno o varios autobuses que en pantalla caen en el mismo sitio.
class GrupoDePines {
  final List<PinDeMapa> pines;
  final double lat;
  final double lng;

  const GrupoDePines({required this.pines, required this.lat, required this.lng});

  bool get esUno => pines.length == 1;

  /// Cuántas matrículas de un grupo se leen en el propio mapa. Más alta, la
  /// etiqueta taparía medio patio.
  static const maxALaVista = 3;

  /// Las matrículas que se enseñan apiladas: las más urgentes, que para eso
  /// llegan ordenadas.
  List<PinDeMapa> get aLaVista => pines.take(maxALaVista).toList();

  /// Las que no caben en la etiqueta y van detrás de «+N más».
  int get ocultos => pines.length > maxALaVista ? pines.length - maxALaVista : 0;

  /// El estado más urgente del grupo: es el color del círculo.
  String get estadoMasUrgente => pines
      .map((p) => p.rev.estado)
      .reduce((a, b) => prioridadRevision(a) <= prioridadRevision(b) ? a : b);
}

/// Posición en píxeles del mapa del mundo a ese zoom (Web Mercator, mosaicos
/// de 256 px): es en lo que mide la pantalla, y lo que decide si dos
/// etiquetas se pisan.
math.Point<double> _pixel(double lat, double lng, double zoom) {
  final escala = 256.0 * math.pow(2.0, zoom);
  final x = (lng + 180.0) / 360.0 * escala;
  final latAcotada = lat.clamp(-85.05112878, 85.05112878);
  final s = math.sin(latAcotada * math.pi / 180.0);
  final y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * escala;
  return math.Point(x, y);
}

/// Junta los pines que a ese [zoom] quedarían a menos de [separacionPx] en
/// pantalla. Dos autobuses aparcados uno al lado del otro están a tres metros:
/// con el mapa alejado sus matrículas se taparían y no se leería ninguna.
///
/// Cada pin se une al primer grupo que tenga lo bastante cerca; como llegan
/// ordenados por urgencia, el grupo se forma alrededor del que más falta hace.
/// Al acercar el mapa los grupos se deshacen solos. Desde [zoomMaximo] ya no
/// se agrupa; el mapa de la base no lo usa (pasa infinito), porque dos
/// autobuses lado a lado están más cerca que el margen del GPS y ni al máximo
/// se separan: ahí el grupo enseña sus matrículas apiladas.
List<GrupoDePines> agruparPines(
  List<PinDeMapa> pines,
  double zoom, {
  double separacionPx = 56,
  double zoomMaximo = 19,
}) {
  if (zoom >= zoomMaximo) {
    return [for (final p in pines) GrupoDePines(pines: [p], lat: p.lat, lng: p.lng)];
  }
  final grupos = <List<PinDeMapa>>[];
  final anclas = <math.Point<double>>[];
  for (final p in pines) {
    final px = _pixel(p.lat, p.lng, zoom);
    var puesto = false;
    for (var i = 0; i < anclas.length; i++) {
      if (anclas[i].distanceTo(px) < separacionPx) {
        grupos[i].add(p);
        puesto = true;
        break;
      }
    }
    if (!puesto) {
      grupos.add([p]);
      anclas.add(px);
    }
  }
  return [
    for (final g in grupos)
      GrupoDePines(
        pines: g,
        lat: g.map((p) => p.lat).reduce((a, b) => a + b) / g.length,
        lng: g.map((p) => p.lng).reduce((a, b) => a + b) / g.length,
      ),
  ];
}
