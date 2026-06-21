import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final _db = Supabase.instance.client;

const _ubicaciones = [
  'Almacén Central Tarragona',
  'Base Reus',
  'Base Vilanova',
  'Taller Tarragona',
  'Central Alicante',
];

class _LineaStock {
  final String empresaId;
  final String clienteId;
  final String productoId;
  final String cliente;
  final String producto;
  final String ubicacion;
  final int cantidad;

  const _LineaStock({
    required this.empresaId,
    required this.clienteId,
    required this.productoId,
    required this.cliente,
    required this.producto,
    required this.ubicacion,
    required this.cantidad,
  });

  String get clave => '$empresaId|$clienteId|$productoId|$ubicacion';
}

class NuevoTraspasoScreen extends StatefulWidget {
  final Map<String, dynamic> operario;
  const NuevoTraspasoScreen({super.key, required this.operario});

  @override
  State<NuevoTraspasoScreen> createState() => _NuevoTraspasoScreenState();
}

class _NuevoTraspasoScreenState extends State<NuevoTraspasoScreen> {
  List<_LineaStock> _todasLineas = [];
  bool _loading = true;
  bool _guardando = false;
  String? _error;
  String? _mensaje;

  // Selecciones en cascada
  String? _origen;
  String? _clienteId;
  String? _lineaClave;
  String? _destino;
  final _cantidadCtrl = TextEditingController();
  final _obsCtrl = TextEditingController();

  bool get _esAdmin => widget.operario['rol'] == 'admin' || widget.operario['rol'] == 'responsable';
  String? get _ubicacionOperario => widget.operario['ubicacion'] as String?;

  @override
  void initState() {
    super.initState();
    _cargarStock();
  }

  @override
  void dispose() {
    _cantidadCtrl.dispose();
    _obsCtrl.dispose();
    super.dispose();
  }

  Future<void> _cargarStock() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await _db
          .from('movimientos_stock')
          .select('''
            tipo, cantidad, ubicacion, empresa_id, cliente_id, producto_id,
            clientes ( nombre ),
            productos_neumaticos ( marca, modelo, medida, dot )
          ''')
          .order('created_at', ascending: false);

      final mapa = <String, Map<String, dynamic>>{};

      for (final m in data) {
        final clienteRaw = m['clientes'];
        final productoRaw = m['productos_neumaticos'];
        final cliente = clienteRaw is List
            ? (clienteRaw.isNotEmpty ? clienteRaw.first : null)
            : clienteRaw;
        final producto = productoRaw is List
            ? (productoRaw.isNotEmpty ? productoRaw.first : null)
            : productoRaw;

        if (cliente == null || producto == null) continue;

        final ubicacion = (m['ubicacion'] as String?) ?? '-';
        if (ubicacion == '-' || ubicacion == 'En camino') continue;

        final empresaId = m['empresa_id'] as String? ?? '';
        final clienteId = m['cliente_id'] as String? ?? '';
        final productoId = m['producto_id'] as String? ?? '';
        final clave = '$empresaId|$clienteId|$productoId|$ubicacion';

        final tipo = m['tipo'] as String? ?? '';
        final cant = (m['cantidad'] as int?) ?? 0;

        if (!mapa.containsKey(clave)) {
          final medida = producto['medida'] ?? '';
          final marca = producto['marca'] ?? '';
          final modelo = producto['modelo'] != null ? ' ${producto['modelo']}' : '';
          final dot = producto['dot'] != null ? ' · DOT ${producto['dot']}' : '';
          mapa[clave] = {
            'empresaId': empresaId,
            'clienteId': clienteId,
            'productoId': productoId,
            'cliente': cliente['nombre'] ?? '',
            'producto': '$medida - $marca$modelo$dot',
            'ubicacion': ubicacion,
            'cantidad': 0,
          };
        }

        if (tipo == 'ENTRADA') {
          mapa[clave]!['cantidad'] = (mapa[clave]!['cantidad'] as int) + cant;
        } else if (tipo == 'SALIDA') {
          mapa[clave]!['cantidad'] = (mapa[clave]!['cantidad'] as int) - cant;
        }
      }

      var lineas = mapa.values
          .where((m) => (m['cantidad'] as int) > 0)
          .map((m) => _LineaStock(
                empresaId: m['empresaId'],
                clienteId: m['clienteId'],
                productoId: m['productoId'],
                cliente: m['cliente'],
                producto: m['producto'],
                ubicacion: m['ubicacion'],
                cantidad: m['cantidad'],
              ))
          .toList();

      // Filtrar por ubicación si no es admin
      if (!_esAdmin && _ubicacionOperario != null) {
        lineas = lineas.where((l) => l.ubicacion == _ubicacionOperario).toList();
      }

      lineas.sort((a, b) => a.producto.compareTo(b.producto));

      if (mounted) setState(() => _todasLineas = lineas);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // Ubicaciones de origen disponibles según stock
  List<String> get _origenesDisponibles {
    final set = _todasLineas.map((l) => l.ubicacion).toSet().toList();
    set.sort();
    return set;
  }

  // Clientes disponibles según origen seleccionado
  List<Map<String, String>> get _clientesDisponibles {
    if (_origen == null) return [];
    final lineas = _todasLineas.where((l) => l.ubicacion == _origen);
    final mapa = <String, String>{};
    for (final l in lineas) mapa[l.clienteId] = l.cliente;
    final lista = mapa.entries.map((e) => {'id': e.key, 'nombre': e.value}).toList();
    lista.sort((a, b) => a['nombre']!.compareTo(b['nombre']!));
    return lista;
  }

  // Líneas de stock según origen + cliente
  List<_LineaStock> get _productosDisponibles {
    if (_origen == null || _clienteId == null) return [];
    return _todasLineas
        .where((l) => l.ubicacion == _origen && l.clienteId == _clienteId)
        .toList();
  }

  _LineaStock? get _lineaSeleccionada =>
      _productosDisponibles.where((l) => l.clave == _lineaClave).firstOrNull;

  // Destinos (excluye el origen)
  List<String> get _destinosDisponibles =>
      _ubicaciones.where((u) => u != _origen).toList();

  Future<void> _crear() async {
    if (_origen == null) {
      setState(() => _mensaje = 'Selecciona la ubicación de origen.');
      return;
    }
    if (_clienteId == null) {
      setState(() => _mensaje = 'Selecciona el cliente.');
      return;
    }
    if (_lineaSeleccionada == null) {
      setState(() => _mensaje = 'Selecciona el producto.');
      return;
    }
    if (_destino == null) {
      setState(() => _mensaje = 'Selecciona la ubicación de destino.');
      return;
    }
    final cantidad = int.tryParse(_cantidadCtrl.text.trim());
    if (cantidad == null || cantidad <= 0) {
      setState(() => _mensaje = 'Introduce una cantidad válida.');
      return;
    }
    if (cantidad > _lineaSeleccionada!.cantidad) {
      setState(() => _mensaje =
          'Stock disponible: ${_lineaSeleccionada!.cantidad}. No puedes traspasar más.');
      return;
    }

    setState(() { _guardando = true; _mensaje = null; _error = null; });

    try {
      final operarioCodigo = widget.operario['codigo_operario'] as String? ?? '';
      final obs = _obsCtrl.text.trim().isNotEmpty
          ? _obsCtrl.text.trim()
          : 'Traspaso creado desde APK móvil. Operario: $operarioCodigo';

      await _db.from('traspasos').insert({
        'empresa_id': _lineaSeleccionada!.empresaId,
        'cliente_id': _lineaSeleccionada!.clienteId,
        'producto_id': _lineaSeleccionada!.productoId,
        'cantidad': cantidad,
        'ubicacion_origen': _origen,
        'ubicacion_destino': _destino,
        'estado': 'pendiente_salida',
        'observaciones': obs,
      });

      if (mounted) {
        setState(() {
          _mensaje = '✅ Traspaso creado correctamente.';
          _origen = null;
          _clienteId = null;
          _lineaClave = null;
          _destino = null;
          _cantidadCtrl.clear();
          _obsCtrl.clear();
        });
        await _cargarStock();
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final linea = _lineaSeleccionada;

    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        backgroundColor: const Color(0xFF16213e),
        foregroundColor: Colors.white,
        title: const Text('Nuevo traspaso',
            style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white)),
        actions: [
          IconButton(
              icon: const Icon(Icons.refresh, color: Colors.white),
              onPressed: _cargarStock),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Colors.green))
          : _error != null
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                    const SizedBox(height: 12),
                    ElevatedButton(
                        onPressed: _cargarStock,
                        style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                        child: const Text('Reintentar')),
                  ]))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // 1. Origen
                      _label('1. Ubicación origen'),
                      const SizedBox(height: 6),
                      _dropdown<String>(
                        value: _origen,
                        hint: 'Ubicación origen...',
                        items: _origenesDisponibles
                            .map((u) => DropdownMenuItem(value: u, child: Text(u)))
                            .toList(),
                        onChanged: (v) => setState(() {
                          _origen = v;
                          _clienteId = null;
                          _lineaClave = null;
                          _destino = null;
                        }),
                      ),

                      const SizedBox(height: 14),

                      // 2. Cliente
                      _label('2. Cliente con stock en origen'),
                      const SizedBox(height: 6),
                      _dropdown<String>(
                        value: _clienteId,
                        hint: 'Cliente con stock en origen...',
                        items: _clientesDisponibles
                            .map((c) => DropdownMenuItem(
                                value: c['id'], child: Text(c['nombre']!)))
                            .toList(),
                        onChanged: _origen == null
                            ? null
                            : (v) => setState(() {
                                  _clienteId = v;
                                  _lineaClave = null;
                                }),
                      ),

                      const SizedBox(height: 14),

                      // 3. Producto
                      _label('3. Producto disponible'),
                      const SizedBox(height: 6),
                      _dropdown<String>(
                        value: _lineaClave,
                        hint: 'Producto disponible...',
                        items: _productosDisponibles
                            .map((l) => DropdownMenuItem(
                                value: l.clave,
                                child: Text('${l.producto} (${l.cantidad} ud)')))
                            .toList(),
                        onChanged: _clienteId == null
                            ? null
                            : (v) => setState(() => _lineaClave = v),
                      ),

                      if (linea != null) ...[
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.green.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: Colors.green.withOpacity(0.4)),
                          ),
                          child: Text('Stock disponible: ${linea.cantidad} ud',
                              style: const TextStyle(
                                  color: Colors.green, fontSize: 13)),
                        ),
                      ],

                      const SizedBox(height: 14),

                      // 4. Cantidad
                      _label('4. Cantidad'),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _cantidadCtrl,
                        keyboardType: TextInputType.number,
                        enabled: !_guardando,
                        style: const TextStyle(color: Colors.white, fontSize: 18),
                        decoration: _inputDeco(
                          hint: linea != null ? 'Máx. ${linea.cantidad}' : 'Cantidad',
                          suffix: 'ud',
                        ),
                      ),

                      const SizedBox(height: 14),

                      // 5. Destino
                      _label('5. Ubicación destino'),
                      const SizedBox(height: 6),
                      _dropdown<String>(
                        value: _destino,
                        hint: 'Ubicación destino...',
                        items: _destinosDisponibles
                            .map((u) => DropdownMenuItem(value: u, child: Text(u)))
                            .toList(),
                        onChanged: (v) => setState(() => _destino = v),
                      ),

                      const SizedBox(height: 14),

                      // 6. Observaciones
                      _label('Observaciones (opcional)'),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _obsCtrl,
                        enabled: !_guardando,
                        style: const TextStyle(color: Colors.white),
                        maxLines: 2,
                        decoration: _inputDeco(hint: 'Observaciones...'),
                      ),

                      if (_mensaje != null) ...[
                        const SizedBox(height: 16),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: _mensaje!.startsWith('✅')
                                ? Colors.green.withOpacity(0.15)
                                : Colors.orange.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                                color: _mensaje!.startsWith('✅')
                                    ? Colors.green
                                    : Colors.orange),
                          ),
                          child: Text(_mensaje!,
                              style: TextStyle(
                                  color: _mensaje!.startsWith('✅')
                                      ? Colors.green
                                      : Colors.orange,
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

                      const SizedBox(height: 28),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: _guardando ? null : _crear,
                          icon: _guardando
                              ? const SizedBox(
                                  width: 18, height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.add_circle),
                          label: Text(_guardando ? 'Creando...' : 'Crear traspaso'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.green[700],
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                      const SizedBox(height: 30),
                    ],
                  ),
                ),
    );
  }

  Widget _label(String text) => Text(text,
      style: const TextStyle(
          color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 13));

  Widget _dropdown<T>({
    required T? value,
    required String hint,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?>? onChanged,
  }) =>
      DropdownButtonFormField<T>(
        value: value,
        dropdownColor: const Color(0xFF16213e),
        style: const TextStyle(color: Colors.white, fontSize: 14),
        isExpanded: true,
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Colors.white38),
          enabledBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: Colors.white24),
            borderRadius: BorderRadius.circular(10),
          ),
          focusedBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: Colors.green),
            borderRadius: BorderRadius.circular(10),
          ),
          disabledBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: Colors.white12),
            borderRadius: BorderRadius.circular(10),
          ),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        ),
        items: items,
        onChanged: onChanged,
      );

  InputDecoration _inputDeco({required String hint, String? suffix}) =>
      InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Colors.white38),
        suffixText: suffix,
        suffixStyle: const TextStyle(color: Colors.white54),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: Colors.white24),
          borderRadius: BorderRadius.circular(10),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: Colors.green),
          borderRadius: BorderRadius.circular(10),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      );
}
