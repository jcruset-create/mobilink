import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/etiqueta_neumatico.dart';

/// Histórico de operaciones agrupado por intervención (parte de trabajo) con
/// su informe. Al tocar una intervención se ven sus operaciones, su
/// trazabilidad y se puede abrir el PDF del parte.
///
/// DOS MODOS, UNA PANTALLA. Con [vehiculoId] enseña el histórico de ESE
/// camión, que es como se abre desde su ficha. Sin él, los últimos partes de
/// todos los vehículos que el operario puede ver, que es el histórico general
/// del menú. No son dos históricos: es el mismo, con y sin filtro. Duplicarlo
/// habría acabado con dos pantallas que enseñan lo mismo de dos maneras
/// distintas y que se corrigen por separado.
class HistorialOperacionesScreen extends StatefulWidget {
  final String? vehiculoId;
  final String matricula;
  const HistorialOperacionesScreen({super.key, this.vehiculoId, this.matricula = ''});

  @override
  State<HistorialOperacionesScreen> createState() => _HistorialOperacionesScreenState();
}

const _tipoLabels = {
  'montaje': 'Montaje', 'desmontaje': 'Desmontaje', 'sustitucion': 'Sustitución', 'rotacion': 'Rotación',
  'reparacion': 'Reparación', 'descarte': 'Descarte', 'entrada_almacen': 'Entrada almacén', 'salida_almacen': 'Salida almacén',
  'revision_vehiculo': 'Revisión', 'cambio_posicion': 'Cambio de posición', 'intercambio': 'Intercambio',
  'correccion_posicion': 'Corrección posición', 'correccion_montado': 'Corrección montado',
};

class _HistorialOperacionesScreenState extends State<HistorialOperacionesScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _intervenciones = [];
  List<Map<String, dynamic>> _sueltas = [];

  /// Solo en el histórico general.
  final _busca = TextEditingController();
  bool _soloMias = false;
  bool _pdf = false;

  bool get _general => widget.vehiculoId == null;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  @override
  void dispose() { _busca.dispose(); super.dispose(); }

  Future<void> _cargar() async {
    setState(() { _loading = true; _error = null; });
    try {
      if (_general) {
        final ivs = await TyreControlApi.listarIntervencionesRecientes(soloMias: _soloMias);
        if (!mounted) return;
        // Sin vehículo no hay operaciones sueltas que recoger: las sueltas se
        // buscan por vehículo, y aquí no hay uno.
        setState(() { _intervenciones = ivs; _sueltas = []; });
      } else {
        final res = await Future.wait([
          TyreControlApi.listarIntervencionesVehiculo(widget.vehiculoId!),
          TyreControlApi.listarOperacionesVehiculo(widget.vehiculoId!),
        ]);
        if (!mounted) return;
        final todas = res[1];
        setState(() {
          _intervenciones = res[0];
          // Movimientos que no pertenecen a ninguna intervención (p. ej. montar
          // desde catálogo sin cerrar sesión de cambio): antes no salían aquí.
          _sueltas = todas.where((o) => o['intervencion_id'] == null).toList();
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// La matrícula del camión de una intervención, cuando viene con ella (solo
  /// en el general: en la ficha ya se sabe de qué camión se está hablando).
  static String _matriculaDe(Map<String, dynamic> iv) {
    final v = iv['vehiculo'];
    return v is Map ? ((v['matricula'] as String?) ?? '') : '';
  }

  /// El filtro se aplica aquí, sobre lo ya traído. Por número de parte o por
  /// matrícula, que es lo que uno tiene a mano: el papel que acaba de dar al
  /// cliente, o el camión que tiene delante.
  List<Map<String, dynamic>> get _filtradas {
    final q = _busca.text.trim().toLowerCase();
    if (q.isEmpty) return _intervenciones;
    return _intervenciones.where((iv) {
      final texto = [
        (iv['numero'] as String?) ?? '',
        _matriculaDe(iv),
      ].join(' ').toLowerCase();
      return texto.contains(q);
    }).toList();
  }

  /// Abre el parte en PDF. El enlace lo firma el servidor y caduca en una
  /// hora: el visor del sistema no lleva la sesión, así que pedirle la ruta
  /// directamente devolvería un 401.
  /// El aviso de "generando" lo lleva quien llama (la hoja de detalle tiene su
  /// propio redibujado); aquí solo se abre.
  Future<void> _abrirPdf(String intervencionId) async {
    try {
      final u = Uri.parse(await TyreControlApi.enlacePdfParte(intervencionId));
      if (!await launchUrl(u, mode: LaunchMode.externalApplication)) {
        throw Exception('No se ha podido abrir el PDF');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('No se ha podido abrir el PDF: $e')));
      }
    }
  }

  Future<void> _verDetalle(Map<String, dynamic> iv) async {
    List<Map<String, dynamic>> ops = [];
    try { ops = await TyreControlApi.listarOperacionesDeIntervencion(iv['id'] as String); } catch (_) {}
    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => DraggableScrollableSheet(
        expand: false, initialChildSize: 0.7, maxChildSize: 0.95,
        builder: (_, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(16),
          children: [
            Text(
                iv['numero'] != null
                    ? 'Parte ${iv['numero']}'
                    : 'Intervención · ${_fecha(iv['fecha'] as String?)}',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            if (iv['numero'] != null)
              Text([
                _fecha(iv['fecha'] as String?),
                if (_matriculaDe(iv).isNotEmpty) _matriculaDe(iv),
              ].join(' · '),
                  style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
            const SizedBox(height: 10),
            // El papel que se le dio al cliente. Se puede volver a sacar en
            // cualquier momento: el PDF se regenera de los datos, no se
            // guarda una copia que se quede vieja.
            StatefulBuilder(
              builder: (_, redibuja) => OutlinedButton.icon(
                onPressed: _pdf
                    ? null
                    : () async {
                        redibuja(() => _pdf = true);
                        await _abrirPdf(iv['id'] as String);
                        redibuja(() => _pdf = false);
                      },
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: Text(_pdf ? 'Generando…' : 'Ver el PDF del parte'),
              ),
            ),
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.success.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.success.withValues(alpha: 0.3)),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('INFORME', style: TextStyle(color: AppColors.success, fontSize: 11, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(((iv['resumen_ia'] as String?)?.isNotEmpty == true ? iv['resumen_ia'] : iv['resumen']) as String? ?? '—',
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
              ]),
            ),
            ..._trazabilidad(iv),
            const SizedBox(height: 12),
            const Text('OPERACIONES', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            if (ops.isEmpty)
              const Text('Sin operaciones registradas.', style: TextStyle(color: AppColors.textHint))
            else
              ...ops.map(_filaOperacion),
          ],
        ),
      ),
    );
  }

  static List<Map<String, dynamic>> _lista(dynamic v) =>
      v is List ? v.map((e) => Map<String, dynamic>.from(e as Map)).toList() : <Map<String, dynamic>>[];

  /// Bloque de trazabilidad: avería de origen + planos Antes/Después.
  List<Widget> _trazabilidad(Map<String, dynamic> iv) {
    final incidencias = _lista(iv['incidencias']);
    final antes = _lista(iv['montaje_antes']);
    final despues = _lista(iv['montaje_despues']);
    final imagen = iv['imagen_chasis'] as String?;
    if (incidencias.isEmpty && antes.isEmpty && despues.isEmpty) return const [];

    // Posiciones cuyo neumático cambió (verde en el "después").
    final antesPorPos = {for (final a in antes) a['posicion_id']: a};
    final cambiadas = <String>{};
    for (final d in despues) {
      final a = antesPorPos[d['posicion_id']];
      if (a == null || a['marca'] != d['marca'] || a['medida'] != d['medida'] || a['mm'] != d['mm']) {
        if (d['posicion_id'] != null) cambiadas.add(d['posicion_id'] as String);
      }
    }
    return [
      const SizedBox(height: 12),
      if (incidencias.isNotEmpty) ...[
        const Text('AVERÍA DE ORIGEN', style: TextStyle(color: AppColors.danger, fontSize: 11, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        ...incidencias.map((i) {
          final averias = i['averias'] is List ? (i['averias'] as List).whereType<String>().toList() : <String>[];
          return Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Text('${i['codigo'] ?? '—'}: ${averias.join(' · ')}${i['gravedad'] != null ? ' (${i['gravedad']})' : ''}',
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13)),
          );
        }),
        const SizedBox(height: 10),
      ],
      if (antes.isNotEmpty || despues.isNotEmpty)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('ANTES', style: TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w800)),
            const SizedBox(height: 3),
            _SnapshotPlano(imagen: imagen, items: antes, conAveria: true),
          ])),
          const SizedBox(width: 8),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('DESPUÉS', style: TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w800)),
            const SizedBox(height: 3),
            _SnapshotPlano(imagen: imagen, items: despues, cambiadas: cambiadas),
          ])),
        ]),
    ];
  }

  static String _fechaHora(Map<String, dynamic> o) {
    final f = _fecha(o['fecha_operacion'] as String?);
    final ca = DateTime.tryParse('${o['created_at'] ?? ''}');
    if (ca == null) return f;
    final h = '${ca.hour.toString().padLeft(2, '0')}:${ca.minute.toString().padLeft(2, '0')}';
    return '$f · $h';
  }

  Widget _filaOperacion(Map<String, dynamic> o) {
    final tipo = _tipoLabels[o['tipo_operacion']] ?? '${o['tipo_operacion']}';
    final n = o['neumatico'];
    final neu = n is Map ? [n['marca'], n['medida']].whereType<String>().join(' ') : '';
    final pd = o['posicion_destino'], po = o['posicion_origen'];
    final pos = (pd is Map ? pd['codigo_posicion'] : null) ?? (po is Map ? po['codigo_posicion'] : null) ?? '';
    final anulada = (o['is_anulada'] as bool?) == true;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('$tipo${anulada ? ' (anulada)' : ''}',
              style: TextStyle(color: anulada ? AppColors.textHint : AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700)),
          Text([_fechaHora(o), neu, pos].where((s) => s.isNotEmpty).join(' · '),
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ])),
      ]),
    );
  }

  static String _fecha(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final d = DateTime.tryParse(iso);
    return d == null ? iso : '${d.day}/${d.month}/${d.year}';
  }

  // (_SnapshotPlano se define fuera de la clase, más abajo)

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_general
            ? 'Partes de trabajo'
            : widget.matricula.isEmpty
                ? 'Operaciones'
                : 'Operaciones · ${widget.matricula}'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
              : Column(children: [
                  if (_general) _barraBusqueda(),
                  Expanded(child: _lista_()),
                ]),
    );
  }

  Widget _barraBusqueda() => Padding(
    padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
    child: Column(children: [
      TextField(
        controller: _busca,
        decoration: InputDecoration(
          prefixIcon: const Icon(Icons.search),
          hintText: 'Nº de parte o matrícula',
          isDense: true,
          suffixIcon: _busca.text.isEmpty
              ? null
              : IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: () { _busca.clear(); setState(() {}); },
                ),
        ),
        onChanged: (_) => setState(() {}),
      ),
      const SizedBox(height: 6),
      Row(children: [
        FilterChip(
          label: const Text('Solo los míos'),
          selected: _soloMias,
          // Recarga: el filtro por técnico lo hace la consulta, no la
          // pantalla, para no traerse los de todos y esconderlos.
          onSelected: (v) { setState(() => _soloMias = v); _cargar(); },
        ),
        const Spacer(),
        Text('${_filtradas.length} parte(s)',
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
      ]),
    ]),
  );

  Widget _lista_() {
    final ivs = _filtradas;
    if (ivs.isEmpty && _sueltas.isEmpty) {
      return Center(child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
            _general
                ? (_busca.text.trim().isEmpty
                    ? 'Todavía no hay partes de trabajo.'
                    : 'Ningún parte con esa búsqueda.')
                : 'Sin operaciones registradas para este vehículo.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textHint)),
      ));
    }
    return RefreshIndicator(
                      onRefresh: _cargar,
                      child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: [
                          // Movimientos sueltos: montajes/cambios hechos fuera
                          // de una intervención cerrada. Van primero porque son
                          // los más recientes y antes no se veían.
                          if (_sueltas.isNotEmpty) ...[
                            const Text('MOVIMIENTOS SUELTOS',
                                style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800)),
                            const SizedBox(height: 6),
                            ..._sueltas.map(_filaOperacion),
                            const SizedBox(height: 16),
                          ],
                          if (ivs.isNotEmpty) ...[
                            Text(_general ? 'PARTES' : 'INTERVENCIONES',
                                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800)),
                            const SizedBox(height: 6),
                            ...ivs.map((iv) {
                              final informe = ((iv['resumen_ia'] as String?)?.isNotEmpty == true ? iv['resumen_ia'] : iv['resumen']) as String? ?? '—';
                              return Card(
                                color: AppColors.surface,
                                margin: const EdgeInsets.only(bottom: 8),
                                child: ListTile(
                                  // El número de parte va PRIMERO y destacado:
                                  // es lo que el técnico apunta en el albarán y
                                  // lo que el cliente cita por teléfono. Puede
                                  // faltar en intervenciones anteriores a la
                                  // migración que lo introdujo.
                                  title: Row(children: [
                                    if (iv['numero'] != null) ...[
                                      Text('${iv['numero']}',
                                          style: const TextStyle(
                                              fontSize: 13,
                                              fontWeight: FontWeight.w800,
                                              color: AppColors.info)),
                                      const SizedBox(width: 8),
                                    ],
                                    // En el general la MATRÍCULA es lo que
                                    // distingue una fila de otra: sin ella,
                                    // veinte partes del mismo día son veinte
                                    // líneas iguales.
                                    if (_general && _matriculaDe(iv).isNotEmpty) ...[
                                      Text(_matriculaDe(iv),
                                          style: const TextStyle(
                                              fontSize: 13, fontWeight: FontWeight.w800)),
                                      const SizedBox(width: 8),
                                    ],
                                    Expanded(
                                      child: Text('${_fecha(iv['fecha'] as String?)} · ${iv['n_operaciones'] ?? 0} operación(es)',
                                          style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                                          maxLines: 1, overflow: TextOverflow.ellipsis),
                                    ),
                                  ]),
                                  subtitle: Text(informe, style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
                                  trailing: const Icon(Icons.chevron_right, color: AppColors.textHint),
                                  onTap: () => _verDetalle(iv),
                                ),
                              );
                            }),
                          ],
                        ],
                      ),
                    );
  }
}

/// Plano de un snapshot pintado sobre la imagen real del chasis, con una
/// tarjeta por posición en sus coordenadas (%). Si no hay imagen, cae a una
/// lista compacta por posición.
class _SnapshotPlano extends StatefulWidget {
  final String? imagen;
  final List<Map<String, dynamic>> items;
  final bool conAveria;
  final Set<String> cambiadas;
  const _SnapshotPlano({this.imagen, required this.items, this.conAveria = false, this.cambiadas = const {}});

  @override
  State<_SnapshotPlano> createState() => _SnapshotPlanoState();
}

class _SnapshotPlanoState extends State<_SnapshotPlano> {
  double? _aspect;
  ImageStream? _stream;
  ImageStreamListener? _listener;

  @override
  void initState() {
    super.initState();
    final url = widget.imagen;
    if (url != null && url.isNotEmpty) _resolver(url);
  }

  @override
  void dispose() {
    if (_stream != null && _listener != null) _stream!.removeListener(_listener!);
    super.dispose();
  }

  void _resolver(String url) {
    final img = NetworkImage(url);
    _stream = img.resolve(ImageConfiguration.empty);
    _listener = ImageStreamListener((info, _) {
      final w = info.image.width.toDouble(), h = info.image.height.toDouble();
      if (h > 0 && mounted) setState(() => _aspect = w / h);
    }, onError: (_, __) { if (mounted) setState(() => _aspect = 0.62); });
    _stream!.addListener(_listener!);
  }

  Color _borde(Map<String, dynamic> s) {
    final averia = widget.conAveria && s['averias'] is List && (s['averias'] as List).isNotEmpty;
    if (averia) return AppColors.danger;
    if (widget.cambiadas.contains(s['posicion_id'])) return AppColors.success;
    return AppColors.cardBorder;
  }

  Widget _tarjeta(Map<String, dynamic> s, double w, double h) {
    final x = (s['x'] as num?)?.toDouble() ?? 0;
    final y = (s['y'] as num?)?.toDouble() ?? 0;
    final cw = (s['w'] as num?)?.toDouble() ?? 16;
    final cardW = (cw / 100 * w).clamp(58.0, 150.0);
    final borde = _borde(s);
    final marca = s['marca'] as String?;
    final mm = s['mm'];
    final presion = s['presion'];
    final distintivos = [
      if (s['recau'] == true) 'RECAUCH.',
      if (s['reesc'] == true) 'REESC.',
      if (s['girado'] == true) 'GIRADO',
    ];
    final averias = s['averias'] is List ? (s['averias'] as List).whereType<String>().toList() : const <String>[];
    // Mismo color que el informe de flota y que el resto de planos de la app:
    // manda la banda de profundidad. Sin mm conocidos, el recuadro oscuro de
    // siempre. El borde sigue diciendo lo suyo: rojo avería, verde cambiada.
    final mmNum = mm is num ? mm.toDouble() : double.tryParse('$mm');
    final banda = (marca != null && mmNum != null) ? bandaProfundidad(mmNum) : null;
    final cTexto = banda?.tinta ?? AppColors.textPrimary;
    final cSuave = banda != null ? cTexto.withValues(alpha: 0.72) : AppColors.textSecondary;
    return Positioned(
      left: (x / 100 * w).clamp(0.0, w - cardW),
      top: (y / 100 * h).clamp(0.0, h - 24),
      width: cardW,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 2),
        decoration: BoxDecoration(
          color: banda?.fondo ?? AppColors.surface.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: borde, width: 1.5),
        ),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(s['codigo']?.toString() ?? '—',
              style: TextStyle(
                  fontSize: 7,
                  fontWeight: FontWeight.w700,
                  // Sobre un recuadro claro, el borde rojo/verde como tinta no
                  // se lee: manda la tinta de la banda.
                  color: banda != null ? cTexto : borde),
              maxLines: 1, overflow: TextOverflow.ellipsis),
          Text(marca ?? 'Libre', style: TextStyle(fontSize: 8, fontWeight: FontWeight.w600, color: cTexto), maxLines: 1, overflow: TextOverflow.ellipsis),
          if (marca != null)
            Text('${mm != null ? '$mm mm' : '— mm'} · ${presion != null ? '$presion bar' : '— bar'}',
                style: TextStyle(fontSize: 7, color: cSuave), maxLines: 1, overflow: TextOverflow.ellipsis),
          // Mismas etiquetas que en los otros planos: REESC. relleno de naranja
          // brillante, el resto en contorno.
          if (marca != null && distintivos.isNotEmpty)
            Wrap(spacing: 2, runSpacing: 2, children: [
              for (final d in distintivos)
                EtiquetaNeu(
                  txt: d,
                  color: cTexto,
                  fontSize: 6.5,
                  fondo: d == 'REESC.'
                      ? AppColors.reesculturado
                      : (d == 'NEW' ? AppColors.tireNuevo : null),
                ),
            ]),
          if (widget.conAveria && averias.isNotEmpty)
            Text('⚠ ${averias.join(' · ')}',
                style: TextStyle(
                    fontSize: 7,
                    fontWeight: FontWeight.w700,
                    // El rojo de siempre se pierde sobre la banda roja o la
                    // verde oscura; ahí manda la tinta legible de la banda.
                    color: banda != null ? cTexto : AppColors.danger),
                maxLines: 2, overflow: TextOverflow.ellipsis),
        ]),
      ),
    );
  }

  Widget _listaFallback() {
    if (widget.items.isEmpty) {
      return const Text('No se guardó el estado previo (intervención anterior a esta función).',
          style: TextStyle(fontSize: 11, color: AppColors.textHint));
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final s in widget.items)
        Padding(
          padding: const EdgeInsets.only(bottom: 2),
          child: Builder(builder: (_) {
            final dist = [
              if (s['recau'] == true) 'RECAUCH.',
              if (s['reesc'] == true) 'REESC.',
              if (s['girado'] == true) 'GIRADO',
            ].join(' · ');
            final averias = widget.conAveria && s['averias'] is List
                ? (s['averias'] as List).join(' · ')
                : '';
            return Text(
              '${s['codigo'] ?? '—'}: ${s['marca'] ?? 'Libre'}${s['medida'] != null ? ' ${s['medida']}' : ''}'
              '${s['mm'] != null ? ' · ${s['mm']} mm' : ''}'
              '${s['presion'] != null ? ' · ${s['presion']} bar' : ''}'
              '${dist.isNotEmpty ? '  $dist' : ''}'
              '${averias.isNotEmpty ? '  ⚠ $averias' : ''}',
              style: TextStyle(
                fontSize: 11,
                color: _borde(s) == AppColors.cardBorder ? AppColors.textSecondary : _borde(s),
              ),
            );
          }),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final url = widget.imagen;
    // Sin posiciones no tiene sentido pintar el chasis vacío: mejor el aviso.
    if (widget.items.isEmpty) return _listaFallback();
    if (url == null || url.isEmpty || _aspect == null) return _listaFallback();
    return LayoutBuilder(builder: (ctx, c) {
      final w = c.maxWidth;
      final h = w / _aspect!;
      return SizedBox(
        width: w, height: h,
        child: Stack(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(url, width: w, height: h, fit: BoxFit.fill,
                errorBuilder: (_, __, ___) => Container(color: AppColors.surfaceVariant)),
          ),
          for (final s in widget.items) _tarjeta(s, w, h),
        ]),
      );
    });
  }
}
