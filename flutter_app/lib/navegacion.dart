import 'package:flutter/material.dart';

/// El navegador de la app, para abrir pantallas desde fuera de una pantalla:
/// el aviso de OTF nueva (`AvisoMensajes`) está por encima del navegador y no
/// tiene un `context` dentro de él.
final navegadorApp = GlobalKey<NavigatorState>();
