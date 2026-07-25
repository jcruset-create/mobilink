import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Consulta (solo lectura) del catálogo de neumáticos para el técnico.
/// La medida viene ya filtrada por la del vehículo; el técnico solo busca
/// por marca y modelo.
class CatalogoScreen extends StatefulWidget {
  final Set<String> medidasBase; // medidas del vehículo, normalizadas. Vacío = todas.
  const CatalogoScreen({super.key, this.medidasBase = const {}});

  @override
  State<CatalogoScreen> createState() => _CatalogoScreenState();
}

class _CatalogoScreenState extends State<CatalogoScreen> {
  List<Map<String, dynamic>> _todas = [];
  bool _loading = true;
  String? _error;
  String _q = '';

  static String _baseMedida(String? s) {
    final t = (s ?? '').toUpperCase().replaceAll(RegExp(r'\s+'), '');
    final m = RegExp(r'(\d{2,3})(?:/(\d{2,3}))?R?(\d{1,2}(?:[.,]\d)?)').firstMatch(t);
    if (m == null) return t;
    final perfil = m.group(2);
    return '${m.group(1)}${perfil != null ? '/$perfil' : ''}R${m.group(3)!.replaceAll(',', '.')}';
  }

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await TyreControlApi.listarCatalogoReferencias();
      if (!mounted) return;
      setState(() { _todas = data; _loading = false; });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = '$e'; _loading = false; });
    }
  }

  List<Map<String, dynamic>> get _filtradas {
    final q = _q.trim().toLowerCase();
    final medidas = widget.medidasBase;
    final list = _todas.where((r) {
      if (medidas.isNotEmpty && !medidas.contains(_baseMedida(r['medida'] as String?))) return false;
      if (q.isEmpty) return true;
      final txt = '${r['marca'] ?? ''} ${r['modelo'] ?? ''}'.toLowerCase();
      return txt.contains(q);
    }).toList();
    list.sort((a, b) => '${a['marca']} ${a['modelo']}'.toLowerCase().compareTo('${b['marca']} ${b['modelo']}'.toLowerCase()));
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final medidaTxt = widget.medidasBase.isEmpty ? 'todas las medidas' : widget.medidasBase.join(' · ');
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Catálogo de neumáticos'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(22),
          child: Padding(
            padding: const EdgeInsets.only(left: 16, bottom: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Medida: $medidaTxt',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
            child: TextField(
              autofocus: false,
              onChanged: (v) => setState(() => _q = v),
              decoration: InputDecoration(
                hintText: 'Buscar marca o modelo…',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: AppColors.surface,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 12),
              ),
            ),
          ),
          Expanded(child: _cuerpo()),
        ],
      ),
    );
  }

  Widget _cuerpo() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('No se pudo cargar el catálogo.\n$_error',
              textAlign: TextAlign.center, style: const TextStyle(color: AppColors.danger)),
          const SizedBox(height: 12),
          FilledButton(onPressed: _cargar, child: const Text('Reintentar')),
        ]),
      );
    }
    final items = _filtradas;
    if (items.isEmpty) {
      return const Center(child: Text('Sin resultados para esta medida.', style: TextStyle(color: AppColors.textSecondary)));
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
      itemCount: items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) => _fila(items[i]),
    );
  }

  Widget _fila(Map<String, dynamic> r) {
    final foto = r['foto'] as String?;
    final prof = r['prof'] as double?;
    final pres = r['pres'] as double?;
    final carga = r['carga'] as double?;
    final ic = r['indice_carga']?.toString();
    final cv = r['codigo_vel']?.toString();
    final idxTxt = [if (ic != null && ic.isNotEmpty) ic, if (cv != null && cv.isNotEmpty) cv].join('');
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: 56, height: 56,
            child: foto != null && foto.isNotEmpty
                ? Image.network(foto, fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const _SinFoto())
                : const _SinFoto(),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r['marca'] ?? '—'} ${r['modelo'] ?? ''}'.trim(),
                style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 15),
                maxLines: 1, overflow: TextOverflow.ellipsis),
            Text('${r['medida'] ?? ''}${idxTxt.isNotEmpty ? '  $idxTxt' : ''}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            const SizedBox(height: 4),
            Wrap(spacing: 8, runSpacing: 4, children: [
              _chip(Icons.straighten, prof != null ? '${prof.toStringAsFixed(prof % 1 == 0 ? 0 : 1)} mm' : '— mm'),
              _chip(Icons.speed, pres != null ? '${pres.toStringAsFixed(1)} bar' : '— bar'),
              _chip(Icons.fitness_center, carga != null ? '${carga.toStringAsFixed(0)} kg' : '— kg'),
            ]),
          ]),
        ),
      ]),
    );
  }

  Widget _chip(IconData ic, String txt) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(ic, size: 13, color: AppColors.textSecondary),
        const SizedBox(width: 4),
        Text(txt, style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.5, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

class _SinFoto extends StatelessWidget {
  const _SinFoto();
  @override
  Widget build(BuildContext context) => Container(
        color: AppColors.surfaceVariant,
        child: const Icon(Icons.image_not_supported_outlined, color: AppColors.textHint, size: 22),
      );
}
