// ─────────────────────────────────────────────────────────────────────────────
// MISMO FICHERO en flutter_app, lite_app, taller_app y tyrecontrol_app
// (lib/widgets/aviso_actualizacion.dart). Si se cambia en una, se copia a las
// otras tres: así todas las apps avisan igual.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

/// El servidor de Mobilink. `/api/apps/list` es lo mismo que lee la página
/// de descargas: la versión que hay en `main` de cada app.
const _servidor = 'https://sea-tarragona.onrender.com';

/// Compara dos versiones «1.2.7+278». Negativo si [a] es más vieja que [b],
/// cero si son la misma, positivo si es más nueva.
///
/// El número de build (lo de detrás del «+») solo cuenta cuando los nombres
/// coinciden, las dos lo traen y [conBuild] es true. En iPhone no se usa: el
/// build de TestFlight se numera por su cuenta y puede ir por delante del del
/// repositorio, y eso no es una versión más nueva.
int compararVersiones(String a, String b, {bool conBuild = true}) {
  List<int> nombre(String v) =>
      v.split('+').first.split('.').map((p) => int.tryParse(p.trim()) ?? 0).toList();
  int? build(String v) => v.contains('+') ? int.tryParse(v.split('+')[1].trim()) : null;

  final na = nombre(a), nb = nombre(b);
  for (var i = 0; i < na.length || i < nb.length; i++) {
    final x = i < na.length ? na[i] : 0;
    final y = i < nb.length ? nb[i] : 0;
    if (x != y) return x - y;
  }
  if (!conBuild) return 0;
  final ba = build(a), bb = build(b);
  if (ba == null || bb == null) return 0;
  return ba - bb;
}

/// Franja arriba de todas las pantallas cuando hay una versión más nueva que
/// la instalada: «Hay una versión nueva (1.2.8)» con el botón para ponerla.
///
/// - **Android:** descarga la APK de la página de descargas.
/// - **iPhone:** abre TestFlight. Solo sale una hora después de ver la versión
///   por primera vez: el repositorio la tiene en cuanto se mergea, pero
///   Codemagic y Apple tardan entre 30 y 50 minutos en dejarla en TestFlight,
///   y mandar al técnico a buscar algo que aún no está es peor que no avisar.
///
/// Se comprueba al abrir la app y al volver a ella, como mucho una vez cada
/// 30 minutos. Sin red, o si el servidor falla, no sale nada: un aviso de
/// actualización nunca puede estorbar al trabajo.
///
/// «Más tarde» la esconde hasta la próxima vez que se abra la app.
///
/// Va en `MaterialApp.builder`, por encima del navegador, para que salga esté
/// donde esté el técnico.
class AvisoActualizacion extends StatefulWidget {
  const AvisoActualizacion({
    super.key,
    required this.app,
    required this.child,
    this.versionInstalada,
    this.ultimaVersion,
    this.esIos,
    this.abrir,
  });

  /// La clave de la app en `/api/apps/list`: assist, assist-lite, taller,
  /// tyrecontrol.
  final String app;
  final Widget child;

  // Para las pruebas. En la app, los de verdad.
  final Future<String?> Function()? versionInstalada;
  final Future<String?> Function()? ultimaVersion;
  final bool? esIos;
  final Future<void> Function(Uri)? abrir;

  @override
  State<AvisoActualizacion> createState() => _AvisoActualizacionState();
}

class _AvisoActualizacionState extends State<AvisoActualizacion> with WidgetsBindingObserver {
  static const _cadaCuanto = Duration(minutes: 30);
  static const _esperaIos = Duration(hours: 1);

  String? _nueva;
  String? _descartada;
  DateTime? _ultimaComprobacion;

  bool get _ios => widget.esIos ?? (!kIsWeb && Platform.isIOS);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _comprobar();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _comprobar();
  }

  Future<String?> _instalada() async {
    if (widget.versionInstalada != null) return widget.versionInstalada!();
    final info = await PackageInfo.fromPlatform();
    return '${info.version}+${info.buildNumber}';
  }

  Future<String?> _ultima() async {
    if (widget.ultimaVersion != null) return widget.ultimaVersion!();
    final res = await http
        .get(Uri.parse('$_servidor/api/apps/list'))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) return null;
    final lista = jsonDecode(res.body);
    if (lista is! List) return null;
    for (final a in lista) {
      if (a is Map && a['key'] == widget.app) {
        final v = a['version'];
        return v is String && v.isNotEmpty ? v : null;
      }
    }
    return null;
  }

  /// En iPhone, ¿hace ya una hora que se vio esta versión por primera vez?
  Future<bool> _yaEnTestFlight(String version) async {
    final p = await SharedPreferences.getInstance();
    final clave = 'aviso_actualizacion_visto_$version';
    final visto = p.getInt(clave);
    final ahora = DateTime.now().millisecondsSinceEpoch;
    if (visto == null) {
      await p.setInt(clave, ahora);
      return false;
    }
    return ahora - visto >= _esperaIos.inMilliseconds;
  }

  Future<void> _comprobar() async {
    final ahora = DateTime.now();
    final ultima = _ultimaComprobacion;
    if (ultima != null && ahora.difference(ultima) < _cadaCuanto) return;
    _ultimaComprobacion = ahora;
    try {
      final instalada = await _instalada();
      final disponible = await _ultima();
      if (instalada == null || disponible == null) return;
      var hay = compararVersiones(disponible, instalada, conBuild: !_ios) > 0;
      if (hay && _ios) hay = await _yaEnTestFlight(disponible);
      if (!mounted) return;
      setState(() => _nueva = hay ? disponible : null);
    } catch (e) {
      debugPrint('[aviso_actualizacion] $e');
    }
  }

  Future<void> _actualizar() async {
    final enlace = _ios ? Uri.parse('itms-beta://') : Uri.parse('$_servidor/apps/${widget.app}');
    try {
      if (widget.abrir != null) {
        await widget.abrir!(enlace);
      } else {
        await launchUrl(enlace, mode: LaunchMode.externalApplication);
      }
    } catch (e) {
      debugPrint('[aviso_actualizacion] no se pudo abrir $enlace: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final nueva = _nueva;
    if (nueva == null || nueva == _descartada) return widget.child;
    final cs = Theme.of(context).colorScheme;
    final nombre = nueva.split('+').first;
    return Column(
      children: [
        Material(
          key: const Key('aviso-actualizacion'),
          color: cs.primary,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 4, 6),
              child: Row(
                children: [
                  Icon(Icons.system_update, color: cs.onPrimary, size: 22),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _ios
                          ? 'Hay una versión nueva ($nombre) en TestFlight'
                          : 'Hay una versión nueva ($nombre)',
                      style: TextStyle(color: cs.onPrimary, fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                  ),
                  TextButton(
                    key: const Key('aviso-actualizacion-mas-tarde'),
                    onPressed: () => setState(() => _descartada = nueva),
                    style: TextButton.styleFrom(foregroundColor: cs.onPrimary),
                    child: const Text('Más tarde'),
                  ),
                  FilledButton(
                    key: const Key('aviso-actualizacion-actualizar'),
                    onPressed: _actualizar,
                    style: FilledButton.styleFrom(
                      backgroundColor: cs.onPrimary,
                      foregroundColor: cs.primary,
                      visualDensity: VisualDensity.compact,
                    ),
                    child: Text(_ios ? 'Abrir TestFlight' : 'Descargar'),
                  ),
                ],
              ),
            ),
          ),
        ),
        // La franja ya ocupa el hueco de la barra de estado: la pantalla de
        // debajo no tiene que volver a dejarlo.
        Expanded(
          child: MediaQuery.removePadding(context: context, removeTop: true, child: widget.child),
        ),
      ],
    );
  }
}
