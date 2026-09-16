import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/km_telematica.dart';

/// Inventario inicial de neumáticos: apuntar las gomas que YA ESTÁN puestas.
///
/// No es un montaje comercial. Las ruedas llevaban ahí desde antes de que este
/// camión entrara en TyreControl, así que esto no vende, no compra, no mueve
/// almacén y no genera trabajo facturable: reconoce lo que hay. Eso lo
/// garantiza la base (`tc_inventario_inicial_posicion`), no esta pantalla.
///
/// Una posición por vez, y al guardar salta sola a la siguiente pendiente: de
/// pie junto al camión, volver a la lista entre rueda y rueda es lo que hace
/// que se abandonen los inventarios a medias.
class InventarioInicialScreen extends StatefulWidget {
  final String vehiculoId;
  final String matricula;
  final String tipoVehiculoId;

  const InventarioInicialScreen({
    super.key,
    required this.vehiculoId,
    required this.matricula,
    required this.tipoVehiculoId,
  });

  @override
  State<InventarioInicialScreen> createState() => _InventarioInicialScreenState();
}

/// Lo que se sabe de una posición mientras dura el inventario.
class _Estado {
  final String? neumaticoId;
  final double? profundidad;
  final double? presion;
  final bool presionMedida;
  const _Estado({this.neumaticoId, this.profundidad, this.presion, this.presionMedida = false});
  bool get hecha => neumaticoId != null && profundidad != null;
}

class _InventarioInicialScreenState extends State<InventarioInicialScreen> {
  List<Map<String, dynamic>> _posiciones = const [];
  List<Map<String, dynamic>> _catalogo = const [];
  final Map<String, _Estado> _estado = {};
  double? _minimoMm;
  bool _cargando = true;
  String? _error;
  /// La última referencia usada, para poder copiarla a la siguiente rueda.
  Map<String, dynamic>? _ultimaReferencia;
  /// Los km que se guardarán con la revisión inicial, y de dónde salieron.
  num? _km;
  String _origenKm = 'manual';

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { _cargando = true; _error = null; });
    try {
      final r = await Future.wait([
        TyreControlApi.listarPosiciones(widget.tipoVehiculoId),
        TyreControlApi.listarCatalogoReferencias(),
        TyreControlApi.listarMontajesVehiculo(widget.vehiculoId),
        TyreControlApi.ultimasMedicionesPorPosicion(widget.vehiculoId),
      ]);
      if (!mounted) return;
      final posiciones = (r[0] as List)
          .map((p) => {'id': p.id, 'codigo': p.codigoPosicion, 'eje': p.eje, 'lado': p.lado,
                       'interior': p.interiorExterior})
          .toList();
      final montajes = r[2] as List;
      final medidas = r[3] as Map;
      _estado.clear();
      for (final m in montajes) {
        final pid = (m as dynamic).posicionId as String?;
        if (pid == null) continue;
        final med = medidas[pid];
        _estado[pid] = _Estado(
          neumaticoId: (m as dynamic).neumaticoId as String?,
          profundidad: med == null ? null : (med as dynamic).profundidadMm as double?,
          presion: med == null ? null : (med as dynamic).presionBar as double?,
          presionMedida: med != null && (med as dynamic).presionBar != null,
        );
      }
      setState(() {
        _posiciones = posiciones.cast<Map<String, dynamic>>();
        _catalogo = (r[1] as List).cast<Map<String, dynamic>>();
        _cargando = false;
      });
      _cargarUmbral();
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _cargando = false; });
    }
  }

  /// El mínimo de profundidad configurado para esta empresa. Se usa solo para
  /// AVISAR, no para impedir: una goma por debajo del mínimo existe y hay que
  /// poder apuntarla, que justamente para eso se mide.
  Future<void> _cargarUmbral() async {
    try {
      final v = await TyreControlApi.obtenerVehiculo(widget.vehiculoId);
      final empresa = v?.empresaId;
      if (empresa == null) return;
      final u = await TyreControlApi.umbralesDeEmpresa(empresa);
      if (mounted) setState(() => _minimoMm = u.empresa?.minimaMm);
    } catch (_) { /* sin umbral se avisa menos, no se rompe nada */ }
  }

  int get _hechas => _posiciones.where((p) => (_estado[p['id']] ?? const _Estado()).hecha).length;
  int get _total => _posiciones.length;

  Map<String, dynamic>? get _siguientePendiente {
    for (final p in _posiciones) {
      if (!(_estado[p['id']] ?? const _Estado()).hecha) return p;
    }
    return null;
  }

  Future<void> _abrir(Map<String, dynamic> posicion) async {
    final guardado = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => _FichaPosicion(
        vehiculoId: widget.vehiculoId,
        posicion: posicion,
        catalogo: _catalogo,
        minimoMm: _minimoMm,
        referenciaSugerida: _ultimaReferencia,
        yaInformada: (_estado[posicion['id']] ?? const _Estado()).hecha,
        onReferenciaUsada: (ref) => _ultimaReferencia = ref,
      ),
    ));
    if (guardado != true) return;
    await _cargar();
    if (!mounted) return;
    // Saltar sola a la siguiente: es lo que evita los inventarios a medias.
    final siguiente = _siguientePendiente;
    if (siguiente != null) _abrir(siguiente);
  }

  Future<void> _finalizar() async {
    try {
      await TyreControlApi.finalizarInventarioInicial(
        vehiculoId: widget.vehiculoId, km: _km, origenKm: _origenKm);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Alta terminada'),
          content: Text('${widget.matricula} ya se puede revisar y operar con normalidad.'),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Listo'))],
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      // El mensaje de la base ya dice QUÉ posiciones faltan, por su código.
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    }
  }

  @override
  Widget build(BuildContext context) {
    final completo = _total > 0 && _hechas == _total;
    return Scaffold(
      appBar: AppBar(title: Text('${widget.matricula} · Inventario inicial')),
      body: SafeArea(
        child: _cargando
            ? const Center(child: CircularProgressIndicator())
            : Column(children: [
                if (_error != null)
                  Container(
                    width: double.infinity,
                    color: AppColors.danger.withValues(alpha: 0.15),
                    padding: const EdgeInsets.all(14),
                    child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: Column(children: [
                    Text('$_hechas de $_total neumáticos informados',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary)),
                    const SizedBox(height: 10),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(5),
                      child: LinearProgressIndicator(
                        value: _total == 0 ? 0 : _hechas / _total,
                        minHeight: 10,
                        backgroundColor: AppColors.surfaceVariant,
                      ),
                    ),
                  ]),
                ),
                Expanded(child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: _rejilla(),
                )),
                _barraInferior(completo),
              ]),
      ),
    );
  }

  /// Las posiciones agrupadas por eje, de delante a atrás. En los ejes gemelos
  /// se ve cuál es la interior y cuál la exterior: montar la goma buena en la
  /// rueda equivocada es un error que después nadie encuentra.
  Widget _rejilla() {
    final ejes = <int, List<Map<String, dynamic>>>{};
    for (final p in _posiciones) {
      ejes.putIfAbsent((p['eje'] as int?) ?? 0, () => []).add(p);
    }
    final numeros = ejes.keys.toList()..sort();
    return Column(children: [
      const Text('DELANTE', style: TextStyle(color: AppColors.textHint, fontSize: 11, letterSpacing: 1.5)),
      const SizedBox(height: 10),
      for (final n in numeros) ...[
        Row(children: [
          SizedBox(width: 46, child: Text('Eje $n',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
          Expanded(
            child: Wrap(spacing: 10, runSpacing: 10, children: [
              for (final p in ejes[n]!) _Casilla(
                posicion: p,
                estado: _estado[p['id']] ?? const _Estado(),
                minimoMm: _minimoMm,
                onTap: () => _abrir(p),
              ),
            ]),
          ),
        ]),
        const SizedBox(height: 14),
      ],
      const Text('DETRÁS', style: TextStyle(color: AppColors.textHint, fontSize: 11, letterSpacing: 1.5)),
      const SizedBox(height: 16),
      const _Leyenda(),
      const SizedBox(height: 20),
      // Los km de la revisión inicial. Se consultan solos a la telemática; si
      // no hay, el técnico los teclea. No impiden terminar el alta: un camión
      // sin telemática y sin nadie que mire el cuadro se puede inventariar
      // igual, y sus gomas se siguen midiendo.
      KmTelematica(
        vehiculoId: widget.vehiculoId,
        matricula: widget.matricula,
        onConfirmado: (km, origen) => setState(() { _km = km; _origenKm = origen; }),
      ),
    ]);
  }

  Widget _barraInferior(bool completo) {
    final siguiente = _siguientePendiente;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.cardBorder)),
        ),
        child: SizedBox(
          height: 56,
          width: double.infinity,
          child: completo
              ? FilledButton(
                  onPressed: _finalizar,
                  child: const Text('Finalizar alta y revisión inicial',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)))
              : FilledButton(
                  onPressed: siguiente == null ? null : () => _abrir(siguiente),
                  child: Text('Informar ${siguiente?['codigo'] ?? ''}',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
        ),
      ),
    );
  }
}

/// Una rueda en el esquema. El color dice de un vistazo lo que le pasa.
class _Casilla extends StatelessWidget {
  final Map<String, dynamic> posicion;
  final _Estado estado;
  final double? minimoMm;
  final VoidCallback onTap;
  const _Casilla({required this.posicion, required this.estado, required this.minimoMm, required this.onTap});

  @override
  Widget build(BuildContext context) {
    // Gris pendiente · verde hecha · rojo medición por debajo del mínimo
    // configurado · amarillo hecha pero sin presión, que es información que
    // falta sin ser un problema.
    final bajoMinimo = estado.profundidad != null && minimoMm != null && estado.profundidad! <= minimoMm!;
    final color = !estado.hecha
        ? AppColors.surfaceVariant
        : bajoMinimo
            ? AppColors.danger
            : estado.presionMedida
                ? AppColors.success
                : AppColors.warning;
    final tinta = estado.hecha ? AppColors.onPrimary : AppColors.textSecondary;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 96, height: 76,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(posicion['codigo'] as String? ?? '',
              style: TextStyle(fontWeight: FontWeight.w800, color: tinta, fontSize: 13)),
          const SizedBox(height: 2),
          Text(
            estado.profundidad != null ? '${estado.profundidad} mm' : 'sin informar',
            style: TextStyle(color: tinta, fontSize: 12),
          ),
          if (estado.hecha && !estado.presionMedida)
            Text('sin presión', style: TextStyle(color: tinta, fontSize: 10)),
        ]),
      ),
    );
  }
}

class _Leyenda extends StatelessWidget {
  const _Leyenda();

  @override
  Widget build(BuildContext context) {
    Widget punto(Color c, String t) => Row(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 12, height: 12, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3))),
          const SizedBox(width: 6),
          Text(t, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ]);
    return Wrap(spacing: 16, runSpacing: 8, children: [
      punto(AppColors.surfaceVariant, 'Sin informar'),
      punto(AppColors.success, 'Completa'),
      punto(AppColors.warning, 'Sin presión'),
      punto(AppColors.danger, 'Bajo el mínimo'),
    ]);
  }
}

/// La ficha de una rueda: lo mínimo para dejarla apuntada.
class _FichaPosicion extends StatefulWidget {
  final String vehiculoId;
  final Map<String, dynamic> posicion;
  final List<Map<String, dynamic>> catalogo;
  final double? minimoMm;
  final Map<String, dynamic>? referenciaSugerida;
  final bool yaInformada;
  final void Function(Map<String, dynamic>) onReferenciaUsada;

  const _FichaPosicion({
    required this.vehiculoId,
    required this.posicion,
    required this.catalogo,
    required this.minimoMm,
    required this.referenciaSugerida,
    required this.yaInformada,
    required this.onReferenciaUsada,
  });

  @override
  State<_FichaPosicion> createState() => _FichaPosicionState();
}

class _FichaPosicionState extends State<_FichaPosicion> {
  Map<String, dynamic>? _referencia;
  final _busqueda = TextEditingController();
  final _profundidad = TextEditingController();
  final _presion = TextEditingController();
  final _serie = TextEditingController();
  final _dot = TextEditingController();
  final _observaciones = TextEditingController();
  /// null hasta que el técnico elija. Obligar a decidir es la única forma de
  /// que «no medida» signifique eso y no «se me olvidó».
  bool? _presionMedida;
  bool _guardando = false;
  String? _error;

  @override
  void dispose() {
    _busqueda.dispose(); _profundidad.dispose(); _presion.dispose();
    _serie.dispose(); _dot.dispose(); _observaciones.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _resultados {
    final q = _busqueda.text.trim().toLowerCase();
    if (q.isEmpty) return const [];
    return widget.catalogo.where((r) {
      final t = '${r['marca'] ?? ''} ${r['modelo'] ?? ''} ${r['medida'] ?? ''}'.toLowerCase();
      return t.contains(q);
    }).take(30).toList();
  }

  bool get _puedeGuardar {
    final p = double.tryParse(_profundidad.text.trim().replaceAll(',', '.'));
    if (_referencia == null || p == null || _guardando) return false;
    if (_presionMedida == null) return false;
    if (_presionMedida == true && double.tryParse(_presion.text.trim().replaceAll(',', '.')) == null) return false;
    return true;
  }

  Future<void> _guardar() async {
    setState(() { _guardando = true; _error = null; });
    try {
      await TyreControlApi.guardarPosicionInventario(
        vehiculoId: widget.vehiculoId,
        posicionId: widget.posicion['id'] as String,
        referenciaId: _referencia!['id'] as String,
        profundidadMm: double.parse(_profundidad.text.trim().replaceAll(',', '.')),
        // Aquí está la regla: si no se midió va null, no cero.
        presionBar: _presionMedida == true
            ? double.parse(_presion.text.trim().replaceAll(',', '.'))
            : null,
        numeroSerie: _serie.text,
        dot: _dot.text,
        observaciones: _observaciones.text,
      );
      widget.onReferenciaUsada(_referencia!);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = double.tryParse(_profundidad.text.trim().replaceAll(',', '.'));
    final avisoMinimo = p != null && widget.minimoMm != null && p <= widget.minimoMm!;
    return Scaffold(
      appBar: AppBar(title: Text('Rueda ${widget.posicion['codigo']}')),
      body: SafeArea(
        child: Column(children: [
          if (_error != null)
            Container(
              width: double.infinity,
              color: AppColors.danger.withValues(alpha: 0.15),
              padding: const EdgeInsets.all(14),
              child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
            ),
          Expanded(child: ListView(padding: const EdgeInsets.all(20), children: [
            if (widget.yaInformada)
              const _Nota('Esta rueda ya estaba informada. Lo que guardes ahora corrige la '
                  'medición; no monta otra goma.'),

            // ── El neumático ───────────────────────────────────────────────
            const Text('El neumático', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
                color: AppColors.textPrimary)),
            const SizedBox(height: 8),
            if (_referencia != null)
              _Elegido(referencia: _referencia!, onQuitar: () => setState(() => _referencia = null))
            else ...[
              if (widget.referenciaSugerida != null) ...[
                OutlinedButton.icon(
                  onPressed: () => setState(() => _referencia = widget.referenciaSugerida),
                  icon: const Icon(Icons.content_copy, size: 18),
                  // Se copia SOLO la referencia. El número interno, la serie,
                  // el DOT, la profundidad y la presión son de cada goma y no
                  // se heredan: dos ruedas del mismo modelo no son la misma.
                  label: Text('Misma que la anterior: '
                      '${widget.referenciaSugerida!['marca']} ${widget.referenciaSugerida!['modelo']}'),
                ),
                const SizedBox(height: 10),
              ],
              TextField(
                controller: _busqueda,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Buscar marca, modelo o medida',
                ),
              ),
              const SizedBox(height: 8),
              for (final r in _resultados)
                ListTile(
                  title: Text('${r['marca']} ${r['modelo']}',
                      style: const TextStyle(color: AppColors.textPrimary)),
                  subtitle: Text('${r['medida']}',
                      style: const TextStyle(color: AppColors.textSecondary)),
                  onTap: () => setState(() { _referencia = r; _busqueda.clear(); }),
                ),
              if (_busqueda.text.trim().isNotEmpty && _resultados.isEmpty)
                const _Nota('No está en el catálogo. Avisa a oficina para que lo den de alta; '
                    'mientras tanto elige el modelo más parecido y déjalo en observaciones.'),
            ],

            const SizedBox(height: 20),
            // ── La medida ──────────────────────────────────────────────────
            const Text('Profundidad', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
                color: AppColors.textPrimary)),
            const SizedBox(height: 8),
            TextField(
              controller: _profundidad,
              onChanged: (_) => setState(() {}),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
              decoration: const InputDecoration(labelText: 'Milímetros', suffixText: 'mm'),
            ),
            if (avisoMinimo)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                // Avisa, no impide: una goma por debajo del mínimo existe y hay
                // que poder apuntarla. Para eso se mide.
                child: Text('Por debajo del mínimo de la empresa (${widget.minimoMm} mm). '
                    'Se puede guardar igual; quedará marcada.',
                    style: const TextStyle(color: AppColors.warning, fontSize: 13)),
              ),

            const SizedBox(height: 20),
            // ── La presión ─────────────────────────────────────────────────
            const Text('Presión', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
                color: AppColors.textPrimary)),
            const SizedBox(height: 4),
            const Text('Solo si la has medido. No pasa nada por no medirla.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: _Opcion(
                texto: 'No medida',
                elegida: _presionMedida == false,
                onTap: () => setState(() { _presionMedida = false; _presion.clear(); }),
              )),
              const SizedBox(width: 10),
              Expanded(child: _Opcion(
                texto: 'Presión medida',
                elegida: _presionMedida == true,
                onTap: () => setState(() => _presionMedida = true),
              )),
            ]),
            if (_presionMedida == true) ...[
              const SizedBox(height: 10),
              TextField(
                controller: _presion,
                onChanged: (_) => setState(() {}),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                decoration: const InputDecoration(labelText: 'Presión', suffixText: 'bar'),
              ),
            ],

            const SizedBox(height: 20),
            // ── Lo que solo a veces se ve ──────────────────────────────────
            const Text('Si se ven', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
                color: AppColors.textPrimary)),
            const SizedBox(height: 4),
            const Text('El número de serie y el DOT no siempre están legibles. '
                'Si no los ves, sigue: la goma se identifica por su número interno.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 10),
            TextField(controller: _serie,
                decoration: const InputDecoration(labelText: 'Número de serie (opcional)')),
            const SizedBox(height: 10),
            TextField(controller: _dot, keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'DOT (opcional)', hintText: 'p. ej. 1422')),
            const SizedBox(height: 10),
            TextField(controller: _observaciones, maxLines: 2,
                decoration: const InputDecoration(labelText: 'Observaciones (opcional)')),
            const SizedBox(height: 20),
          ])),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              decoration: const BoxDecoration(
                color: AppColors.surface,
                border: Border(top: BorderSide(color: AppColors.cardBorder)),
              ),
              child: SizedBox(
                height: 56, width: double.infinity,
                child: FilledButton(
                  onPressed: _puedeGuardar ? _guardar : null,
                  child: Text(_guardando ? 'Guardando…' : 'Guardar y siguiente rueda',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _Elegido extends StatelessWidget {
  final Map<String, dynamic> referencia;
  final VoidCallback onQuitar;
  const _Elegido({required this.referencia, required this.onQuitar});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.primary),
        ),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${referencia['marca']} ${referencia['modelo']}',
                style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
            Text('${referencia['medida']}',
                style: const TextStyle(color: AppColors.textSecondary)),
          ])),
          IconButton(onPressed: onQuitar, icon: const Icon(Icons.close)),
        ]),
      );
}

class _Opcion extends StatelessWidget {
  final String texto;
  final bool elegida;
  final VoidCallback onTap;
  const _Opcion({required this.texto, required this.elegida, required this.onTap});

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          height: 56,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: elegida ? AppColors.primary.withValues(alpha: 0.15) : AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: elegida ? AppColors.primary : AppColors.cardBorder,
                width: elegida ? 2 : 1),
          ),
          child: Text(texto, style: TextStyle(
              fontWeight: FontWeight.w700,
              color: elegida ? AppColors.primary : AppColors.textSecondary)),
        ),
      );
}

class _Nota extends StatelessWidget {
  final String texto;
  const _Nota(this.texto);

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(texto, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
      );
}
