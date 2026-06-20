import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';

class PaymentsScreen extends StatefulWidget {
  final ApiService api;
  const PaymentsScreen({super.key, required this.api});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          color: const Color(0xFF16213e),
          child: TabBar(
            controller: _tabs,
            indicatorColor: Colors.green,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white54,
            tabs: const [
              Tab(icon: Icon(Icons.add_card), text: 'Nuevo cobro'),
              Tab(icon: Icon(Icons.history), text: 'Historial'),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [
              _NewPaymentTab(api: widget.api, onCreated: () => _tabs.animateTo(1)),
              _PaymentHistoryTab(api: widget.api),
            ],
          ),
        ),
      ],
    );
  }
}

// ── Nuevo cobro ──────────────────────────────────────────────────────────────

class _NewPaymentTab extends StatefulWidget {
  final ApiService api;
  final VoidCallback onCreated;
  const _NewPaymentTab({required this.api, required this.onCreated});

  @override
  State<_NewPaymentTab> createState() => _NewPaymentTabState();
}

class _NewPaymentTabState extends State<_NewPaymentTab> {
  final _refCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _amountCtrl = TextEditingController(text: '50');

  bool _loading = false;
  String? _error;
  String? _paymentUrl;
  String? _lastPhone;
  String? _lastAmount;
  String? _lastDesc;

  @override
  void dispose() {
    for (final c in [_refCtrl, _nameCtrl, _phoneCtrl, _descCtrl, _amountCtrl]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _create() async {
    final ref = _refCtrl.text.trim();
    final amount = double.tryParse(_amountCtrl.text.replaceAll(',', '.'));
    if (ref.isEmpty) {
      setState(() => _error = 'La referencia es obligatoria');
      return;
    }
    if (amount == null || amount < 1) {
      setState(() => _error = 'Introduce un importe válido (mínimo 1 €)');
      return;
    }

    setState(() { _loading = true; _error = null; _paymentUrl = null; });
    try {
      final data = await widget.api.createPaymentLink(
        jobId: ref,
        customerName: _nameCtrl.text.trim(),
        customerPhone: _phoneCtrl.text.trim(),
        amountEuros: amount,
        description: _descCtrl.text.trim(),
      );
      setState(() {
        _paymentUrl = data['url'] as String?;
        _lastPhone = _phoneCtrl.text.trim();
        _lastAmount = _amountCtrl.text.trim();
        _lastDesc = _descCtrl.text.trim();
      });
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _buildWhatsAppText(String url) {
    final name = _nameCtrl.text.trim();
    final desc = _lastDesc ?? '';
    final amount = double.tryParse((_lastAmount ?? '').replaceAll(',', '.'));
    return 'Hola${name.isNotEmpty ? ' $name' : ''}, para confirmar la asistencia puede realizar la paga y señal aquí:\n\n$url\n\nImporte: ${amount?.toStringAsFixed(2) ?? '?'} €${desc.isNotEmpty ? '\nConcepto: $desc' : ''}';
  }

  Future<void> _copyLink() async {
    if (_paymentUrl == null) return;
    await Clipboard.setData(ClipboardData(text: _paymentUrl!));
    if (mounted) _showSnack('Enlace copiado');
  }

  Future<void> _copyWhatsApp() async {
    if (_paymentUrl == null) return;
    await Clipboard.setData(ClipboardData(text: _buildWhatsAppText(_paymentUrl!)));
    if (mounted) _showSnack('Mensaje WhatsApp copiado');
  }

  Future<void> _openWhatsApp() async {
    if (_paymentUrl == null) return;
    final phone = (_lastPhone ?? '').replaceAll(RegExp(r'\D'), '');
    final text = Uri.encodeComponent(_buildWhatsAppText(_paymentUrl!));
    final uri = Uri.parse('https://wa.me/$phone?text=$text');
    if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _field('Referencia *', _refCtrl, hint: 'Ej: 33', keyboard: TextInputType.number),
          const SizedBox(height: 12),
          _field('Cliente', _nameCtrl, hint: 'Nombre del cliente'),
          const SizedBox(height: 12),
          _field('Teléfono', _phoneCtrl, hint: 'Ej: 34600111222', keyboard: TextInputType.phone),
          const SizedBox(height: 12),
          _field('Descripción / Concepto', _descCtrl, hint: 'Ej: Paga y señal reparación motor'),
          const SizedBox(height: 12),
          _field('Importe (€) *', _amountCtrl,
              hint: '50', keyboard: const TextInputType.numberWithOptions(decimal: true)),
          const SizedBox(height: 20),

          if (_error != null) ...[
            Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
            const SizedBox(height: 10),
          ],

          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _loading ? null : _create,
              icon: _loading
                  ? const SizedBox(width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                  : const Icon(Icons.add_card),
              label: Text(_loading ? 'Creando...' : 'Crear enlace de pago'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.green,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),

          if (_paymentUrl != null) ...[
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFF16213e),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.green.withOpacity(0.5)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Enlace generado',
                      style: TextStyle(color: Colors.white54, fontSize: 12, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Text(_paymentUrl!,
                      style: const TextStyle(color: Colors.greenAccent, fontSize: 12),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _actionBtn('Copiar enlace', Icons.copy, Colors.white, Colors.black, _copyLink),
                      _actionBtn('Copiar WhatsApp', Icons.message, Colors.green, Colors.white, _copyWhatsApp),
                      _actionBtn('Abrir WhatsApp', Icons.open_in_new, const Color(0xFF25D366), Colors.white, _openWhatsApp),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: widget.onCreated,
                      icon: const Icon(Icons.history, size: 16),
                      label: const Text('Ver historial'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white54,
                        side: const BorderSide(color: Colors.white24),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _field(String label, TextEditingController ctrl,
      {String? hint, TextInputType? keyboard}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        TextField(
          controller: ctrl,
          keyboardType: keyboard,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(color: Colors.white30),
            filled: true,
            fillColor: Colors.white10,
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
          ),
        ),
      ],
    );
  }

  Widget _actionBtn(String label, IconData icon, Color bg, Color fg, VoidCallback onTap) {
    return ElevatedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 16),
      label: Text(label, style: const TextStyle(fontSize: 13)),
      style: ElevatedButton.styleFrom(
        backgroundColor: bg,
        foregroundColor: fg,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }
}

// ── Historial ────────────────────────────────────────────────────────────────

class _PaymentHistoryTab extends StatefulWidget {
  final ApiService api;
  const _PaymentHistoryTab({required this.api});

  @override
  State<_PaymentHistoryTab> createState() => _PaymentHistoryTabState();
}

class _PaymentHistoryTabState extends State<_PaymentHistoryTab> {
  List<Map<String, dynamic>> _payments = [];
  bool _loading = true;
  String? _error;
  int? _cancellingId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await widget.api.getPaymentHistory();
      if (mounted) setState(() => _payments = data);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _cancel(int id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: const Color(0xFF16213e),
        title: const Text('Cancelar cobro', style: TextStyle(color: Colors.white)),
        content: const Text('¿Cancelar este cobro? El enlace dejará de funcionar.',
            style: TextStyle(color: Colors.white70)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('No')),
          TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Sí, cancelar', style: TextStyle(color: Colors.redAccent))),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _cancellingId = id);
    try {
      await widget.api.cancelPayment(id);
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted) setState(() => _cancellingId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          const SizedBox(height: 12),
          ElevatedButton(onPressed: _load, child: const Text('Reintentar')),
        ],
      ));
    }
    if (_payments.isEmpty) {
      return Center(child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.receipt_long, size: 56, color: Colors.white24),
          const SizedBox(height: 12),
          const Text('No hay pagos registrados', style: TextStyle(color: Colors.white54)),
          const SizedBox(height: 12),
          ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Actualizar')),
        ],
      ));
    }

    // Summary
    final pagados = _payments.where((p) => p['status'] == 'paid').length;
    final totalPagado = _payments
        .where((p) => p['status'] == 'paid')
        .fold<double>(0, (s, p) => s + (p['amount_cents'] as num).toDouble() / 100);

    return RefreshIndicator(
      onRefresh: _load,
      child: Column(
        children: [
          // Resumen
          Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF16213e),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.green.withOpacity(0.4)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _summaryItem('Pagados', '$pagados', Colors.green),
                _summaryItem('Total cobrado', '${totalPagado.toStringAsFixed(2)} €', Colors.green),
                _summaryItem('Total enlaces', '${_payments.length}', Colors.white70),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _payments.length,
              itemBuilder: (_, i) => _PaymentCard(
                payment: _payments[i],
                cancelling: _cancellingId == (_payments[i]['id'] as int),
                onCancel: () => _cancel(_payments[i]['id'] as int),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryItem(String label, String value, Color color) => Column(
    children: [
      Text(value, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w900)),
      const SizedBox(height: 2),
      Text(label, style: const TextStyle(color: Colors.white54, fontSize: 11)),
    ],
  );
}

class _PaymentCard extends StatelessWidget {
  final Map<String, dynamic> payment;
  final bool cancelling;
  final VoidCallback onCancel;

  const _PaymentCard({required this.payment, required this.cancelling, required this.onCancel});

  @override
  Widget build(BuildContext context) {
    final paid = payment['status'] == 'paid';
    final color = paid ? Colors.green : Colors.orange;
    final euros = ((payment['amount_cents'] as num).toDouble() / 100).toStringAsFixed(2);
    final createdMs = payment['created_at_ms'];
    final paidMs = payment['paid_at_ms'];
    final createdAt = createdMs != null
        ? _fmt(DateTime.fromMillisecondsSinceEpoch(createdMs as int))
        : '—';
    final paidAt = paidMs != null
        ? _fmt(DateTime.fromMillisecondsSinceEpoch(paidMs as int))
        : null;
    final desc = payment['description'] as String? ?? '';

    return Card(
      color: const Color(0xFF16213e),
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: color.withOpacity(0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    payment['customer_name'] as String? ?? 'Sin nombre',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text('$euros €',
                    style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 16)),
              ],
            ),
            const SizedBox(height: 4),
            if (desc.isNotEmpty)
              Text(desc, style: const TextStyle(color: Colors.white70, fontSize: 13)),
            const SizedBox(height: 4),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    paid ? '✓ Pagado' : '⏳ Pendiente',
                    style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: 8),
                Text('ref. ${payment['reference']}',
                    style: const TextStyle(color: Colors.white38, fontSize: 11)),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              paid && paidAt != null ? 'Pagado: $paidAt' : 'Creado: $createdAt',
              style: const TextStyle(color: Colors.white38, fontSize: 11),
            ),
            if (!paid) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  if ((payment['payment_url'] as String? ?? '').isNotEmpty)
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          final url = Uri.parse(payment['payment_url'] as String);
                          if (await canLaunchUrl(url)) await launchUrl(url, mode: LaunchMode.externalApplication);
                        },
                        icon: const Icon(Icons.open_in_new, size: 14),
                        label: const Text('Ver enlace', style: TextStyle(fontSize: 12)),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white54,
                          side: const BorderSide(color: Colors.white24),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                        ),
                      ),
                    ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: cancelling ? null : onCancel,
                    icon: cancelling
                        ? const SizedBox(width: 14, height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.red))
                        : const Icon(Icons.cancel_outlined, size: 14),
                    label: Text(cancelling ? '...' : 'Cancelar', style: const TextStyle(fontSize: 12)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.redAccent,
                      side: const BorderSide(color: Colors.red),
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _fmt(DateTime dt) =>
      '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year.toString().substring(2)} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}
