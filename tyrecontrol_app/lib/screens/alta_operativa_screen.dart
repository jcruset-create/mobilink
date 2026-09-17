import 'package:flutter/material.dart';

import '../models/configuracion_ejes.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'inventario_inicial_screen.dart';

/// El alta operativa de un vehículo, paso a paso.
///
/// Mismo patrón que el parte guiado (`realizar_operacion_screen.dart`): una
/// decisión por pantalla, barra de progreso arriba y los botones Anterior y
/// Continuar siempre abajo, donde el pulgar los alcanza sin soltar la tablet.
///
/// ── Por qué el tipo y la configuración son dos pasos y no uno ───────────────
///
/// Porque son dos preguntas distintas para quien está delante del camión:
/// «¿qué es esto?» y «¿cuántas ruedas lleva?». En la base son una sola cosa
/// —las posiciones cuelgan del TIPO, y el tipo ya trae su configuración—, así
/// que el segundo paso no vuelve a preguntar: enseña lo que va a quedar y pide
/// confirmación. Un plano mal elegido se arrastra a todos los vehículos que
/// comparten ese tipo, así que verlo antes de guardar no es un lujo.
class AltaOperativaScreen extends StatefulWidget {
  final String vehiculoId;
  final String matricula;
  /// El tipo que ya tuviera, para saltarse los pasos ya hechos al reanudar.
  final String? tipoIdActual;

  const AltaOperativaScreen({
    super.key,
    required this.vehiculoId,
    required this.matricula,
    this.tipoIdActual,
  });

  @override
  State<AltaOperativaScreen> createState() => _AltaOperativaScreenState();
}

enum _Paso { vehiculo, tipo, configuracion }

const _titulos = <_Paso, String>{
  _Paso.vehiculo: 'El vehículo',
  _Paso.tipo: '¿Qué vehículo es?',
  _Paso.configuracion: 'Sus ruedas',
};

class _AltaOperativaScreenState extends State<AltaOperativaScreen> {
  _Paso _paso = _Paso.vehiculo;
  Map<String, dynamic>? _vehiculo;
  List<Map<String, dynamic>> _tipos = const [];
  String? _tipoId;
  bool _cargando = true;
  bool _guardando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tipoId = widget.tipoIdActual;
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { _cargando = true; _error = null; });
    try {
      final r = await Future.wait([
        TyreControlApi.obtenerVehiculoCompleto(widget.vehiculoId),
        // Ya viene filtrado a los tipos que TIENEN plano: ofrecer uno sin
        // posiciones sería ofrecer un callejón sin salida.
        TyreControlApi.tiposVehiculoParaAlta(),
      ]);
      if (!mounted) return;
      setState(() {
        _vehiculo = r[0] as Map<String, dynamic>?;
        _tipos = (r[1] as List).cast<Map<String, dynamic>>();
        _cargando = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _cargando = false; });
    }
  }

  Map<String, dynamic>? get _tipoElegido {
    final t = _tipos.where((t) => t['id'] == _tipoId);
    return t.isEmpty ? null : t.first;
  }

  ConfiguracionEjes get _config =>
      ConfiguracionEjes.desdeTexto(_tipoElegido?['configuracion_ejes'] as String?);

  bool get _puedeSeguir {
    switch (_paso) {
      case _Paso.vehiculo:
        return _vehiculo != null;
      case _Paso.tipo:
        return _tipoId != null;
      case _Paso.configuracion:
        return _config.esValida && !_guardando;
    }
  }

  void _siguiente() {
    if (_paso == _Paso.configuracion) { _guardarConfiguracion(); return; }
    final i = _Paso.values.indexOf(_paso);
    setState(() => _paso = _Paso.values[i + 1]);
  }

  void _anterior() {
    final i = _Paso.values.indexOf(_paso);
    if (i > 0) setState(() => _paso = _Paso.values[i - 1]);
  }

  /// Guarda el tipo y sigue. El técnico NO vuelve al menú: lo que viene
  /// después es el inventario, y mandarlo a la lista para que vuelva a entrar
  /// es hacerle perder el hilo delante del camión.
  Future<void> _guardarConfiguracion() async {
    setState(() { _guardando = true; _error = null; });
    try {
      await TyreControlApi.ponerTipoDeAlta(vehiculoId: widget.vehiculoId, tipoId: _tipoId!);
      if (!mounted) return;
      // Directo al inventario, sin pasar por el menú: el técnico está delante
      // del camión y mandarlo a la lista para que vuelva a entrar es lo que
      // hace que se queden inventarios a medias.
      final terminado = await Navigator.of(context).pushReplacement<bool, void>(
        MaterialPageRoute(
          builder: (_) => InventarioInicialScreen(
            vehiculoId: widget.vehiculoId,
            matricula: widget.matricula,
            tipoVehiculoId: _tipoId!,
          ),
        ),
      );
      if (mounted) Navigator.of(context).pop(terminado ?? true);
    } catch (e) {
      // El mensaje de la base ya está escrito para una persona («este vehículo
      // ya tiene 2 neumático(s) montado(s)…»), así que se enseña tal cual en
      // vez de traducirlo, que es donde se pierden los matices.
      if (mounted) setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final actual = _Paso.values.indexOf(_paso) + 1;
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.matricula} · ${_titulos[_paso]}'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(value: actual / _Paso.values.length, minHeight: 4),
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
                Expanded(child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20), child: _cuerpo())),
                _barraInferior(),
              ]),
      ),
    );
  }

  Widget _cuerpo() {
    switch (_paso) {
      case _Paso.vehiculo:
        return _pasoVehiculo();
      case _Paso.tipo:
        return _pasoTipo();
      case _Paso.configuracion:
        return _pasoConfiguracion();
    }
  }

  // ── Paso 1: confirmar de qué camión hablamos ───────────────────────────────
  /// Solo se enseña; no se edita. La matrícula y el cliente vienen del vehículo
  /// pendiente y corregirlos es cosa de oficina: cambiar una matrícula desde el
  /// patio puede pisar otro vehículo que ya exista con ella.
  Widget _pasoVehiculo() {
    final v = _vehiculo ?? const {};
    final empresa = (v['empresa'] as Map?)?['nombre'] as String?;
    final tipo = (v['tipo'] as Map?);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(widget.matricula,
          style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
      const SizedBox(height: 6),
      Text(empresa ?? 'Sin cliente', style: const TextStyle(fontSize: 18, color: AppColors.textSecondary)),
      if (v['numero_unidad'] != null) ...[
        const SizedBox(height: 4),
        Text('Unidad ${v['numero_unidad']}', style: const TextStyle(color: AppColors.textSecondary)),
      ],
      const SizedBox(height: 24),
      if (tipo != null)
        _Aviso(
          icono: Icons.info_outline,
          texto: 'Ya tiene tipo: ${tipo['descripcion'] ?? tipo['nombre']}. '
              'Puedes confirmarlo o cambiarlo si no es el correcto.',
        )
      else
        const _Aviso(
          icono: Icons.help_outline,
          texto: 'Este vehículo todavía no tiene tipo, así que no tiene plano ni '
              'posiciones donde apuntar las gomas. Es lo que vamos a poner ahora.',
        ),
      const SizedBox(height: 20),
      const Text('Si la matrícula o el cliente no son los de este camión, avisa a oficina: '
          'desde aquí no se cambian.',
          style: TextStyle(color: AppColors.textHint, fontSize: 13)),
    ]);
  }

  // ── Paso 2: qué vehículo es ────────────────────────────────────────────────
  Widget _pasoTipo() {
    if (_tipos.isEmpty) {
      return const _Aviso(
        icono: Icons.warning_amber,
        texto: 'No hay ningún tipo de vehículo con plano. Tiene que crearlos oficina '
            'antes de poder dar de alta este camión.',
      );
    }
    return Column(children: [
      for (final t in _tipos) ...[
        _TarjetaTipo(
          tipo: t,
          elegido: t['id'] == _tipoId,
          onTap: () => setState(() => _tipoId = t['id'] as String?),
        ),
        const SizedBox(height: 12),
      ],
    ]);
  }

  // ── Paso 3: ver lo que va a quedar ─────────────────────────────────────────
  Widget _pasoConfiguracion() {
    final c = _config;
    final t = _tipoElegido ?? const {};
    if (!c.esValida) {
      return _Aviso(
        icono: Icons.warning_amber,
        texto: 'La configuración de este tipo ("${t['configuracion_ejes'] ?? '—'}") no se '
            'entiende, así que no se puede dibujar su plano. Avisa a oficina.',
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(t['descripcion'] as String? ?? t['nombre'] as String? ?? '',
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
      const SizedBox(height: 4),
      Text(c.resumen, style: const TextStyle(fontSize: 16, color: AppColors.textSecondary)),
      const SizedBox(height: 20),
      _Esquema(config: c),
      const SizedBox(height: 20),
      _Aviso(
        icono: Icons.info_outline,
        texto: 'Se guardará el tipo del vehículo. Las posiciones ya existen: son de este '
            'tipo y las comparten todos los camiones iguales, así que no se crea ni se '
            'duplica ninguna.',
      ),
    ]);
  }

  Widget _barraInferior() {
    final ultimo = _paso == _Paso.configuracion;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.cardBorder)),
        ),
        child: Row(children: [
          if (_paso != _Paso.vehiculo)
            Expanded(
              child: SizedBox(
                height: 56,
                child: OutlinedButton(onPressed: _guardando ? null : _anterior,
                    child: const Text('Anterior', style: TextStyle(fontSize: 16))),
              ),
            ),
          if (_paso != _Paso.vehiculo) const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: SizedBox(
              height: 56,
              child: FilledButton(
                onPressed: _puedeSeguir ? _siguiente : null,
                child: Text(
                  _guardando ? 'Guardando…' : (ultimo ? 'Guardar configuración y continuar' : 'Continuar'),
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Una tarjeta de tipo: grande, con lo justo para reconocerlo de un vistazo.
class _TarjetaTipo extends StatelessWidget {
  final Map<String, dynamic> tipo;
  final bool elegido;
  final VoidCallback onTap;
  const _TarjetaTipo({required this.tipo, required this.elegido, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = ConfiguracionEjes.desdeTexto(tipo['configuracion_ejes'] as String?);
    final imagen = tipo['imagen_chasis_url'] as String?;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: elegido ? AppColors.primary.withValues(alpha: 0.12) : AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: elegido ? AppColors.primary : AppColors.cardBorder, width: elegido ? 2 : 1),
        ),
        child: Row(children: [
          if (imagen != null && imagen.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 14),
              child: Image.network(imagen, width: 84, height: 48, fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const SizedBox(width: 84, height: 48)),
            ),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tipo['descripcion'] as String? ?? tipo['nombre'] as String? ?? '',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
              const SizedBox(height: 4),
              Text(c.esValida ? c.resumen : (tipo['configuracion_ejes'] as String? ?? '—'),
                  style: const TextStyle(color: AppColors.textSecondary)),
            ]),
          ),
          if (elegido) const Icon(Icons.check_circle, color: AppColors.primary, size: 28),
        ]),
      ),
    );
  }
}

/// El dibujo del camión: un eje por fila, de delante a atrás.
///
/// No pretende ser el plano final —ese lo pinta `vehicle_schema` con las
/// coordenadas reales de cada posición— sino contestar de un vistazo «¿es este
/// el camión que tengo delante?» antes de guardar.
class _Esquema extends StatelessWidget {
  final ConfiguracionEjes config;
  const _Esquema({required this.config});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(children: [
        const Text('DELANTE', style: TextStyle(color: AppColors.textHint, fontSize: 11, letterSpacing: 1.5)),
        const SizedBox(height: 12),
        for (var eje = 1; eje <= config.numeroEjes; eje++) ...[
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            SizedBox(
              width: 54,
              child: Text('Eje $eje', textAlign: TextAlign.right,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ),
            const SizedBox(width: 12),
            ..._ruedas(config.ejeGemelo(eje)),
          ]),
          const SizedBox(height: 14),
        ],
        const Text('DETRÁS', style: TextStyle(color: AppColors.textHint, fontSize: 11, letterSpacing: 1.5)),
      ]),
    );
  }

  /// Un eje sencillo son dos ruedas; uno gemelo, cuatro: dos por lado.
  List<Widget> _ruedas(bool gemelo) {
    Widget rueda() => Container(
          width: 20, height: 34,
          margin: const EdgeInsets.symmetric(horizontal: 2),
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: AppColors.cardBorder),
          ),
        );
    return [
      rueda(), if (gemelo) rueda(),
      Container(width: 90, height: 12, color: AppColors.cardBorder), // el chasis
      if (gemelo) rueda(), rueda(),
    ];
  }
}

class _Aviso extends StatelessWidget {
  final IconData icono;
  final String texto;
  const _Aviso({required this.icono, required this.texto});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icono, size: 20, color: AppColors.textSecondary),
        const SizedBox(width: 10),
        Expanded(child: Text(texto, style: const TextStyle(color: AppColors.textSecondary, height: 1.4))),
      ]),
    );
  }
}
