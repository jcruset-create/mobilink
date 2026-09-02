import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/firma_pad.dart';

/// Parte de servicio a partir de fotografías.
///
/// Es una VÍA DE ENTRADA OPCIONAL, no el camino normal: se usa cuando conviene
/// levantar el parte desde el móvil en vez de ir rueda por rueda. Termina en
/// una intervención con sus operaciones —lo que ya existe—, no en un documento
/// suelto.
///
/// Cinco pasos en una sola pantalla y no cinco pantallas: el técnico está de
/// pie al lado del camión y necesita ver dónde está y volver atrás sin perder
/// lo hecho.
///
/// LA IA PROPONE, EL TÉCNICO CONFIRMA. Nada se guarda hasta el último paso.
enum _Paso { fotos, revision, servicios, firmas, hecho }

/// Para qué es cada foto. Es opcional —el modelo mira todas igual— pero
/// clasificar ayuda al técnico a saber si le falta alguna.
enum _Tipo { matricula, cuentakilometros, vehiculo, neumatico }

const _ETIQUETA = {
  _Tipo.matricula: 'Matrícula',
  _Tipo.cuentakilometros: 'Cuentakilómetros',
  _Tipo.vehiculo: 'Vehículo',
  _Tipo.neumatico: 'Neumático',
};

class _Foto {
  final File fichero;
  _Tipo tipo;
  String? url;
  _Foto(this.fichero, this.tipo);
}

class ParteFotosScreen extends StatefulWidget {
  /// La intervención a la que se engancha el parte. Si no viene, el parte se
  /// revisa y se genera el PDF, pero no se guarda: sin intervención no hay
  /// dónde, y crear una a ciegas ataría el parte al vehículo equivocado.
  final String? intervencionId;
  const ParteFotosScreen({super.key, this.intervencionId});

  @override
  State<ParteFotosScreen> createState() => _ParteFotosScreenState();
}

class _ParteFotosScreenState extends State<ParteFotosScreen> {
  _Paso _paso = _Paso.fotos;
  bool _trabajando = false;
  String? _error;
  bool _hayIA = false;

  final List<_Foto> _fotos = [];
  final String _carpeta = DateTime.now().millisecondsSinceEpoch.toString();

  // Lo leído, ya confirmable.
  final _matricula = TextEditingController();
  final _km = TextEditingController();
  final _vehiculo = TextEditingController();
  final _flota = TextEditingController();
  List<Map<String, dynamic>> _neumaticos = [];
  List<String> _avisos = [];
  List<String> _dudosos = [];

  // Servicios y firmas.
  List<Map<String, dynamic>> _catServicios = [];
  final Map<String, num> _cantidades = {};
  final _nombreCliente = TextEditingController();
  final _dniCliente = TextEditingController();
  final _nombreTecnico = TextEditingController();
  Uint8List? _firmaCliente;
  Uint8List? _firmaTecnico;

  @override
  void initState() {
    super.initState();
    TyreControlApi.parteDisponible().then((v) { if (mounted) setState(() => _hayIA = v); });
    TyreControlApi.listarServiciosCatalogo()
        .then((v) { if (mounted) setState(() => _catServicios = v); })
        .catchError((_) => <Map<String, dynamic>>[]);
  }

  @override
  void dispose() {
    for (final c in [_matricula, _km, _vehiculo, _flota,
                     _nombreCliente, _dniCliente, _nombreTecnico]) {
      c.dispose();
    }
    super.dispose();
  }

  // ── Paso 1: las fotos ──────────────────────────────────────────────────────
  Future<void> _añadir(ImageSource origen, _Tipo tipo) async {
    final picker = ImagePicker();
    if (origen == ImageSource.gallery) {
      final varias = await picker.pickMultiImage(imageQuality: 85);
      if (varias.isEmpty) return;
      setState(() => _fotos.addAll(varias.map((x) => _Foto(File(x.path), tipo))));
      return;
    }
    final una = await picker.pickImage(source: ImageSource.camera, imageQuality: 85);
    if (una == null) return;
    setState(() => _fotos.add(_Foto(File(una.path), tipo)));
  }

  Future<void> _analizar() async {
    if (_fotos.isEmpty) { setState(() => _error = 'Haz alguna fotografía primero'); return; }
    setState(() { _trabajando = true; _error = null; });
    try {
      // Se suben primero: el servidor lee de una URL de Mobilink, no recibe la
      // imagen suelta, y así la foto queda guardada con el parte.
      for (final f in _fotos) {
        f.url ??= await TyreControlApi.subirFotoParte(f.fichero, carpeta: _carpeta);
      }
      final r = await TyreControlApi.leerParte(
          _fotos.map((f) => f.url!).toList(growable: false));
      if (!mounted) return;
      setState(() {
        _matricula.text = (r['plate'] ?? '') as String? ?? '';
        _km.text = (r['kilometers'] ?? '') as String? ?? '';
        _vehiculo.text = (r['vehicle'] ?? '') as String? ?? '';
        _flota.text = (r['fleet'] ?? '') as String? ?? '';
        _neumaticos = ((r['tires'] as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _avisos = ((r['warnings'] as List?) ?? const []).map((e) => e.toString()).toList();
        _dudosos = ((r['dudosos'] as List?) ?? const []).map((e) => e.toString()).toList();
        _paso = _Paso.revision;
      });
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido analizar: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  // ── Guardar, al final ──────────────────────────────────────────────────────
  Future<void> _guardar() async {
    final id = widget.intervencionId;
    if (id == null) { setState(() => _paso = _Paso.hecho); return; }
    setState(() { _trabajando = true; _error = null; });
    try {
      final datos = <String, dynamic>{
        'firma_cliente_nombre': _nombreCliente.text.trim(),
        'firma_cliente_dni': _dniCliente.text.trim(),
        'firma_tecnico_nombre': _nombreTecnico.text.trim(),
        'firmado_at': DateTime.now().toUtc().toIso8601String(),
      };
      if (_firmaCliente != null) {
        datos['firma_cliente_url'] = await TyreControlApi.subirFirma(
            _firmaCliente!, intervencionId: id, quien: 'cliente');
      }
      if (_firmaTecnico != null) {
        datos['firma_tecnico_url'] = await TyreControlApi.subirFirma(
            _firmaTecnico!, intervencionId: id, quien: 'tecnico');
      }
      await TyreControlApi.guardarCabeceraParte(id, datos);
      await TyreControlApi.guardarServiciosParte(id, _cantidades);
      if (mounted) setState(() => _paso = _Paso.hecho);
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido guardar: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Future<void> _abrirPdf() async {
    final id = widget.intervencionId;
    if (id == null) return;
    setState(() { _trabajando = true; _error = null; });
    try {
      final u = Uri.parse(await TyreControlApi.enlacePdfParte(id));
      if (!await launchUrl(u, mode: LaunchMode.externalApplication)) {
        if (mounted) setState(() => _error = 'No se ha podido abrir el PDF');
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido generar el PDF: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  // ── Pintado ────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Parte por fotos'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(
            value: (_Paso.values.indexOf(_paso) + 1) / _Paso.values.length,
            minHeight: 4,
          ),
        ),
      ),
      body: AbsorbPointer(
        absorbing: _trabajando,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (_error != null)
            Padding(padding: const EdgeInsets.only(bottom: 10),
              child: Text(_error!, style: const TextStyle(color: AppColors.danger))),
          if (_trabajando)
            const Padding(padding: EdgeInsets.only(bottom: 12), child: LinearProgressIndicator()),
          ..._contenido(),
          const SizedBox(height: 24),
        ]),
      ),
    );
  }

  List<Widget> _contenido() {
    switch (_paso) {
      case _Paso.fotos: return _pasoFotos();
      case _Paso.revision: return _pasoRevision();
      case _Paso.servicios: return _pasoServicios();
      case _Paso.firmas: return _pasoFirmas();
      case _Paso.hecho: return _pasoHecho();
    }
  }

  List<Widget> _pasoFotos() => [
    const Text('Fotografías del parte', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
    const SizedBox(height: 4),
    const Text('Matrícula, cuentakilómetros y el flanco de cada neumático. '
               'Varias fotos de la misma rueda ayudan: se juntan solas.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
    const SizedBox(height: 12),
    for (final t in _Tipo.values)
      Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(children: [
          Expanded(child: Text(_ETIQUETA[t]!, style: const TextStyle(fontWeight: FontWeight.w600))),
          IconButton(
            tooltip: 'Cámara',
            icon: const Icon(Icons.photo_camera_outlined),
            onPressed: () => _añadir(ImageSource.camera, t),
          ),
          IconButton(
            tooltip: 'Galería',
            icon: const Icon(Icons.photo_library_outlined),
            onPressed: () => _añadir(ImageSource.gallery, t),
          ),
        ]),
      ),
    if (_fotos.isNotEmpty) ...[
      const SizedBox(height: 8),
      Text('${_fotos.length} fotografía${_fotos.length == 1 ? '' : 's'}',
          style: const TextStyle(fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final f in _fotos)
          Stack(children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.file(f.fichero, width: 88, height: 88, fit: BoxFit.cover),
            ),
            Positioned(
              right: 0, top: 0,
              child: InkWell(
                onTap: () => setState(() => _fotos.remove(f)),
                child: Container(
                  padding: const EdgeInsets.all(2),
                  decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                  child: const Icon(Icons.close, size: 14, color: Colors.white),
                ),
              ),
            ),
            Positioned(
              left: 2, bottom: 2,
              child: Container(
                color: Colors.black54,
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: Text(_ETIQUETA[f.tipo]!,
                    style: const TextStyle(fontSize: 9, color: Colors.white)),
              ),
            ),
          ]),
      ]),
    ],
    const SizedBox(height: 16),
    if (!_hayIA)
      const Text('La lectura automática no está disponible ahora mismo. '
                 'Puedes seguir y rellenar el parte a mano.',
          style: TextStyle(fontSize: 12, color: AppColors.warning)),
    const SizedBox(height: 8),
    FilledButton.icon(
      onPressed: _hayIA ? _analizar : () => setState(() => _paso = _Paso.revision),
      icon: Icon(_hayIA ? Icons.auto_awesome : Icons.edit_outlined),
      label: Text(_hayIA ? 'Analizar las fotografías' : 'Rellenar a mano'),
    ),
  ];

  Widget _campo(TextEditingController c, String etiqueta, String clave) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: TextField(
      controller: c,
      decoration: InputDecoration(
        labelText: etiqueta,
        // Lo que se leyó con poca seguridad se dice: es la diferencia entre
        // "el flanco no lo llevaba" y "había algo y no se leyó".
        helperText: _dudosos.contains(clave) ? 'No se ha leído con seguridad: complétalo tú' : null,
        helperStyle: const TextStyle(color: AppColors.warning),
      ),
    ),
  );

  List<Widget> _pasoRevision() => [
    const Text('Revisa lo leído', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
    const SizedBox(height: 4),
    const Text('La lectura automática se equivoca. Nada se guarda hasta que lo confirmes.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
    if (_avisos.isNotEmpty) ...[
      const SizedBox(height: 8),
      for (final a in _avisos)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.warning_amber_rounded, size: 14, color: AppColors.warning),
          const SizedBox(width: 4),
          Expanded(child: Text(a, style: const TextStyle(fontSize: 12, color: AppColors.warning))),
        ]),
    ],
    const SizedBox(height: 12),
    _campo(_matricula, 'Matrícula', 'plate'),
    _campo(_km, 'Kilómetros', 'kilometers'),
    _campo(_vehiculo, 'Vehículo', 'vehicle'),
    _campo(_flota, 'Flota / cliente', 'fleet'),
    const SizedBox(height: 16),
    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Text('Neumáticos (${_neumaticos.length})',
          style: const TextStyle(fontWeight: FontWeight.w800)),
      TextButton.icon(
        onPressed: () => setState(() => _neumaticos.add(<String, dynamic>{})),
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Añadir'),
      ),
    ]),
    for (int i = 0; i < _neumaticos.length; i++) _tarjetaNeumatico(i),
    const SizedBox(height: 16),
    FilledButton(
      onPressed: () => setState(() => _paso = _Paso.servicios),
      child: const Text('Continuar'),
    ),
    TextButton(onPressed: () => setState(() => _paso = _Paso.fotos), child: const Text('Volver a las fotos')),
  ];

  Widget _tarjetaNeumatico(int i) {
    final n = _neumaticos[i];
    final conf = (n['confidence'] as num?)?.toDouble();
    final dudosos = ((n['dudosos'] as List?) ?? const []).map((e) => e.toString()).toList();
    Widget campo(String clave, String etiqueta) => TextFormField(
      initialValue: (n[clave] ?? '') as String? ?? '',
      decoration: InputDecoration(
        labelText: etiqueta, isDense: true,
        helperText: dudosos.contains(clave) ? 'Dudoso' : null,
        helperStyle: const TextStyle(color: AppColors.warning, fontSize: 10),
      ),
      onChanged: (v) => n[clave] = v,
    );
    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('Neumático ${i + 1}',
                style: const TextStyle(fontWeight: FontWeight.w700))),
            // Una lectura floja se dice en la propia tarjeta: es donde se
            // decide si mirar el flanco otra vez.
            if (conf != null && conf < 0.7)
              const Text('Lectura poco fiable',
                  style: TextStyle(fontSize: 11, color: AppColors.warning)),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 18),
              onPressed: () => setState(() => _neumaticos.removeAt(i)),
            ),
          ]),
          campo('brand', 'Marca'),
          campo('model', 'Modelo'),
          campo('dimension', 'Dimensión'),
          campo('serial_number', 'Nº de serie / DOT'),
          campo('position', 'Posición'),
        ]),
      ),
    );
  }

  List<Widget> _pasoServicios() => [
    const Text('Servicios realizados', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
    const SizedBox(height: 4),
    const Text('Lo que se factura. Deja en blanco lo que no se haya hecho.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
    const SizedBox(height: 8),
    if (_catServicios.isEmpty)
      const Text('No se ha podido cargar la lista de servicios. Se puede seguir sin ella.',
          style: TextStyle(fontSize: 12, color: AppColors.warning)),
    for (final s in _catServicios)
      Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          Expanded(child: Text((s['nombre'] ?? '') as String? ?? '')),
          SizedBox(
            width: 90,
            child: TextFormField(
              initialValue: _cantidades[s['codigo']]?.toString() ?? '',
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textAlign: TextAlign.right,
              decoration: InputDecoration(
                isDense: true,
                // La unidad al lado del número: 1,5 en horas y en unidades no
                // quieren decir lo mismo.
                suffixText: (s['unidad'] ?? '') as String? ?? '',
              ),
              onChanged: (v) {
                final n = num.tryParse(v.replaceAll(',', '.'));
                setState(() {
                  if (n == null || n <= 0) {
                    _cantidades.remove(s['codigo']);
                  } else {
                    _cantidades[s['codigo'] as String] = n;
                  }
                });
              },
            ),
          ),
        ]),
      ),
    const SizedBox(height: 16),
    FilledButton(onPressed: () => setState(() => _paso = _Paso.firmas), child: const Text('Continuar')),
    TextButton(onPressed: () => setState(() => _paso = _Paso.revision), child: const Text('Atrás')),
  ];

  List<Widget> _pasoFirmas() => [
    const Text('Firmas', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
    const SizedBox(height: 12),
    TextField(controller: _nombreCliente, decoration: const InputDecoration(labelText: 'Nombre del cliente')),
    TextField(controller: _dniCliente, decoration: const InputDecoration(labelText: 'DNI')),
    const SizedBox(height: 12),
    FirmaPad(titulo: 'Firma del cliente', onFirma: (b) => _firmaCliente = b),
    const SizedBox(height: 20),
    TextField(controller: _nombreTecnico, decoration: const InputDecoration(labelText: 'Nombre del técnico')),
    const SizedBox(height: 12),
    FirmaPad(titulo: 'Firma del técnico', onFirma: (b) => _firmaTecnico = b),
    const SizedBox(height: 20),
    if (widget.intervencionId == null)
      const Text('Este parte no está enganchado a ninguna intervención, así que no se '
                 'guardará. Ábrelo desde una intervención para poder guardarlo.',
          style: TextStyle(fontSize: 12, color: AppColors.warning)),
    FilledButton.icon(
      onPressed: _guardar,
      icon: const Icon(Icons.check),
      label: const Text('Guardar el parte'),
    ),
    TextButton(onPressed: () => setState(() => _paso = _Paso.servicios), child: const Text('Atrás')),
  ];

  List<Widget> _pasoHecho() => [
    const SizedBox(height: 20),
    const Icon(Icons.check_circle_outline, size: 56, color: AppColors.success),
    const SizedBox(height: 12),
    const Center(child: Text('Parte guardado',
        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18))),
    const SizedBox(height: 20),
    if (widget.intervencionId != null)
      FilledButton.icon(
        onPressed: _abrirPdf,
        icon: const Icon(Icons.picture_as_pdf_outlined),
        label: const Text('Ver el PDF del parte'),
      ),
    TextButton(
      onPressed: () => Navigator.of(context).pop(true),
      child: const Text('Terminar'),
    ),
  ];
}
