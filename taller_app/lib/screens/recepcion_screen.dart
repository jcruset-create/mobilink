import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';

import '../services/api_service.dart';
import '../theme.dart';

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

  /// Cita de la agenda de la que sale esta recepción, si el operario la eligió
  /// en la pantalla anterior. Con ella se prellena el formulario y, al
  /// convertir, la cita queda cerrada para que no salgan dos trabajos.
  final Map<String, dynamic>? cita;

  const RecepcionScreen({super.key, required this.api, this.cita});

  @override
  State<RecepcionScreen> createState() => _RecepcionScreenState();
}

class _RecepcionScreenState extends State<RecepcionScreen> {
  final _matriculaCtrl = TextEditingController();
  final _kmCtrl = TextEditingController();
  final _clienteCtrl = TextEditingController();
  final _telefonoCtrl = TextEditingController();
  final _notasCtrl = TextEditingController();

  String? _area;
  String? _plantillaKey;
  bool _urgente = false;

  /// Lo que leyó la IA, para guardarlo junto a lo que confirmó la persona.
  String? _matriculaOcr;
  double? _confianzaOcr;
  int? _kilometrosOcr;
  double? _confianzaKmOcr;

  List<Map<String, dynamic>> _catalogo = [];
  final List<XFile> _fotos = [];
  bool _leyendo = false;
  bool _leyendoKm = false;
  bool _enviando = false;
  String? _error;

  /// Aviso en ámbar: algo que conviene mirar, pero que no impide enviar. El
  /// rojo se reserva para lo que hay que arreglar antes de seguir.
  String? _aviso;
  String? _vehiculoId;
  String? _vehiculoOrigen;
  String? _avisoVehiculo;

  @override
  void initState() {
    super.initState();
    // Lo que trae la cita se ESCRIBE en los campos, no se guarda aparte: el
    // operario tiene el vehículo delante y es quien confirma que la matrícula
    // de la agenda es la que está viendo. Una cita con la matrícula mal puesta
    // se corrige aquí, no en la oficina.
    final cita = widget.cita;
    if (cita != null) {
      _matriculaCtrl.text = (cita['plate'] ?? '').toString().toUpperCase();
      _clienteCtrl.text = (cita['customerName'] ?? '').toString();
      _telefonoCtrl.text = (cita['customerPhone'] ?? '').toString();
      final area = (cita['area'] ?? '').toString();
      if (_areas.contains(area)) _area = area;
      final key = (cita['templateKey'] ?? '').toString();
      if (key.isNotEmpty) _plantillaKey = key;
    }
    _cargarCatalogo();
  }

  @override
  void dispose() {
    _matriculaCtrl.dispose();
    _kmCtrl.dispose();
    _clienteCtrl.dispose();
    _telefonoCtrl.dispose();
    _notasCtrl.dispose();
    super.dispose();
  }

  Future<void> _cargarCatalogo() async {
    try {
      final c = await widget.api.getCatalogoRecepcion();
      if (!mounted) return;
      setState(() => _catalogo = c);
    } catch (e) {
      if (!mounted) return;
      // Un desplegable vacío y apagado no dice nada. Si el catálogo ha fallado
      // se dice, y la recepción se puede enviar igual sin operación.
      setState(() => _error =
          'No se ha podido cargar el catálogo de operaciones. Puedes enviar '
          'la recepción sin elegirla.');
    }
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
      _aviso = null;
    });
    try {
      final bytes = await _bytesParaLeer(shot.path);
      final leido = await widget.api
          .leerMatricula('data:image/jpeg;base64,${base64Encode(bytes)}');
      if (!mounted) return;

      final matricula = leido['matricula']?.toString() ?? '';
      final confianza = (leido['confianza'] as num?)?.toDouble() ?? 0;

      setState(() {
        _fotos.add(shot);
        _leyendo = false;
        if (matricula.isNotEmpty) {
          /*
           * Se escribe SIEMPRE que haya lectura, sin mirar la confianza.
           *
           * Ese número no sirve: se comprobó que con una foto mala el modelo
           * leyó 4810CCV donde ponía 4610CCV y lo dio con 0.99. Filtrar por
           * él no quitaba ni un error, solo dejaba al operario sin lectura de
           * vez en cuando y obligándole a teclear.
           *
           * Así que la lectura se enseña y quien tiene el vehículo delante la
           * confirma, que es para lo que el campo es editable.
           */
          _matriculaCtrl.text = matricula;
          _matriculaOcr = matricula;
          _confianzaOcr = confianza;
          _aviso = 'Matrícula leída de la foto. Compruébala: se equivoca.';
        } else {
          _error = 'En esa foto no se ve ninguna matrícula. '
              'Repite la foto o escríbela a mano.';
        }
      });
      if (_matriculaCtrl.text.isNotEmpty) await _buscarVehiculo();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _leyendo = false;
        // No es lo mismo que la foto no valga: aquí no se ha podido ni
        // preguntar. Decirlo evita repetir la foto diez veces sin cobertura.
        _error = 'No se ha podido conectar para leer la matrícula. '
            'Escríbela a mano y envía igual.';
      });
    }
  }

  /// La foto que se manda a leer, comprimida.
  ///
  /// Se enviaba el fichero tal cual salía de la cámara y codificado en base64,
  /// que engorda otro tercio: casi un mega por lectura, desde el patio y con
  /// la cobertura que haya. Comprimir es lo que ya hacía la subida de fotos;
  /// aquí faltaba.
  ///
  /// Si la compresión falla se manda el original: más vale una lectura lenta
  /// que ninguna.
  Future<List<int>> _bytesParaLeer(String ruta) async {
    try {
      final comprimida = await FlutterImageCompress.compressWithFile(
        ruta,
        quality: 70,
        minWidth: 1280,
        minHeight: 1280,
      );
      if (comprimida != null) return comprimida;
    } catch (_) {
      /* se sigue con el original */
    }
    return File(ruta).readAsBytes();
  }

  /// Tope de sensatez, el mismo que aplica el servidor al convertir.
  ///
  /// Un camión pasa del millón sin despeinarse, así que no puede ser bajo;
  /// pero un OCR de un cuadro con reflejos se come un dígito o se inventa
  /// otro, y un kilometraje absurdo contamina el histórico del vehículo.
  static const int _kmMaximos = 3000000;

  int? _kmSensatos(Object? valor) {
    final crudo = valor?.toString().replaceAll(RegExp(r'[^0-9]'), '') ?? '';
    if (crudo.isEmpty) return null;
    final km = int.tryParse(crudo);
    // El cero se descarta: un cuentakilómetros a cero es casi siempre una
    // lectura fallida, no un vehículo recién matriculado entrando al taller.
    if (km == null || km <= 0 || km > _kmMaximos) return null;
    return km;
  }

  /// Foto del cuadro → OCR → campo editable, igual que la matrícula.
  Future<void> _fotoDeKilometros() async {
    final shot = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 85,
      maxWidth: 1600,
    );
    if (shot == null) return;

    setState(() {
      _leyendoKm = true;
      _error = null;
    });
    try {
      final bytes = await _bytesParaLeer(shot.path);
      final leido = await widget.api
          .leerKilometros('data:image/jpeg;base64,${base64Encode(bytes)}');
      if (!mounted) return;

      final confianza = (leido['confianza'] as num?)?.toDouble() ?? 0;
      // Sin mirar la confianza, por lo mismo que la matrícula. Lo que sí se
      // mira es que el número sea posible: un cuentakilómetros no marca cero
      // ni tres millones.
      final km = _kmSensatos(leido['kilometros']);

      setState(() {
        _fotos.add(shot);
        _leyendoKm = false;
        if (km != null) {
          _kmCtrl.text = km.toString();
          _kilometrosOcr = km;
          _confianzaKmOcr = confianza;
          _aviso = 'Kilómetros leídos de la foto. Compruébalos.';
        } else {
          _error = 'En esa foto no se ve el cuentakilómetros. '
              'Repite la foto o escríbelos a mano.';
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _leyendoKm = false;
        _error = 'No se ha podido conectar para leer los kilómetros. '
            'Escríbelos a mano y envía igual.';
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
        'clienteNombre': _clienteCtrl.text.trim(),
        'clienteTelefono': _telefonoCtrl.text.trim(),
        'kilometros': _kmSensatos(_kmCtrl.text),
        'kilometrosOcr': _kilometrosOcr,
        'confianzaKilometrosOcr': _confianzaKmOcr,
        'area': _area,
        'plantillaKey': _plantillaKey,
        'operacionLabel': operacion['label'],
        'notas': _notasCtrl.text.trim(),
        'urgente': _urgente,
        'scheduledJobId': widget.cita?['id'],
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
          if (widget.cita != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                'Cita de las ${widget.cita!['startTime'] ?? ''}. '
                'Comprueba que la matrícula es la del vehículo que tienes delante.',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            ),
          if (_aviso != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_aviso!,
                  style: const TextStyle(color: Colors.amberAccent, fontSize: 13)),
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

          // ── Kilómetros ─────────────────────────────────────────────────
          //
          // Mismo par que la matrícula —foto y campo editable— y por el mismo
          // motivo: un cuadro con reflejos se lee mal, así que la IA propone y
          // el operario, que está delante, confirma.
          FilledButton.tonalIcon(
            onPressed: _leyendoKm ? null : _fotoDeKilometros,
            icon: _leyendoKm
                ? const SizedBox(
                    width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.speed),
            label: Text(_leyendoKm ? 'Leyendo…' : 'Foto del cuentakilómetros'),
          ),
          const SizedBox(height: 12),

          TextField(
            controller: _kmCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Kilómetros',
              suffixText: 'km',
              helperText: 'Compruébalos antes de enviar.',
            ),
          ),
          const SizedBox(height: 12),

          TextField(
            controller: _clienteCtrl,
            decoration: const InputDecoration(labelText: 'Cliente'),
          ),
          const SizedBox(height: 12),

          // El teléfono lo apunta quien tiene al cliente delante. Llega al
          // trabajo al convertir la recepción, que es donde hace falta para
          // avisar de que el vehículo está listo.
          TextField(
            controller: _telefonoCtrl,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Teléfono móvil'),
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
