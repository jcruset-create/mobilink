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

class LineaStock {
  final String empresaId;
  final String clienteId;
  final String productoId;
  final String cliente;
  final String producto;
  final String ubicacion;
  final int cantidad;

  const LineaStock({
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
  List<LineaStock> _lineas = [];
  bool _loading = true;
  bool _guardando = false;
  String? _error;
  String? _mensaje;

  LineaStock? _lineaSeleccionada;
  String? _destino;
  final _cantidadCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();
  String _search = '';

  @override
  void initState() {
    super.initState();
    _cargarStock();
    _searchCtrl.addListener(() => setState(() => _search = _searchCtrl.text.toLowerCase()));
  }

  @override
  void dispose() {
    _cantidadCtrl.dispose();
    _searchCtrl.dispose();
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

      final lineas = mapa.values
          .where((m) => (m['cantidad'] as int) > 0)
          .map((m) => LineaStock(
                empresaId: m['empresaId'],
                clienteId: m['clienteId'],
                productoId: m['productoId'],
                cliente: m['cliente'],
                producto: m['producto'],
                ubicacion: m['ubicacion'],
                cantidad: m['cantidad'],
              ))
          .toList();

      lineas.sort((a, b) => a.producto.compareTo(b.producto));

      if (mounted) setState(() => _lineas = lineas);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _crear() async {
    if (_lineaSeleccionada == null) {
      setState(() => _mensaje = 'Selecciona un producto de origen.');
      return;
    }
    if (_destino == null) {
      setState(() => _mensaje = 'Selecciona la ubicación de destino.');
      return;
    }
    if (_destino == _lineaSeleccionada!.ubicacion) {
      setState(() => _mensaje = 'El origen y destino no pueden ser iguales.');
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

      await _db.from('traspasos').insert({
        'empresa_id': _lineaSeleccionada!.empresaId,
        'cliente_id': _lineaSeleccionada!.clienteId,
        'producto_id': _lineaSeleccionada!.productoId,
        'cantidad': cantidad,
        'ubicacion_origen': _lineaSeleccionada!.ubicacion,
        'ubicacion_destino': _destino,
        'estado': 'pendiente_salida',
        'observaciones':
            'Traspaso creado desde APK móvil. Operario: $operarioCodigo',
      });

      if (mounted) {
        setState(() {
          _mensaje = '✅ Traspaso creado correctamente.';
          _lineaSeleccionada = null;
          _destino = null;
          _cantidadCtrl.clear();
        });
        await _cargarStock();
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  List<LineaStock> get _lineasFiltradas {
    if (_search.isEmpty) return _lineas;
    return _lineas.where((l) =>
        l.producto.toLowerCase().contains(_search) ||
        l.cliente.toLowerCase().contains(_search) ||
        l.ubicacion.toLowerCase().contains(_search)).toList();
  }

  @override
  Widget build(BuildContext context) {
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
          ? const Center(child: CircularProgressIndicator(color: Colors.blue))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                      const SizedBox(height: 12),
                      ElevatedButton(
                          onPressed: _cargarStock,
                          style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
                          child: const Text('Reintentar')),
                    ],
                  ),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // PASO 1: Seleccionar producto
                      _seccion('1. Selecciona el producto a traspasar'),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _searchCtrl,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: 'Buscar producto, cliente o ubicación...',
                          hintStyle: const TextStyle(color: Colors.white38),
                          prefixIcon: const Icon(Icons.search, color: Colors.white38),
                          enabledBorder: OutlineInputBorder(
                            borderSide: const BorderSide(color: Colors.white24),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderSide: const BorderSide(color: Colors.blue),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          isDense: true,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ..._lineasFiltradas.map((linea) {
                        final selected = _lineaSeleccionada?.clave == linea.clave;
                        return GestureDetector(
                          onTap: () => setState(() => _lineaSeleccionada = linea),
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: selected
                                  ? Colors.blue.withOpacity(0.2)
                                  : const Color(0xFF16213e),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: selected ? Colors.blue : Colors.white12,
                                width: selected ? 2 : 1,
                              ),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(linea.producto,
                                          style: const TextStyle(
                                              color: Colors.white,
                                              fontWeight: FontWeight.w600,
                                              fontSize: 13)),
                                      const SizedBox(height: 2),
                                      Text(linea.cliente,
                                          style: const TextStyle(
                                              color: Colors.white54, fontSize: 12)),
                                      Text(linea.ubicacion,
                                          style: const TextStyle(
                                              color: Colors.blue, fontSize: 12)),
                                    ],
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.green.withOpacity(0.2),
                                    borderRadius: BorderRadius.circular(20),
                                    border: Border.all(color: Colors.green),
                                  ),
                                  child: Text('${linea.cantidad} ud',
                                      style: const TextStyle(
                                          color: Colors.green,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 12)),
                                ),
                              ],
                            ),
                          ),
                        );
                      }),

                      if (_lineasFiltradas.isEmpty && !_loading)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Text('No hay stock disponible.',
                              style: TextStyle(color: Colors.white54)),
                        ),

                      const SizedBox(height: 20),

                      // PASO 2: Destino
                      _seccion('2. Ubicación de destino'),
                      const SizedBox(height: 8),
                      DropdownButtonFormField<String>(
                        value: _destino,
                        dropdownColor: const Color(0xFF16213e),
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: 'Selecciona destino...',
                          hintStyle: const TextStyle(color: Colors.white38),
                          enabledBorder: OutlineInputBorder(
                            borderSide: const BorderSide(color: Colors.white24),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderSide: const BorderSide(color: Colors.blue),
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        items: _ubicaciones
                            .where((u) => u != _lineaSeleccionada?.ubicacion)
                            .map((u) => DropdownMenuItem(value: u, child: Text(u)))
                            .toList(),
                        onChanged: (v) => setState(() => _destino = v),
                      ),

                      const SizedBox(height: 20),

                      // PASO 3: Cantidad
                      _seccion('3. Cantidad a traspasar'),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _cantidadCtrl,
                        keyboardType: TextInputType.number,
                        style: const TextStyle(color: Colors.white, fontSize: 20),
                        enabled: !_guardando,
                        decoration: InputDecoration(
                          hintText: _lineaSeleccionada != null
                              ? 'Máx. ${_lineaSeleccionada!.cantidad}'
                              : 'Cantidad',
                          hintStyle: const TextStyle(color: Colors.white38),
                          suffixText: 'ud',
                          suffixStyle: const TextStyle(color: Colors.white54),
                          enabledBorder: OutlineInputBorder(
                            borderSide: const BorderSide(color: Colors.white24),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderSide: const BorderSide(color: Colors.blue),
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
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

                      const SizedBox(height: 24),
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
                            backgroundColor: Colors.blue,
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

  Widget _seccion(String texto) => Text(
        texto,
        style: const TextStyle(
            color: Colors.white70,
            fontWeight: FontWeight.bold,
            fontSize: 13),
      );
}
