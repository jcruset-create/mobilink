import 'package:flutter/material.dart';
import '../services/api_service.dart';

const _estadoColors = {
  'pendiente': Colors.orange,
  'parcial': Colors.yellow,
  'cobrado': Colors.green,
  'anulado': Colors.grey,
};

const _estadoLabels = {
  'pendiente': 'Pendiente',
  'parcial': 'Parcial',
  'cobrado': 'Cobrado',
  'anulado': 'Anulado',
};

const _metodos = [
  ('efectivo', 'Efectivo'),
  ('tarjeta', 'Tarjeta'),
  ('transferencia', 'Transferencia'),
  ('bizum', 'Bizum'),
  ('pendiente_facturar', 'Pendiente facturar'),
];

class CobrosScreen extends StatefulWidget {
  final ApiService api;

  const CobrosScreen({super.key, required this.api});

  @override
  State<CobrosScreen> createState() => _CobrosScreenState();
}

class _CobrosScreenState extends State<CobrosScreen> {
  List<Map<String, dynamic>> _cobros = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.api.getCobros();
      if (mounted) setState(() => _cobros = data);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _abrirDetalle(Map<String, dynamic> cobro) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF16213e),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => CobroDetailSheet(
        cobro: cobro,
        api: widget.api,
        onCobrado: () {
          Navigator.pop(context);
          _load();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _load, child: const Text('Reintentar')),
          ],
        ),
      );
    }
    if (_cobros.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.receipt_long, size: 60, color: Colors.white24),
            const SizedBox(height: 16),
            const Text('No hay cobros asignados',
                style: TextStyle(color: Colors.white54, fontSize: 16)),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: const Text('Actualizar'),
            ),
          ],
        ),
      );
    }

    // Summary row
    final pendientes = _cobros.where((c) => c['estado'] == 'pendiente').length;
    final totalPendiente = _cobros
        .where((c) => c['estado'] == 'pendiente')
        .fold<double>(0, (sum, c) => sum + (c['importe_total'] as num).toDouble());

    return RefreshIndicator(
      onRefresh: _load,
      child: Column(
        children: [
          // Resumen
          Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF16213e),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.orange.withOpacity(0.4)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _summaryItem('Pendientes', '$pendientes', Colors.orange),
                _summaryItem(
                    'Total pendiente', '${totalPendiente.toStringAsFixed(2)} €', Colors.orange),
                _summaryItem('Total cobros', '${_cobros.length}', Colors.white70),
              ],
            ),
          ),
          // Lista
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _cobros.length,
              itemBuilder: (ctx, i) => _CobroCard(
                cobro: _cobros[i],
                onTap: () => _abrirDetalle(_cobros[i]),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryItem(String label, String value, Color color) => Column(
        children: [
          Text(value,
              style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w900)),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(color: Colors.white54, fontSize: 11)),
        ],
      );
}

class _CobroCard extends StatelessWidget {
  final Map<String, dynamic> cobro;
  final VoidCallback onTap;

  const _CobroCard({required this.cobro, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final estado = cobro['estado'] as String? ?? 'pendiente';
    final color = _estadoColors[estado] ?? Colors.grey;
    final importe = (cobro['importe_total'] as num).toDouble();
    final concepto = cobro['concepto'] as String? ?? '';
    final cliente = cobro['cliente_nombre'] as String? ?? '';
    final plate = cobro['plate'] as String?;

    return Card(
      color: const Color(0xFF16213e),
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              // Estado indicator
              Container(
                width: 6,
                height: 60,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            concepto,
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                                fontSize: 15),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Text(
                          '${importe.toStringAsFixed(2)} €',
                          style: TextStyle(
                              color: color,
                              fontWeight: FontWeight.w900,
                              fontSize: 16),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [if (cliente.isNotEmpty) cliente, if (plate != null) plate]
                          .join(' · '),
                      style: const TextStyle(color: Colors.white60, fontSize: 12),
                    ),
                    const SizedBox(height: 6),
                    Container(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: color.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _estadoLabels[estado] ?? estado,
                        style: TextStyle(
                            color: color,
                            fontSize: 11,
                            fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Colors.white38),
            ],
          ),
        ),
      ),
    );
  }
}

class CobroDetailSheet extends StatefulWidget {
  final Map<String, dynamic> cobro;
  final ApiService api;
  final VoidCallback onCobrado;

  const CobroDetailSheet({
    required this.cobro,
    required this.api,
    required this.onCobrado,
  });

  @override
  State<CobroDetailSheet> createState() => _CobroDetailSheetState();
}

class _CobroDetailSheetState extends State<CobroDetailSheet> {
  String? _metodoPago;
  final _importeCtrl = TextEditingController();
  final _obsCtrl = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final importe = (widget.cobro['importe_total'] as num).toDouble();
    _importeCtrl.text = importe.toStringAsFixed(2);
    _obsCtrl.text = widget.cobro['observaciones'] as String? ?? '';
  }

  @override
  void dispose() {
    _importeCtrl.dispose();
    _obsCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_metodoPago == null) {
      setState(() => _error = 'Selecciona el método de pago');
      return;
    }
    final importe = double.tryParse(_importeCtrl.text.replaceAll(',', '.'));
    if (importe == null || importe <= 0) {
      setState(() => _error = 'Introduce un importe válido');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await widget.api.marcarCobrado(
        widget.cobro['id'] as int,
        metodoPago: _metodoPago!,
        importeCobrado: importe,
        observaciones: _obsCtrl.text.trim().isEmpty ? null : _obsCtrl.text.trim(),
      );
      widget.onCobrado();
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cobro = widget.cobro;
    final estado = cobro['estado'] as String? ?? 'pendiente';
    final yaCobrado = estado == 'cobrado';
    final color = _estadoColors[estado] ?? Colors.grey;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Título
            Row(
              children: [
                Expanded(
                  child: Text(
                    cobro['concepto'] as String? ?? '',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w900),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _estadoLabels[estado] ?? estado,
                    style: TextStyle(
                        color: color, fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Info
            _infoRow(Icons.person, cobro['cliente_nombre'] as String? ?? ''),
            if ((cobro['telefono'] as String? ?? '').isNotEmpty)
              _infoRow(Icons.phone, cobro['telefono'] as String? ?? ''),
            if ((cobro['plate'] as String? ?? '').isNotEmpty)
              _infoRow(Icons.directions_car, cobro['plate'] as String? ?? ''),
            if ((cobro['address'] as String? ?? '').isNotEmpty)
              _infoRow(Icons.location_on, cobro['address'] as String? ?? ''),
            _infoRow(
              Icons.euro,
              'Total: ${(cobro['importe_total'] as num).toStringAsFixed(2)} €',
              color: Colors.white,
            ),

            if (yaCobrado) ...[
              const SizedBox(height: 8),
              _infoRow(Icons.payment,
                  'Cobrado: ${(cobro['importe_cobrado'] as num? ?? 0).toStringAsFixed(2)} €',
                  color: Colors.green),
              if (cobro['metodo_pago'] != null)
                _infoRow(Icons.credit_card, 'Método: ${cobro['metodo_pago']}'),
              if ((cobro['observaciones'] as String? ?? '').isNotEmpty)
                _infoRow(Icons.notes, cobro['observaciones'] as String),
            ],

            if (!yaCobrado) ...[
              const Divider(color: Colors.white12, height: 28),
              const Text('Marcar como cobrado',
                  style: TextStyle(
                      color: Colors.white70,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5)),
              const SizedBox(height: 12),

              // Método de pago
              DropdownButtonFormField<String>(
                value: _metodoPago,
                dropdownColor: const Color(0xFF1a1a2e),
                decoration: InputDecoration(
                  labelText: 'Método de pago *',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide.none,
                  ),
                ),
                style: const TextStyle(color: Colors.white),
                items: _metodos
                    .map((m) => DropdownMenuItem(value: m.$1, child: Text(m.$2)))
                    .toList(),
                onChanged: (v) => setState(() => _metodoPago = v),
              ),
              const SizedBox(height: 12),

              // Importe cobrado
              TextField(
                controller: _importeCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Importe cobrado (€) *',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // Observaciones
              TextField(
                controller: _obsCtrl,
                style: const TextStyle(color: Colors.white),
                maxLines: 2,
                decoration: InputDecoration(
                  labelText: 'Observaciones',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),

              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!,
                    style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
              ],

              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _saving ? null : _submit,
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.black))
                      : const Icon(Icons.check_circle),
                  label: Text(_saving ? 'Guardando...' : 'Marcar como cobrado'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.green,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(IconData icon, String text, {Color? color}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 16, color: color ?? Colors.white54),
            const SizedBox(width: 10),
            Expanded(
              child: Text(text,
                  style: TextStyle(color: color ?? Colors.white70, fontSize: 14)),
            ),
          ],
        ),
      );
}
