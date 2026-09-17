import 'package:flutter/material.dart';

import '../services/supabase_service.dart';
import 'etiquetas_captura_screen.dart';

/// Los lotes de etiquetado del cliente activo.
///
/// Un lote es una tanda de gomas nuevas: el operario abre lote, fotografía
/// una rueda detrás de otra y cierra. Después, en el panel, una persona revisa
/// los números y los imprime.
///
/// ESTA PANTALLA NO DA DE ALTA NEUMÁTICOS. No crea nada en el inventario, no
/// monta, no mueve stock y no genera coste: guarda fotos y números leídos. Una
/// goma etiquetada sigue sin existir en TyreControl hasta que alguien la monta
/// por el camino de siempre.
class EtiquetasScreen extends StatefulWidget {
  const EtiquetasScreen({super.key});

  @override
  State<EtiquetasScreen> createState() => _EtiquetasScreenState();
}

class _EtiquetasScreenState extends State<EtiquetasScreen> {
  List<Map<String, dynamic>> _lotes = const [];
  bool _cargando = true;
  bool _abriendo = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { _cargando = true; _error = null; });
    try {
      final l = await TyreControlApi.lotesDeEtiquetas();
      await TyreControlApi.contarEtiquetasPorRevisar();
      if (mounted) setState(() { _lotes = l; _cargando = false; });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _cargando = false; });
    }
  }

  Future<void> _nuevoLote() async {
    if (_abriendo) return;
    setState(() => _abriendo = true);
    try {
      final lote = await TyreControlApi.abrirLoteEtiquetas();
      if (!mounted) return;
      await _abrir(lote['id'] as String, lote['codigo'] as String);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('No se ha podido abrir el lote: $e')));
      }
    } finally {
      if (mounted) setState(() => _abriendo = false);
    }
  }

  Future<void> _abrir(String id, String codigo) async {
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => EtiquetasCapturaScreen(loteId: id, codigo: codigo)));
    await _cargar();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Etiquetar neumáticos')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _abriendo ? null : _nuevoLote,
        icon: const Icon(Icons.add_a_photo_outlined),
        label: Text(_abriendo ? 'Abriendo…' : 'Nuevo lote'),
      ),
      body: SafeArea(
        child: _cargando
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _cargar,
                child: _error != null
                    ? ListView(children: [
                        Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text('No se han podido leer los lotes.\n$_error',
                              textAlign: TextAlign.center),
                        ),
                      ])
                    : _lotes.isEmpty
                        ? ListView(children: const [
                            Padding(
                              padding: EdgeInsets.all(32),
                              child: Text(
                                'Todavía no hay lotes.\n\n'
                                'Abre uno y fotografía el flanco de cada goma nueva: '
                                'el número de serie se lee solo y las etiquetas se '
                                'imprimen desde el panel.',
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ])
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                            itemCount: _lotes.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (_, i) => _FilaLote(
                              lote: _lotes[i],
                              onTap: () => _abrir(_lotes[i]['id'] as String,
                                  _lotes[i]['codigo'] as String),
                            ),
                          ),
              ),
      ),
    );
  }
}

class _FilaLote extends StatelessWidget {
  const _FilaLote({required this.lote, required this.onTap});
  final Map<String, dynamic> lote;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final abierto = lote['estado'] == 'abierto';
    final fotos = (lote['fotos'] as int?) ?? 0;
    final porRevisar = (lote['por_revisar'] as int?) ?? 0;
    final impresas = (lote['impresas'] as int?) ?? 0;

    // Se dice lo que hay, no un porcentaje: «12 fotos · 3 por revisar» es lo
    // que el operario necesita saber para decidir si vuelve al lote.
    final partes = <String>[
      '$fotos ${fotos == 1 ? 'foto' : 'fotos'}',
      if (porRevisar > 0) '$porRevisar por revisar',
      if (impresas > 0) '$impresas impresas',
    ];

    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        onTap: onTap,
        leading: Icon(abierto ? Icons.folder_open_outlined : Icons.folder_outlined),
        title: Text(lote['codigo'] as String? ?? '',
            style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(partes.join(' · ')),
        trailing: abierto
            ? const Chip(label: Text('Abierto'), visualDensity: VisualDensity.compact)
            : const Icon(Icons.chevron_right),
      ),
    );
  }
}
