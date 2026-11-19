import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/models.dart';
import '../services/matricula.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'alta_ejes_screen.dart';
import 'alta_operativa_screen.dart' show TarjetaTipoVehiculo;

/// Qué devuelve esta pantalla a «Nueva revisión».
sealed class SalidaAltaDesdeRevision {
  const SalidaAltaDesdeRevision();
}

/// La matrícula no era la del camión, o tenía dudas: hay que repetir la foto.
class RepetirFoto extends SalidaAltaDesdeRevision {
  const RepetirFoto();
}

/// Era un vehículo que ya estaba (una parecida, o en otra flota del técnico):
/// se sigue la revisión con él.
class UsarVehiculo extends SalidaAltaDesdeRevision {
  final Vehiculo vehiculo;
  const UsarVehiculo(this.vehiculo);
}

/// El alta ha terminado (con su inventario inicial): de vuelta a Inicio.
class AltaTerminada extends SalidaAltaDesdeRevision {
  const AltaTerminada();
}

/// Alta de un vehículo desde «Nueva revisión», cuando la matrícula no está.
///
/// El orden es el de la maqueta aprobada por Jordi:
///
///   1. ¿Es esta matrícula? — la foto y lo leído, con formato y dudas. No hay
///      teclado: si está mal, se repite la foto.
///   2. Comprobación — en todas las flotas del técnico, también las de baja,
///      y las que cambian en un carácter. Así no se duplica un camión.
///   3. ¿Darlo de alta? — y en qué flota, si ve más de una.
///   4. El vehículo — matrícula fijada, nº de unidad y km.
///   5. Qué vehículo es — el tipo, del que cuelgan las posiciones.
///
/// Con eso se crea (`tc_alta_vehiculo_desde_parte`, pendiente de validar) y
/// sigue en [AltaEjesScreen]: el uso, los ejes y después las ruedas
/// (inventario inicial), que quedan como su primera revisión.
class AltaDesdeRevisionScreen extends StatefulWidget {
  final String matricula;
  final List<int> dudososIa;
  final Uint8List? fotoBytes;
  final String? fotoPath;
  /// Escrita a mano tras varias fotos fallidas: no se pregunta «¿es esta?» y
  /// el vehículo nace marcado para que oficina la revise.
  final bool tecleada;

  const AltaDesdeRevisionScreen({
    super.key,
    required this.matricula,
    this.dudososIa = const [],
    this.fotoBytes,
    this.fotoPath,
    this.tecleada = false,
  });

  @override
  State<AltaDesdeRevisionScreen> createState() => _AltaDesdeRevisionScreenState();
}

enum _Fase { confirmar, comprobando, comprobacion, pregunta, vehiculo, tipo }

class _AltaDesdeRevisionScreenState extends State<AltaDesdeRevisionScreen> {
  late final JuicioMatricula _juicio =
      JuicioMatricula.de(widget.matricula, dudososIa: widget.dudososIa);
  late _Fase _fase = widget.tecleada ? _Fase.comprobando : _Fase.confirmar;

  Map<String, dynamic>? _comprobacion;
  List<Map<String, dynamic>> _empresas = const [];
  List<Map<String, dynamic>> _tipos = const [];
  String? _empresaId;
  String? _tipoId;
  final _unidad = TextEditingController();
  final _km = TextEditingController();
  bool _sinKm = false;
  bool _trabajando = false;
  String? _error;

  String get _mat => _juicio.matricula;

  @override
  void initState() {
    super.initState();
    if (_fase == _Fase.comprobando) _comprobar();
  }

  @override
  void dispose() {
    _unidad.dispose();
    _km.dispose();
    super.dispose();
  }

  // ── Lógica ────────────────────────────────────────────────────────────────

  Future<void> _comprobar() async {
    setState(() { _fase = _Fase.comprobando; _error = null; });
    try {
      final r = await Future.wait([
        TyreControlApi.comprobarMatricula(_mat),
        TyreControlApi.empresasDelOperario(),
        TyreControlApi.tiposVehiculoParaAlta(),
      ]);
      if (!mounted) return;
      final c = r[0] as Map<String, dynamic>;
      _empresas = (r[1] as List).cast<Map<String, dynamic>>();
      _tipos = (r[2] as List).cast<Map<String, dynamic>>();
      final activa = TyreControlApi.empresaActivaId;
      _empresaId = _empresas.any((e) => e['id'] == activa)
          ? activa
          : (_empresas.length == 1 ? _empresas.first['id'] as String : null);
      setState(() {
        _comprobacion = c;
        // Sin nada que enseñar se pasa directo a la pregunta.
        _fase = _hayAlgoQueEnsenar(c) ? _Fase.comprobacion : _Fase.pregunta;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _fase = _Fase.comprobacion;
          _error = 'No se ha podido comprobar la matrícula: ${_limpio(e)}';
        });
      }
    }
  }

  List<Map<String, dynamic>> _lista(String clave) =>
      [for (final x in (_comprobacion?[clave] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];

  bool _hayAlgoQueEnsenar(Map<String, dynamic> c) =>
      (c['exactas'] as List? ?? const []).isNotEmpty ||
      (c['parecidas'] as List? ?? const []).isNotEmpty ||
      c['en_flota_no_visible'] == true;

  /// Si está de baja o en una flota que no ve, NO se da de alta: decide oficina.
  String? get _bloqueo {
    final c = _comprobacion;
    if (c == null) return null;
    final exactas = _lista('exactas');
    final deBaja = exactas.where((v) => v['activo'] != true).toList();
    if (deBaja.isNotEmpty && exactas.every((v) => v['activo'] != true)) {
      return '$_mat está dada de baja en ${deBaja.first['empresa'] ?? 'una flota'}. '
          'No se da de alta otra vez: avisa a oficina para que la reactive.';
    }
    if (c['en_flota_no_visible'] == true && exactas.isEmpty) {
      return '$_mat ya está dada de alta en una flota que no ves. '
          'No se da de alta otra vez: avisa a oficina.';
    }
    return null;
  }

  Future<void> _usar(Map<String, dynamic> v) async {
    setState(() => _trabajando = true);
    try {
      final veh = await TyreControlApi.obtenerVehiculo(v['vehiculo_id'] as String);
      if (!mounted) return;
      if (veh == null) {
        setState(() => _error = 'No se ha podido abrir ese vehículo');
        return;
      }
      Navigator.of(context).pop(UsarVehiculo(veh));
    } catch (e) {
      if (mounted) setState(() => _error = _limpio(e));
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  num? get _kmLeidos => num.tryParse(_km.text.replaceAll('.', '').replaceAll(',', '.').trim());

  bool get _puedeSeguir => switch (_fase) {
        _Fase.pregunta => _empresaId != null,
        _Fase.vehiculo => _sinKm || (_kmLeidos != null && _kmLeidos! >= 0),
        _Fase.tipo => _tipoId != null && !_trabajando,
        _ => false,
      };

  Future<void> _crear() async {
    setState(() { _trabajando = true; _error = null; });
    try {
      final r = await TyreControlApi.altaVehiculoDesdeParte(
        empresaId: _empresaId!,
        matricula: _mat,
        tipoVehiculoId: _tipoId!,
        numeroUnidad: _unidad.text.trim().isEmpty ? null : _unidad.text.trim(),
        km: _sinKm ? null : _kmLeidos,
        fotoMatricula: widget.fotoPath,
        matriculaTecleada: widget.tecleada,
      );
      final id = r['vehiculo_id'] as String?;
      if (id == null) throw Exception('El servidor no ha devuelto el vehículo');
      if (!mounted) return;
      if (r['ya_existia'] == true) {
        // Otro técnico lo ha dado de alta mientras tanto: se sigue con ese.
        final veh = await TyreControlApi.obtenerVehiculo(id);
        if (mounted && veh != null) Navigator.of(context).pop(UsarVehiculo(veh));
        return;
      }
      // Con push y no pushReplacement: «Nueva revisión» espera el resultado
      // de ESTA pantalla, y pushReplacement lo completaría al instante.
      await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => AltaEjesScreen(
          vehiculoId: id,
          matricula: _mat,
          tipoVehiculoId: _tipoId!,
        ),
      ));
      if (mounted) Navigator.of(context).pop(const AltaTerminada());
    } catch (e) {
      if (mounted) setState(() => _error = _limpio(e));
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  static String _limpio(Object e) => '$e'
      .replaceFirst('Exception: ', '')
      .replaceFirst(RegExp(r'^PostgrestException\(message: '), '')
      .replaceFirst(RegExp(r', code: .*$'), '');

  // ── Pantallas ─────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final (titulo, subtitulo) = switch (_fase) {
      _Fase.confirmar => ('Matrícula leída', 'Compárala con la del camión'),
      _Fase.comprobando => ('Buscando $_mat', 'En todas tus flotas, también las de baja'),
      _Fase.comprobacion => ('Buscando $_mat', 'En todas tus flotas, también las de baja'),
      _Fase.pregunta => ('Vehículo no encontrado', widget.tecleada ? 'Matrícula escrita a mano' : 'Comprobado por foto'),
      _Fase.vehiculo => ('Alta de vehículo · $_mat', 'Paso 1 de 5 · el vehículo'),
      _Fase.tipo => ('Alta de vehículo · $_mat', 'Paso 2 de 5 · qué vehículo es'),
    };
    final paso = switch (_fase) { _Fase.vehiculo => 1, _Fase.tipo => 2, _ => 0 };
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(titulo),
          Text(subtitulo, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        ]),
        bottom: paso == 0
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(4),
                child: LinearProgressIndicator(value: paso / 5, minHeight: 4)),
      ),
      body: SafeArea(
        child: Column(children: [
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
                constraints: const BoxConstraints(maxWidth: 640),
                child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: _cuerpo()),
              ),
            ),
          ),
          _barra(),
        ]),
      ),
    );
  }

  Widget _cuerpo() => switch (_fase) {
        _Fase.confirmar => _confirmar(),
        _Fase.comprobando => const Padding(
            padding: EdgeInsets.only(top: 80),
            child: Center(child: CircularProgressIndicator())),
        _Fase.comprobacion => _resultadoComprobacion(),
        _Fase.pregunta => _pregunta(),
        _Fase.vehiculo => _datosVehiculo(),
        _Fase.tipo => _elegirTipo(),
      };

  // 1 · ¿Es esta matrícula?
  Widget _confirmar() {
    final j = _juicio;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (widget.fotoBytes != null)
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.memory(widget.fotoBytes!, height: 200, fit: BoxFit.cover),
        ),
      const SizedBox(height: 18),
      Center(child: _MatriculaGrande(matricula: j.matricula, dudosos: j.dudosos)),
      const SizedBox(height: 18),
      _Comprobado(ok: j.formatoValido, texto: nombreFormato(j.formato)),
      const SizedBox(height: 8),
      _Comprobado(
        ok: j.sinDudas,
        texto: j.sinDudas
            ? 'Leída con seguridad: ningún carácter dudoso (0/O, 8/B, 1/I)'
            : 'Hay ${j.dudosos.length == 1 ? 'un carácter dudoso' : '${j.dudosos.length} caracteres dudosos'} '
                '(en amarillo). Repite la foto más de cerca y sin reflejos.',
      ),
      const SizedBox(height: 16),
      const Text(
        'No se puede corregir a mano: si no es la del camión, repite la foto. '
        'Si la foto falla dos veces, en la búsqueda se deja escribirla.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
      ),
    ]);
  }

  // 2 · Comprobación
  Widget _resultadoComprobacion() {
    if (_comprobacion == null) {
      return const _Aviso(icono: Icons.cloud_off, texto: 'Sin la comprobación no se puede dar de alta. '
          'Vuelve a intentarlo cuando haya cobertura.');
    }
    final exactas = _lista('exactas');
    final activas = exactas.where((v) => v['activo'] == true).toList();
    final parecidas = _lista('parecidas');
    final bloqueo = _bloqueo;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (activas.isNotEmpty) ...[
        const Text('Esta matrícula ya está dada de alta:',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        const SizedBox(height: 10),
        for (final v in activas) ...[_TarjetaVehiculo(v: v, accion: 'Abrir', onTap: () => _usar(v)), const SizedBox(height: 8)],
      ] else ...[
        _Comprobado(ok: false, neutro: true, texto: 'No está en ninguna de tus flotas'),
        const SizedBox(height: 8),
        _Comprobado(
            ok: false,
            neutro: exactas.isEmpty,
            texto: exactas.isEmpty ? 'No está dada de baja' : 'Está dada de baja'),
      ],
      if (bloqueo != null) ...[
        const SizedBox(height: 16),
        _Aviso(icono: Icons.block, texto: bloqueo, color: AppColors.danger),
      ],
      if (bloqueo == null && activas.isEmpty && parecidas.isNotEmpty) ...[
        const SizedBox(height: 8),
        _Comprobado(
            ok: false,
            aviso: true,
            texto: 'Hay ${parecidas.length == 1 ? '1 parecida' : '${parecidas.length} parecidas'} '
                '(un carácter distinto). ¿Es alguna?'),
        const SizedBox(height: 10),
        for (final v in parecidas) ...[_TarjetaVehiculo(v: v, accion: 'Es este', onTap: () => _usar(v)), const SizedBox(height: 8)],
        const SizedBox(height: 6),
        const Text(
          'Se compara sin espacios ni guiones y se buscan las que cambian en un solo carácter: '
          'así no se duplica un camión porque alguien lo dio de alta mal.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
        ),
      ],
    ]);
  }

  // 3 · ¿Darlo de alta?
  Widget _pregunta() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 20),
      Center(child: _MatriculaGrande(matricula: _mat)),
      const SizedBox(height: 18),
      Text('$_mat no está en TyreControl',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
      const SizedBox(height: 8),
      Text(
        _empresas.length > 1
            ? '¿Quieres darlo de alta y hacerle ahora la primera revisión? Elige la flota:'
            : '¿Quieres darlo de alta en ${_empresas.isEmpty ? 'tu flota' : _empresas.first['nombre']} '
                'y hacerle ahora la primera revisión?',
        textAlign: TextAlign.center,
        style: const TextStyle(color: AppColors.textSecondary, fontSize: 15),
      ),
      if (_empresas.length > 1) ...[
        const SizedBox(height: 14),
        Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.center, children: [
          for (final e in _empresas)
            ChoiceChip(
              label: Text(e['nombre'] as String? ?? ''),
              selected: _empresaId == e['id'],
              onSelected: (_) => setState(() => _empresaId = e['id'] as String),
            ),
        ]),
      ],
      if (_empresas.isEmpty) ...[
        const SizedBox(height: 14),
        const _Aviso(icono: Icons.warning_amber, texto: 'No tienes ninguna flota asignada: pide a oficina que te la asigne.'),
      ],
    ]);
  }

  // 4 · El vehículo
  Widget _datosVehiculo() {
    final empresa = _empresas.where((e) => e['id'] == _empresaId).map((e) => e['nombre']).firstOrNull;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Row(children: [
          if (widget.fotoBytes != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.memory(widget.fotoBytes!, width: 72, height: 46, fit: BoxFit.cover),
            )
          else
            const Icon(Icons.keyboard, color: AppColors.warning, size: 32),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(widget.tecleada ? 'Matrícula (escrita a mano)' : 'Matrícula (de la foto)',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              Text(_mat, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 1.5)),
            ]),
          ),
          const Icon(Icons.lock_outline, color: AppColors.textHint, size: 18),
        ]),
      ),
      const SizedBox(height: 12),
      InputDecorator(
        decoration: const InputDecoration(labelText: 'Flota'),
        child: Text(empresa as String? ?? '—', style: const TextStyle(fontSize: 16)),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _unidad,
        textCapitalization: TextCapitalization.characters,
        decoration: const InputDecoration(labelText: 'Nº de unidad (si lo lleva)'),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _km,
        enabled: !_sinKm,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
        onChanged: (_) => setState(() {}),
        decoration: const InputDecoration(labelText: 'Km del cuentakilómetros', suffixText: 'km'),
      ),
      const SizedBox(height: 10),
      Align(
        alignment: Alignment.centerLeft,
        child: FilterChip(
          label: const Text('Sin km (no tiene o no se ve)'),
          selected: _sinKm,
          onSelected: (v) => setState(() => _sinKm = v),
        ),
      ),
      const SizedBox(height: 14),
      const Text(
        'La foto se guarda con el vehículo como prueba de la matrícula. Marca, modelo y bastidor '
        'los completa oficina: el vehículo nace pendiente de validar.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
      ),
    ]);
  }

  // 5 · Qué vehículo es
  Widget _elegirTipo() {
    if (_tipos.isEmpty) {
      return const _Aviso(
        icono: Icons.warning_amber,
        texto: 'No hay ningún tipo de vehículo con plano. Tiene que crearlos oficina '
            'antes de poder dar de alta este camión.',
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final t in _tipos) ...[
        TarjetaTipoVehiculo(
          tipo: t,
          elegido: t['id'] == _tipoId,
          onTap: () => setState(() => _tipoId = t['id'] as String?),
        ),
        const SizedBox(height: 12),
      ],
      const Text(
        'Después: el uso, los ejes (medida, llanta y presión) y las ruedas una a una. '
        'Al terminar queda hecha su primera revisión.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
      ),
    ]);
  }

  // ── Botones ───────────────────────────────────────────────────────────────

  Widget _barra() {
    final botones = <Widget>[];
    void boton(String texto, VoidCallback? accion, {bool principal = false, Color? color}) {
      botones.add(Expanded(
        flex: principal ? 2 : 1,
        child: SizedBox(
          height: 56,
          child: principal
              ? FilledButton(
                  style: color == null ? null : FilledButton.styleFrom(backgroundColor: color),
                  onPressed: accion,
                  child: Text(texto, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)))
              : OutlinedButton(onPressed: accion, child: Text(texto, style: const TextStyle(fontSize: 16))),
        ),
      ));
    }

    final nav = Navigator.of(context);
    switch (_fase) {
      case _Fase.confirmar:
        boton('Repetir foto', () => nav.pop(const RepetirFoto()), principal: !_juicio.valeParaAlta);
        if (_juicio.valeParaAlta) boton('Sí, es esta', _comprobar, principal: true, color: AppColors.success);
      case _Fase.comprobando:
        return const SizedBox.shrink();
      case _Fase.comprobacion:
        final activas = _lista('exactas').where((v) => v['activo'] == true);
        if (_comprobacion == null) {
          boton('Volver', () => nav.pop());
          boton('Reintentar', _comprobar, principal: true);
        } else if (_bloqueo != null || activas.isNotEmpty) {
          boton('Volver a buscar', () => nav.pop());
        } else {
          boton('No es ninguno, continuar', () => setState(() => _fase = _Fase.pregunta), principal: true);
        }
      case _Fase.pregunta:
        boton('No, volver a buscar', () => nav.pop());
        boton('Sí, darlo de alta', _puedeSeguir ? () => setState(() => _fase = _Fase.vehiculo) : null,
            principal: true, color: AppColors.success);
      case _Fase.vehiculo:
        boton('Cancelar', () => nav.pop());
        boton('Continuar', _puedeSeguir ? () => setState(() => _fase = _Fase.tipo) : null, principal: true);
      case _Fase.tipo:
        boton('Anterior', _trabajando ? null : () => setState(() => _fase = _Fase.vehiculo));
        boton(_trabajando ? 'Creando…' : 'Dar de alta y continuar', _puedeSeguir ? _crear : null, principal: true);
    }
    final conHueco = <Widget>[];
    for (var i = 0; i < botones.length; i++) {
      if (i > 0) conHueco.add(const SizedBox(width: 12));
      conHueco.add(botones[i]);
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.cardBorder)),
      ),
      child: Row(children: conHueco),
    );
  }
}

/// La matrícula como una placa, con los caracteres dudosos en amarillo.
class _MatriculaGrande extends StatelessWidget {
  final String matricula;
  final List<int> dudosos;
  const _MatriculaGrande({required this.matricula, this.dudosos = const []});

  @override
  Widget build(BuildContext context) {
    final m = normalizarMatricula(matricula);
    final legible = matriculaLegible(m);
    // Índice de cada carácter de la versión legible en la normalizada (los
    // espacios no cuentan).
    final spans = <TextSpan>[];
    var i = 0;
    for (final c in legible.split('')) {
      if (c == ' ') {
        spans.add(const TextSpan(text: ' '));
        continue;
      }
      final dudoso = dudosos.contains(i);
      spans.add(TextSpan(
        text: c,
        style: dudoso ? const TextStyle(backgroundColor: Color(0xFFFDE68A), color: Color(0xFF7C2D12)) : null,
      ));
      i++;
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(0, 6, 18, 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Colors.black, width: 2.5),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 26,
          height: 50,
          margin: const EdgeInsets.only(right: 12),
          alignment: Alignment.bottomCenter,
          padding: const EdgeInsets.only(bottom: 4),
          color: const Color(0xFF1F47B8),
          child: const Text('E', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w800)),
        ),
        Text.rich(
          TextSpan(children: spans),
          style: const TextStyle(
              color: Colors.black, fontSize: 38, fontWeight: FontWeight.w900, letterSpacing: 3, fontFamily: 'monospace'),
        ),
      ]),
    );
  }
}

class _Comprobado extends StatelessWidget {
  final bool ok;
  final bool aviso;
  final bool neutro;
  final String texto;
  const _Comprobado({required this.ok, required this.texto, this.aviso = false, this.neutro = false});

  @override
  Widget build(BuildContext context) {
    final (icono, color) = ok
        ? (Icons.check_circle, AppColors.success)
        : aviso
            ? (Icons.error, AppColors.warning)
            : neutro
                ? (Icons.cancel, AppColors.textHint)
                : (Icons.error, AppColors.warning);
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(icono, color: color, size: 22),
      const SizedBox(width: 10),
      Expanded(child: Text(texto, style: const TextStyle(fontSize: 15))),
    ]);
  }
}

class _TarjetaVehiculo extends StatelessWidget {
  final Map<String, dynamic> v;
  final String accion;
  final VoidCallback onTap;
  const _TarjetaVehiculo({required this.v, required this.accion, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final detalle = [
      v['empresa'],
      if (v['numero_unidad'] != null) 'unidad ${v['numero_unidad']}',
      v['tipo'],
      if (v['activo'] != true) 'de baja',
    ].whereType<String>().where((s) => s.isNotEmpty).join(' · ');
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.warning, width: 1.5),
      ),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(v['matricula'] as String? ?? '',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: 1)),
            Text(detalle, style: const TextStyle(color: AppColors.textSecondary)),
          ]),
        ),
        OutlinedButton(
          style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.warning, side: const BorderSide(color: AppColors.warning)),
          onPressed: onTap,
          child: Text(accion),
        ),
      ]),
    );
  }
}

class _Aviso extends StatelessWidget {
  final IconData icono;
  final String texto;
  final Color color;
  const _Aviso({required this.icono, required this.texto, this.color = AppColors.warning});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color),
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icono, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(texto, style: const TextStyle(fontSize: 15))),
        ]),
      );
}
