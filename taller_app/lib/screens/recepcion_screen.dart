import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/api_service.dart';
import '../theme.dart';
import '../workshops.dart';

const _areas = ['camion', 'movil', 'tacografo', 'turismo', 'mecanica'];

/// Recepción de un vehículo en el patio.
///
/// Esto NO crea un trabajo. Recoge lo que el operario ve —una matrícula, quizá
/// un cliente, quizá una foto— y lo manda a la bandeja de WorkPlanner, donde
/// una persona decide si sale trabajo de ahí y con qué operación.
///
/// No se enseñan precios, tarifas ni importes: el catálogo llega del servidor
/// ya sin ellos.
class RecepcionScreen extends StatefulWidget {
  final ApiService api;
  const RecepcionScreen({super.key, required this.api});

  @override
  State<RecepcionScreen> createState() => _RecepcionScreenState();
}

class _RecepcionScreenState extends State<RecepcionScreen> {
  final _matriculaCtrl = TextEditingController();
  final _clienteCtrl = TextEditingController();
  final _notasCtrl = TextEditingController();

  String _workshopId = kWorkshops.first['id']!;
  String? _area;
  String? _plantillaKey;
  bool _urgente = false;

  /// Lo que leyó la IA, para guardarlo junto a lo que confirmó la persona.
  String? _matriculaOcr;
  double? _confianzaOcr;

  List<Map<String, dynamic>> _catalogo = [];
  final List<XFile> _fotos = [];
  bool _leyendo = false;
  bool _enviando = false;
  String? _error;
  String? _vehiculoId;
  String? _vehiculoOrigen;
  String? _avisoVehiculo;

  @override
  void initState() {
    super.initState();
    _cargarCatalogo();
  }

  @override
  void dispose() {
    _matriculaCtrl.dispose();
    _clienteCtrl.dispose();
    _notasCtrl.dispose();
    super.dispose();
  }

  Future<void> _cargarCatalogo() async {
    final c = await widget.api.getCatalogoRecepcion();
    if (!mounted) return;
    setState(() => _catalogo = c);
  }

  List<Map<String, dynamic>> get _operaciones => _area == null
      ? _catalogo
      : _catalogo.where((p) => p['area'] == _area).toList();

  /// Foto de la matrícula → OCR → campo editable.
  ///
  /// Lo que devuelve la IA se ESCRIBE en el campo para que el operario lo vea
  /// y lo corrija. Nunca se envía una matrícula leída sin enseñarla antes.
  Future<void> _fotoDeMatricula() async {
    final shot = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 85,
      maxWidth: 1600,
    );
    if (shot == null) return;

    setState(() {
      _leyendo = true;
      _error = null;
    });
    try {
      final bytes = await File(shot.path).readAsBytes();
      final leido = await widget.api
          .leerMatricula('data:image/jpeg;base64,${base64Encode(bytes)}');
      if (!mounted) return;

      final matricula = leido?['matricula']?.toString() ?? '';
      final confianza = (leido?['confianza'] as num?)?.toDouble() ?? 0;

      setState(() {
        _fotos.add(shot);
        _leyendo = false;
        if (matricula.isNotEmpty && confianza >= 0.7) {
          _matriculaCtrl.text = matricula;
          _matriculaOcr = matricula;
          _confianzaOcr = confianza;
        } else {
          // Lectura dudosa: mejor que la escriba quien está delante del coche.
          _error = 'No se ha podido leer la matrícula. Escríbela a mano.';
        }
      });
      if (_matriculaCtrl.text.isNotEmpty) await _buscarVehiculo();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _leyendo = false;
        _error = 'No se ha podido leer la matrícula. Escríbela a mano.';
      });
    }
  }

  Future<void> _otraFoto() async {
    final shot = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 85,
      maxWidth: 1600,
    );
    if (shot == null || !mounted) return;
    setState(() => _fotos.add(shot));
  }

  Future<void> _buscarVehiculo() async {
    final matricula = _matriculaCtrl.text.trim();
    if (matricula.length < 4) return;
    final v = await widget.api.buscarVehiculo(matricula);
    if (!mounted) return;
    setState(() {
      if (v == null) {
        _vehiculoId = null;
        _vehiculoOrigen = null;
        _avisoVehiculo = null;
        return;
      }
      _vehiculoId = v['id']?.toString();
      _vehiculoOrigen = v['origen']?.toString();
      final cliente = v['clienteNombre']?.toString() ?? '';
      if (cliente.isNotEmpty && _clienteCtrl.text.trim().isEmpty) {
        _clienteCtrl.text = cliente;
      }
      _avisoVehiculo = 'Vehículo conocido${cliente.isEmpty ? '' : ': $cliente'}';
    });
  }

  Future<void> _enviar() async {
    final matricula = _matriculaCtrl.text.trim().toUpperCase();
    if (matricula.isEmpty) {
      setState(() => _error = 'La matrícula es obligatoria.');
      return;
    }
    setState(() {
      _enviando = true;
      _error = null;
    });

    final operacion = _operaciones.firstWhere(
      (p) => p['key'] == _plantillaKey,
      orElse: () => const <String, dynamic>{},
    );

    try {
      final recepcionId = await widget.api.crearRecepcion({
        'matricula': matricula,
        'workshopId': _workshopId,
        'clienteNombre': _clienteCtrl.text.trim(),
        'area': _area,
        'plantillaKey': _plantillaKey,
        'operacionLabel': operacion['label'],
        'notas': _notasCtrl.text.trim(),
        'urgente': _urgente,
        'vehiculoId': _vehiculoId,
        'vehiculoOrigen': _vehiculoOrigen,
        'matriculaOcr': _matriculaOcr,
        'confianzaOcr': _confianzaOcr,
      });

      // Las fotos se cuelgan después, porque hasta ahora no había recepción a
      // la que colgarlas. Si la recepción quedó en la cola no hay id todavía,
      // y eso se dice en pantalla en vez de dejar creer que se enviaron.
      var fotosFallidas = 0;
      if (recepcionId != null) {
        for (final foto in _fotos) {
          final ok = await widget.api.subirFotoRecepcion(recepcionId, foto.path);
          if (!ok) fotosFallidas++;
        }
      }

      if (!mounted) return;
      final String mensaje;
      if (recepcionId == null) {
        mensaje = _fotos.isEmpty
            ? 'Sin cobertura: guardado y se enviará solo al recuperarla.'
            : 'Sin cobertura: guardado sin las fotos, se enviará solo al '
                'recuperarla.';
      } else if (fotosFallidas > 0) {
        mensaje = 'Recibido, pero $fotosFallidas foto(s) no han subido. '
            'Avisa en oficina.';
      } else {
        mensaje = 'Recibido. Pendiente de validar en oficina.';
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _enviando = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recepción de vehículo')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            ),

          FilledButton.icon(
            onPressed: _leyendo ? null : _fotoDeMatricula,
            icon: _leyendo
                ? const SizedBox(
                    width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.photo_camera),
            label: Text(_leyendo ? 'Leyendo…' : 'Foto de la matrícula'),
          ),
          const SizedBox(height: 12),

          TextField(
            controller: _matriculaCtrl,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: 'Matrícula',
              helperText: 'Compruébala antes de enviar.',
            ),
            onSubmitted: (_) => _buscarVehiculo(),
            onEditingComplete: _buscarVehiculo,
          ),
          if (_avisoVehiculo != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(_avisoVehiculo!,
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
            ),
          const SizedBox(height: 12),

          TextField(
            controller: _clienteCtrl,
            decoration: const InputDecoration(labelText: 'Cliente'),
          ),
          const SizedBox(height: 12),

          DropdownButtonFormField<String>(
            initialValue: _workshopId,
            decoration: const InputDecoration(labelText: 'Taller'),
            items: kWorkshops
                .map((w) => DropdownMenuItem(
                      value: w['id'],
                      child: Text(w['name'] ?? w['id']!),
                    ))
                .toList(),
            onChanged: (v) => setState(() => _workshopId = v ?? _workshopId),
          ),
          const SizedBox(height: 12),

          DropdownButtonFormField<String>(
            initialValue: _area,
            decoration: const InputDecoration(labelText: 'Área'),
            items: _areas
                .map((a) => DropdownMenuItem(value: a, child: Text(a)))
                .toList(),
            onChanged: (v) => setState(() {
              _area = v;
              _plantillaKey = null; // el área manda: la operación se reelige
            }),
          ),
          const SizedBox(height: 12),

          DropdownButtonFormField<String>(
            initialValue: _plantillaKey,
            decoration: const InputDecoration(
              labelText: 'Operación',
              helperText: 'Si no la sabes, déjala sin elegir.',
            ),
            items: _operaciones
                .map((p) => DropdownMenuItem(
                      value: p['key']?.toString(),
                      child: Text(p['label']?.toString() ?? ''),
                    ))
                .toList(),
            onChanged: (v) => setState(() => _plantillaKey = v),
          ),
          const SizedBox(height: 12),

          TextField(
            controller: _notasCtrl,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Notas'),
          ),
          const SizedBox(height: 12),

          SwitchListTile(
            value: _urgente,
            onChanged: (v) => setState(() => _urgente = v),
            title: const Text('Urgente'),
            contentPadding: EdgeInsets.zero,
          ),

          OutlinedButton.icon(
            onPressed: _otraFoto,
            icon: const Icon(Icons.add_a_photo),
            label: Text(_fotos.isEmpty
                ? 'Fotos del estado del vehículo'
                : '${_fotos.length} foto(s) — añadir otra'),
          ),
          const SizedBox(height: 24),

          FilledButton(
            onPressed: _enviando ? null : _enviar,
            child: Text(_enviando ? 'Enviando…' : 'Enviar a recepción'),
          ),
        ],
      ),
    );
  }
}
