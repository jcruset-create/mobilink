import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/tipo_llanta.dart';
import '../services/alta_vehiculo.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'inventario_inicial_screen.dart';

/// Alta en la tablet, pasos 3 y 4: el uso del vehículo y sus ejes.
///
/// Viene después de crear el vehículo (matrícula comprobada por foto, nº de
/// unidad, km y tipo) y antes de las ruedas. Sigue la maqueta aprobada:
///
///   3. Uso — botones grandes: larga distancia, regional, urbano…
///   4. Ejes — el plano con un lápiz en cada eje que abre «Configurar eje»:
///      medida, llanta, presión objetivo y si es direccional, motriz o
///      elevable. Si todos llevan la misma medida sale una vez arriba; si no,
///      encima de cada eje.
///
/// Al continuar se guarda todo de una vez (`tc_alta_configurar_vehiculo`) y se
/// pasa al inventario de ruedas, que ya sabe la medida de cada eje.
class AltaEjesScreen extends StatefulWidget {
  final String vehiculoId;
  final String matricula;
  final String tipoVehiculoId;

  const AltaEjesScreen({
    super.key,
    required this.vehiculoId,
    required this.matricula,
    required this.tipoVehiculoId,
  });

  @override
  State<AltaEjesScreen> createState() => _AltaEjesScreenState();
}

class _AltaEjesScreenState extends State<AltaEjesScreen> {
  bool _enUso = true;
  String? _uso;
  List<EjeAlta> _ejes = const [];
  List<Map<String, dynamic>> _medidas = const [];
  List<Map<String, dynamic>> _llantas = const [];
  List<Map<String, dynamic>> _favoritos = const [];
  bool _cargando = true;
  bool _guardando = false;
  String? _error;

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
        TyreControlApi.listarMedidasVehiculo(),
        TyreControlApi.tiposLlantaParaAlta(),
        TyreControlApi.obtenerVehiculo(widget.vehiculoId),
      ]);
      final posiciones = r[0] as List;
      final v = r[3];
      final empresa = (v as dynamic)?.empresaId as String?;
      final favoritos = empresa == null
          ? const <Map<String, dynamic>>[]
          : await TyreControlApi.referenciasFavoritas(empresa);
      if (!mounted) return;
      setState(() {
        _ejes = ejesDesdePosiciones(posiciones.map((p) => (p as dynamic).eje as int?));
        _medidas = (r[1] as List).cast<Map<String, dynamic>>();
        _llantas = (r[2] as List).cast<Map<String, dynamic>>();
        _favoritos = favoritos;
        _cargando = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _cargando = false; });
    }
  }

  String? _valorMedida(String? id) =>
      id == null ? null : _medidas.where((m) => m['id'] == id).map((m) => m['valor'] as String?).firstOrNull;

  String? _nombreLlanta(String? id) =>
      id == null ? null : _llantas.where((l) => l['id'] == id).map(nombreTipoLlanta).firstOrNull;

  /// Las medidas que más se montan en la flota, para ofrecerlas primero.
  List<Map<String, dynamic>> get _medidasFavoritas {
    final vistas = <String>{};
    final out = <Map<String, dynamic>>[];
    for (final f in _favoritos) {
      final k = claveMedida(f['medida'] as String?);
      if (k.isEmpty || vistas.contains(k)) continue;
      final m = _medidas.where((x) => claveMedida(x['valor'] as String?) == k).firstOrNull;
      if (m == null) continue;
      vistas.add(k);
      out.add(m);
      if (out.length >= 6) break;
    }
    return out;
  }

  Future<void> _configurar(EjeAlta eje) async {
    final hecho = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _ConfigurarEje(
        eje: eje,
        totalEjes: _ejes.length,
        medidas: _medidas,
        medidasFavoritas: _medidasFavoritas,
        llantas: _llantas,
        onAplicarATodos: () => aplicarATodos(_ejes, eje),
      ),
    );
    if (hecho == true && mounted) setState(() {});
  }

  Future<void> _guardar() async {
    setState(() { _guardando = true; _error = null; });
    try {
      await TyreControlApi.configurarVehiculoAlta(
        vehiculoId: widget.vehiculoId,
        uso: _uso,
        ejes: [for (final e in _ejes) e.toJson()],
      );
      if (!mounted) return;
      final terminado = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => InventarioInicialScreen(
          vehiculoId: widget.vehiculoId,
          matricula: widget.matricula,
          tipoVehiculoId: widget.tipoVehiculoId,
        ),
      ));
      if (mounted) Navigator.of(context).pop(terminado ?? false);
    } catch (e) {
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final paso = _enUso ? 3 : 4;
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Alta de vehículo · ${widget.matricula}'),
          Text(_enUso ? 'Paso 3 de 5 · uso' : 'Paso 4 de 5 · ejes',
              style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        ]),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(value: paso / 5, minHeight: 4),
        ),
      ),
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
                Expanded(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 680),
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(20),
                        child: _enUso ? _pasoUso() : _pasoEjes(),
                      ),
                    ),
                  ),
                ),
                _barra(),
              ]),
      ),
    );
  }

  Widget _pasoUso() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('¿Para qué se usa?', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
      const SizedBox(height: 6),
      const Text('Sirve para comparar el desgaste con vehículos que trabajan igual.',
          style: TextStyle(color: AppColors.textSecondary)),
      const SizedBox(height: 16),
      for (final u in usosVehiculo) ...[
        _BotonGrande(
          titulo: u.nombre,
          detalle: u.detalle,
          elegido: _uso == u.clave,
          onTap: () => setState(() => _uso = u.clave),
        ),
        const SizedBox(height: 10),
      ],
      _BotonGrande(
        titulo: 'No lo sé ahora',
        detalle: 'Lo completa oficina',
        elegido: false,
        apagado: true,
        onTap: () => setState(() { _uso = null; _enUso = false; }),
      ),
    ]);
  }

  Widget _pasoEjes() {
    final comun = _valorMedida(medidaComun(_ejes));
    final sinMedida = _ejes.where((e) => e.medidaId == null).length;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (comun != null)
        Column(children: [
          Text(comun, style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: AppColors.textPrimary)),
          const Text('MEDIDA DE TODOS LOS EJES',
              style: TextStyle(fontSize: 11, letterSpacing: 1.2, color: AppColors.textSecondary)),
          const SizedBox(height: 14),
        ])
      else
        const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: Text('Toca el lápiz de cada eje para poner su medida, llanta y presión.',
              textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
        ),
      const Text('DELANTE', textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.textHint, fontSize: 11, letterSpacing: 1.5)),
      const SizedBox(height: 10),
      for (final e in _ejes) ...[
        _FilaEje(
          eje: e,
          medida: comun == null ? _valorMedida(e.medidaId) : null,
          llanta: _nombreLlanta(e.llantaId),
          onEditar: () => _configurar(e),
        ),
        const SizedBox(height: 12),
      ],
      const Text('DETRÁS', textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.textHint, fontSize: 11, letterSpacing: 1.5)),
      const SizedBox(height: 16),
      if (sinMedida > 0)
        Text(
          sinMedida == _ejes.length
              ? 'Sin medida, las ruedas se buscan en todo el catálogo. Puedes seguir y ponerla después.'
              : '$sinMedida ${sinMedida == 1 ? 'eje sin medida' : 'ejes sin medida'}: se puede seguir igual.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
        ),
    ]);
  }

  Widget _barra() {
    Widget boton(String t, VoidCallback? a, {bool principal = false}) => Expanded(
          flex: principal ? 2 : 1,
          child: SizedBox(
            height: 56,
            child: principal
                ? FilledButton(onPressed: a, child: Text(t, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)))
                : OutlinedButton(onPressed: a, child: Text(t, style: const TextStyle(fontSize: 16))),
          ),
        );
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.cardBorder)),
      ),
      child: Row(children: _enUso
          ? [
              boton('Continuar', _uso == null ? null : () => setState(() => _enUso = false), principal: true),
            ]
          : [
              boton('Anterior', _guardando ? null : () => setState(() => _enUso = true)),
              const SizedBox(width: 12),
              boton(_guardando ? 'Guardando…' : 'Guardar ejes y apuntar ruedas', _guardando ? null : _guardar,
                  principal: true),
            ]),
    );
  }
}

class _BotonGrande extends StatelessWidget {
  final String titulo;
  final String detalle;
  final bool elegido;
  final bool apagado;
  final VoidCallback onTap;
  const _BotonGrande({required this.titulo, required this.detalle, required this.elegido, required this.onTap, this.apagado = false});

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
          decoration: BoxDecoration(
            color: elegido ? AppColors.success.withValues(alpha: 0.15) : AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: elegido ? AppColors.success : AppColors.cardBorder, width: elegido ? 2 : 1),
          ),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(titulo, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                    color: apagado ? AppColors.textSecondary : AppColors.textPrimary)),
                Text(detalle, style: const TextStyle(color: AppColors.textSecondary)),
              ]),
            ),
            if (elegido) const Icon(Icons.check_circle, color: AppColors.success, size: 28),
          ]),
        ),
      );
}

/// Un eje del plano: sus ruedas en gris y el lápiz en medio.
class _FilaEje extends StatelessWidget {
  final EjeAlta eje;
  final String? medida;
  final String? llanta;
  final VoidCallback onEditar;
  const _FilaEje({required this.eje, required this.medida, required this.llanta, required this.onEditar});

  @override
  Widget build(BuildContext context) {
    Widget rueda() => Container(
          width: 26, height: 54,
          margin: const EdgeInsets.symmetric(horizontal: 2),
          decoration: BoxDecoration(color: AppColors.tirePendiente, borderRadius: BorderRadius.circular(6)),
        );
    final lado = eje.dobles ? 2 : 1;
    final marcas = [
      if (eje.directriz) 'Direccional',
      if (eje.motriz) 'Motriz',
      if (eje.elevable) 'Elevable',
      if (eje.presionBar != null) '${eje.presionBar!.toStringAsFixed(1)} bar',
    ];
    return Column(children: [
      if (medida != null)
        Text(medida!, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Color(0xFFCFE0FF))),
      Row(children: [
        for (var i = 0; i < lado; i++) rueda(),
        Expanded(
          child: Column(children: [
            Container(height: 4, color: AppColors.cardBorder),
          ]),
        ),
        const SizedBox(width: 6),
        FilledButton.icon(
          onPressed: onEditar,
          icon: const Icon(Icons.edit, size: 18),
          label: Text('Eje ${eje.eje}'),
        ),
        const SizedBox(width: 6),
        Expanded(child: Container(height: 4, color: AppColors.cardBorder)),
        for (var i = 0; i < lado; i++) rueda(),
      ]),
      const SizedBox(height: 4),
      Text(
        [
          eje.dobles ? 'Ruedas dobles' : 'Ruedas simples',
          ...marcas,
          if (llanta != null) llanta!,
        ].join(' · '),
        textAlign: TextAlign.center,
        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
      ),
    ]);
  }
}

/// «Configurar eje»: medida, llanta, presión objetivo y los interruptores.
class _ConfigurarEje extends StatefulWidget {
  final EjeAlta eje;
  final int totalEjes;
  final List<Map<String, dynamic>> medidas;
  final List<Map<String, dynamic>> medidasFavoritas;
  final List<Map<String, dynamic>> llantas;
  final VoidCallback onAplicarATodos;

  const _ConfigurarEje({
    required this.eje,
    required this.totalEjes,
    required this.medidas,
    required this.medidasFavoritas,
    required this.llantas,
    required this.onAplicarATodos,
  });

  @override
  State<_ConfigurarEje> createState() => _ConfigurarEjeState();
}

class _ConfigurarEjeState extends State<_ConfigurarEje> {
  final _buscar = TextEditingController();
  late final _presion = TextEditingController(
      text: widget.eje.presionBar == null ? '' : widget.eje.presionBar!.toStringAsFixed(1));
  bool _aTodos = false;

  EjeAlta get e => widget.eje;

  @override
  void dispose() {
    _buscar.dispose();
    _presion.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _resultados {
    final q = _buscar.text.trim();
    if (q.isEmpty) return const [];
    return widget.medidas.where((m) => coincideMedida(m['valor'] as String?, q)).take(12).toList();
  }

  void _listo() {
    e.presionBar = double.tryParse(_presion.text.trim().replaceAll(',', '.'));
    if (_aTodos) widget.onAplicarATodos();
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    Widget chipMedida(Map<String, dynamic> m) => ChoiceChip(
          label: Text(m['valor'] as String? ?? ''),
          selected: e.medidaId == m['id'],
          onSelected: (_) => setState(() { e.medidaId = m['id'] as String; _buscar.clear(); }),
        );
    final elegida = widget.medidas.where((m) => m['id'] == e.medidaId).firstOrNull;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Configurar eje ${e.eje}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            Text(e.dobles ? 'Ruedas dobles (lo dice el tipo de vehículo)' : 'Ruedas simples (lo dice el tipo de vehículo)',
                style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 16),
            const Text('Medida', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (elegida != null && !widget.medidasFavoritas.any((m) => m['id'] == elegida['id'])) chipMedida(elegida),
              for (final m in widget.medidasFavoritas) chipMedida(m),
              ChoiceChip(
                label: const Text('No lo sé ahora'),
                selected: e.medidaId == null,
                onSelected: (_) => setState(() => e.medidaId = null),
              ),
            ]),
            const SizedBox(height: 8),
            TextField(
              controller: _buscar,
              onChanged: (_) => setState(() {}),
              keyboardType: TextInputType.visiblePassword,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Otra medida: escribe 29580, 315/70…',
              ),
            ),
            if (_resultados.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [for (final m in _resultados) chipMedida(m)]),
            ],
            const SizedBox(height: 18),
            const Text('Llanta', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final l in widget.llantas)
                ChoiceChip(
                  label: Text(nombreTipoLlanta(l)),
                  selected: e.llantaId == l['id'],
                  onSelected: (_) => setState(() => e.llantaId = l['id'] as String),
                ),
              ChoiceChip(
                label: const Text('No lo sé ahora'),
                selected: e.llantaId == null,
                onSelected: (_) => setState(() => e.llantaId = null),
              ),
            ]),
            const SizedBox(height: 18),
            TextField(
              controller: _presion,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
              decoration: const InputDecoration(
                labelText: 'Presión objetivo (opcional)',
                suffixText: 'bar',
                helperText: 'Sin ella se usa la del tipo de vehículo, si la tiene.',
              ),
            ),
            const SizedBox(height: 10),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Direccional'),
              value: e.directriz,
              onChanged: (v) => setState(() => e.directriz = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Motriz'),
              value: e.motriz,
              onChanged: (v) => setState(() => e.motriz = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Elevable'),
              value: e.elevable,
              onChanged: (v) => setState(() => e.elevable = v),
            ),
            if (widget.totalEjes > 1)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text('Misma medida, llanta y presión en todos los ejes'),
                value: _aTodos,
                onChanged: (v) => setState(() => _aTodos = v ?? false),
              ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 54,
              child: FilledButton(onPressed: _listo, child: const Text('Listo', style: TextStyle(fontSize: 16))),
            ),
          ]),
        ),
      ),
    );
  }
}
