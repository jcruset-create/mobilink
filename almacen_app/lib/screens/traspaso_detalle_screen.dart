import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final _db = Supabase.instance.client;

const _estadoLabels = {
  'pendiente_salida': 'Pendiente salida',
  'preparado': 'Pendiente salida',
  'en_camino': 'Pendiente recepción',
  'recibido_parcial': 'Recibido parcial',
  'recibido': 'Recibido',
};

const _estadoColors = {
  'pendiente_salida': Colors.orange,
  'preparado': Colors.orange,
  'en_camino': Colors.blue,
  'recibido_parcial': Colors.deepOrange,
  'recibido': Colors.green,
};

class TraspasoDetalleScreen extends StatefulWidget {
  final String id;
  const TraspasoDetalleScreen({super.key, required this.id});

  @override
  State<TraspasoDetalleScreen> createState() => _TraspasoDetalleScreenState();
}

class _TraspasoDetalleScreenState extends State<TraspasoDetalleScreen> {
  Map<String, dynamic>? _traspaso;
  bool _loading = true;
  bool _guardando = false;
  String? _error;
  String? _mensaje;
  final _pinControllers = List.generate(4, (_) => TextEditingController());
  final _pinFocusNodes = List.generate(4, (_) => FocusNode());

  String get _pin => _pinControllers.map((c) => c.text).join();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _pinControllers) c.dispose();
    for (final f in _pinFocusNodes) f.dispose();
    super.dispose();
  }

  void _onPinDigit(int index, String value) {
    if (value.length == 1 && index < 3) {
      _pinFocusNodes[index + 1].requestFocus();
    } else if (value.isEmpty && index > 0) {
      _pinFocusNodes[index - 1].requestFocus();
    }
  }

  void _limpiarPin() {
    for (final c in _pinControllers) c.clear();
    _pinFocusNodes[0].requestFocus();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; _mensaje = null; });
    try {
      final res = await _db
          .from('traspasos')
          .select('''
            id, codigo, estado, empresa_id, cliente_id, producto_id,
            cantidad, cantidad_recibida, ubicacion_origen, ubicacion_destino,
            productos_neumaticos ( marca, modelo, medida, dot ),
            solicitudes_reposicion ( id, estado, cantidad_sugerida )
          ''')
          .eq('id', widget.id)
          .single();

      if (mounted) setState(() => _traspaso = Map<String, dynamic>.from(res));
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _codigo() {
    final c = _traspaso?['codigo'] as String?;
    if (c != null && c.isNotEmpty) return c;
    return 'TR-${widget.id.substring(0, 8).toUpperCase()}';
  }

  String _producto() {
    final raw = _traspaso?['productos_neumaticos'];
    final p = raw is List ? (raw.isNotEmpty ? raw.first : null) : raw;
    if (p == null) return '—';
    final medida = p['medida'] ?? '';
    final marca = p['marca'] ?? '';
    final modelo = p['modelo'] != null ? ' ${p['modelo']}' : '';
    final dot = p['dot'] != null ? ' · DOT ${p['dot']}' : '';
    return '$medida - $marca$modelo$dot';
  }

  dynamic _primerSolicitud() {
    final raw = _traspaso?['solicitudes_reposicion'];
    if (raw == null) return null;
    if (raw is List) return raw.isNotEmpty ? raw.first : null;
    return raw;
  }

  Future<Map<String, dynamic>?> _validarCodigo(String codigo, String ubicacion) async {
    final res = await _db
        .from('perfiles_usuario')
        .select('id, nombre, rol, ubicacion, activo')
        .eq('codigo_operario', codigo.toUpperCase())
        .eq('activo', true)
        .maybeSingle();

    if (res == null) return {'ok': false, 'msg': 'Código personal no autorizado.'};

    final rol = res['rol'] as String? ?? 'operario';
    final esAdmin = rol == 'admin';
    final ubPerfil = res['ubicacion'] as String?;

    if (!esAdmin && ubPerfil != ubicacion) {
      return {'ok': false, 'msg': 'Código ${codigo.toUpperCase()} no autorizado para $ubicacion.'};
    }

    return {'ok': true, 'msg': '', 'perfil': res};
  }

  Future<void> _confirmarRecogida() async {
    if (_guardando || _traspaso == null) return;

    final codigo = _pin;
    if (codigo.length < 4) {
      setState(() => _mensaje = 'Introduce el PIN de 4 dígitos.');
      return;
    }

    final estado = _traspaso!['estado'] as String;
    if (estado != 'pendiente_salida' && estado != 'preparado') {
      setState(() => _mensaje = 'Este traspaso no está pendiente de salida.');
      await _load();
      return;
    }

    final origen = _traspaso!['ubicacion_origen'] as String?;
    if (origen == null) {
      setState(() => _mensaje = 'El traspaso no tiene ubicación origen.');
      return;
    }

    setState(() { _guardando = true; _mensaje = null; _error = null; });

    try {
      final validacion = await _validarCodigo(codigo, origen);
      if (validacion == null || validacion['ok'] != true) {
        setState(() => _mensaje = validacion?['msg'] ?? 'Código no autorizado.');
        _limpiarPin();
        return;
      }

      final cantidad = _traspaso!['cantidad'] as int;
      final empresaId = _traspaso!['empresa_id'];
      final clienteId = _traspaso!['cliente_id'];
      final productoId = _traspaso!['producto_id'];
      final destino = _traspaso!['ubicacion_destino'] as String?;
      final solicitud = _primerSolicitud();
      final solicitudId = solicitud?['id'];
      final origenMovimiento = solicitudId != null ? 'reposicion' : 'traspaso_manual';

      await _db.from('movimientos_stock').insert([
        {
          'empresa_id': empresaId, 'cliente_id': clienteId,
          'producto_id': productoId, 'tipo': 'SALIDA', 'cantidad': cantidad,
          'ubicacion': origen, 'traspaso_id': widget.id,
          'solicitud_reposicion_id': solicitudId, 'origen_movimiento': origenMovimiento,
          'observaciones': 'Salida autorizada desde mobile. Operario salida: ${codigo.toUpperCase()}',
        },
        {
          'empresa_id': empresaId, 'cliente_id': clienteId,
          'producto_id': productoId, 'tipo': 'ENTRADA', 'cantidad': cantidad,
          'ubicacion': 'En camino', 'traspaso_id': widget.id,
          'solicitud_reposicion_id': solicitudId, 'origen_movimiento': origenMovimiento,
          'observaciones': 'Traspaso hacia $destino. Operario salida: ${codigo.toUpperCase()}',
        },
      ]);

      await _db.from('traspasos').update({
        'estado': 'en_camino',
        'codigo_operario_salida': codigo.toUpperCase(),
        'fecha_salida': DateTime.now().toIso8601String(),
      }).eq('id', widget.id).inFilter('estado', ['pendiente_salida', 'preparado']);

      await _db.from('traspasos_auditoria').insert({
        'traspaso_id': widget.id,
        'accion': 'aceptacion_transporte',
        'codigo_personal': codigo.toUpperCase(),
        'estado_anterior': estado,
        'estado_nuevo': 'en_camino',
      });

      _limpiarPin();
      await _load();
      if (mounted) setState(() => _mensaje = '✅ Traspaso aceptado correctamente.');
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  Future<void> _confirmarRecepcion() async {
    if (_guardando || _traspaso == null) return;

    final codigo = _pin;
    if (codigo.length < 4) {
      setState(() => _mensaje = 'Introduce el PIN de 4 dígitos.');
      return;
    }

    final estado = _traspaso!['estado'] as String;
    if (estado != 'en_camino' && estado != 'recibido_parcial') {
      setState(() => _mensaje = 'Este traspaso no está pendiente de recepción.');
      await _load();
      return;
    }

    final destino = _traspaso!['ubicacion_destino'] as String?;
    if (destino == null) {
      setState(() => _mensaje = 'El traspaso no tiene ubicación destino.');
      return;
    }

    setState(() { _guardando = true; _mensaje = null; _error = null; });

    try {
      final validacion = await _validarCodigo(codigo, destino);
      if (validacion == null || validacion['ok'] != true) {
        setState(() => _mensaje = validacion?['msg'] ?? 'Código no autorizado.');
        _limpiarPin();
        return;
      }

      final cantidadTotal = _traspaso!['cantidad'] as int;
      final cantidadRecibida = (_traspaso!['cantidad_recibida'] as int?) ?? 0;
      final pendiente = cantidadTotal - cantidadRecibida;

      if (pendiente <= 0) {
        setState(() => _mensaje = 'No queda cantidad pendiente por recibir.');
        return;
      }

      final empresaId = _traspaso!['empresa_id'];
      final clienteId = _traspaso!['cliente_id'];
      final productoId = _traspaso!['producto_id'];
      final solicitud = _primerSolicitud();
      final solicitudId = solicitud?['id'];
      final origenMovimiento = solicitudId != null ? 'reposicion' : 'traspaso_manual';
      final totalRecibido = cantidadRecibida + pendiente;

      await _db.from('movimientos_stock').insert([
        {
          'empresa_id': empresaId, 'cliente_id': clienteId,
          'producto_id': productoId, 'tipo': 'SALIDA', 'cantidad': pendiente,
          'ubicacion': 'En camino', 'traspaso_id': widget.id,
          'solicitud_reposicion_id': solicitudId, 'origen_movimiento': origenMovimiento,
          'observaciones': 'Recepción traspaso desde mobile. Operario recepción: ${codigo.toUpperCase()}',
        },
        {
          'empresa_id': empresaId, 'cliente_id': clienteId,
          'producto_id': productoId, 'tipo': 'ENTRADA', 'cantidad': pendiente,
          'ubicacion': destino, 'traspaso_id': widget.id,
          'solicitud_reposicion_id': solicitudId, 'origen_movimiento': origenMovimiento,
          'observaciones': 'Recepción en $destino. Operario recepción: ${codigo.toUpperCase()}',
        },
      ]);

      await _db.from('traspasos').update({
        'estado': 'recibido',
        'cantidad_recibida': totalRecibido,
        'codigo_operario_recepcion': codigo.toUpperCase(),
        'firma_recepcion': codigo.toUpperCase(),
        'fecha_recepcion': DateTime.now().toIso8601String(),
      }).eq('id', widget.id).inFilter('estado', ['en_camino', 'recibido_parcial']);

      if (solicitudId != null) {
        await _db.from('solicitudes_reposicion').update({
          'estado': 'cerrada',
          'cerrada_at': DateTime.now().toIso8601String(),
        }).eq('traspaso_id', widget.id).eq('estado', 'en_traspaso');
      }

      await _db.from('traspasos_auditoria').insert({
        'traspaso_id': widget.id,
        'accion': 'recepcion',
        'codigo_personal': codigo.toUpperCase(),
        'estado_anterior': estado,
        'estado_nuevo': 'recibido',
      });

      _limpiarPin();
      await _load();
      if (mounted) setState(() => _mensaje = '✅ Recepción confirmada correctamente.');
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        backgroundColor: const Color(0xFF1a1a2e),
        appBar: AppBar(
            backgroundColor: const Color(0xFF16213e),
            foregroundColor: Colors.white),
        body: const Center(child: CircularProgressIndicator(color: Colors.blue)),
      );
    }

    final estado = _traspaso?['estado'] as String? ?? '';
    final color = _estadoColors[estado] ?? Colors.grey;
    final label = _estadoLabels[estado] ?? estado;
    final cantidad = _traspaso?['cantidad'] as int? ?? 0;
    final recibida = (_traspaso?['cantidad_recibida'] as int?) ?? 0;
    final pendiente = cantidad - recibida;

    final esSalida = estado == 'pendiente_salida' || estado == 'preparado';
    final esRecepcion = estado == 'en_camino' || estado == 'recibido_parcial';
    final finalizado = estado == 'recibido';

    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        backgroundColor: const Color(0xFF16213e),
        foregroundColor: Colors.white,
        title: Text(_codigo(),
            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white)),
        actions: [
          IconButton(
              icon: const Icon(Icons.refresh, color: Colors.white), onPressed: _load),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Cabecera
            _card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(_codigo(),
                            style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 20,
                                color: Colors.white)),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: color.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: color),
                        ),
                        child: Text(label,
                            style: TextStyle(
                                color: color,
                                fontWeight: FontWeight.bold,
                                fontSize: 12)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${_traspaso?['ubicacion_origen'] ?? '—'} → ${_traspaso?['ubicacion_destino'] ?? '—'}',
                    style: const TextStyle(color: Colors.white54, fontSize: 14),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // Líneas
            _card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Líneas',
                      style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          color: Colors.white)),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Colors.white12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_producto(),
                            style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                                color: Colors.white)),
                        const SizedBox(height: 8),
                        _lineaRow('Enviada', '$cantidad'),
                        _lineaRow('Recibida', '$recibida'),
                        _lineaRow('Pendiente', '$pendiente',
                            color: pendiente > 0 ? Colors.orange : Colors.green),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // Acción PIN
            if (!finalizado)
              _card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      esSalida
                          ? 'PIN del operario que transporta'
                          : 'PIN del operario que recibe',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: Colors.white),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(4, (i) {
                        return Container(
                          width: 56,
                          height: 64,
                          margin: const EdgeInsets.symmetric(horizontal: 8),
                          child: TextField(
                            controller: _pinControllers[i],
                            focusNode: _pinFocusNodes[i],
                            keyboardType: TextInputType.number,
                            maxLength: 1,
                            obscureText: true,
                            textAlign: TextAlign.center,
                            enabled: !_guardando,
                            style: const TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.bold),
                            decoration: InputDecoration(
                              counterText: '',
                              enabledBorder: OutlineInputBorder(
                                borderSide: const BorderSide(color: Colors.white24),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderSide: const BorderSide(color: Colors.blue),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              filled: true,
                              fillColor: Colors.white10,
                            ),
                            onChanged: (v) => _onPinDigit(i, v),
                          ),
                        );
                      }),
                    ),
                    const SizedBox(height: 20),
                    if (esSalida)
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: _guardando ? null : _confirmarRecogida,
                          icon: _guardando
                              ? const SizedBox(
                                  width: 18, height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.local_shipping),
                          label: Text(_guardando ? 'Guardando...' : 'Aceptar traspaso'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.blue,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                    if (esRecepcion)
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: _guardando ? null : _confirmarRecepcion,
                          icon: _guardando
                              ? const SizedBox(
                                  width: 18, height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.check_circle),
                          label: Text(_guardando ? 'Guardando...' : 'Recepcionar traspaso'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.green[700],
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                  ],
                ),
              ),

            if (finalizado)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.green),
                ),
                child: const Text('Este traspaso ya ha sido recibido.',
                    style: TextStyle(color: Colors.green, fontWeight: FontWeight.w600)),
              ),

            if (_mensaje != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: _mensaje!.startsWith('✅')
                      ? Colors.green.withOpacity(0.15)
                      : Colors.orange.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                      color: _mensaje!.startsWith('✅') ? Colors.green : Colors.orange),
                ),
                child: Text(_mensaje!,
                    style: TextStyle(
                        color: _mensaje!.startsWith('✅') ? Colors.green : Colors.orange,
                        fontWeight: FontWeight.w600)),
              ),
            ],

            if (_error != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.red.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.redAccent),
                ),
                child: Text(_error!,
                    style: const TextStyle(color: Colors.redAccent)),
              ),
            ],

            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh, color: Colors.white54),
                label: const Text('Actualizar',
                    style: TextStyle(color: Colors.white54)),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Colors.white24),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card({required Widget child}) => Card(
    color: const Color(0xFF16213e),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    child: Padding(padding: const EdgeInsets.all(16), child: child),
  );

  Widget _lineaRow(String label, String value, {Color? color}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      children: [
        Text('$label: ', style: const TextStyle(fontSize: 13, color: Colors.white54)),
        Text(value,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: color ?? Colors.white)),
      ],
    ),
  );
}
