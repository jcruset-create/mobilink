# Fase 8 — Entrega: Notification Hub

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.32`

## Lo que NO se ha hecho, que es lo primero

**No se ha añadido un tercer sistema de correo.** El proyecto ya tiene el transporte SMTP en
`server/mail.ts`, compartido por el index y por el vigilante del buzón del CheckPoint, y devuelve
`null` cuando no hay configuración. Lo que faltaba no era otro `nodemailer`: era saber **a quién
avisar de qué**. Eso es todo lo que hay aquí — destinatarios, una cola y un worker.

## Decisiones

**Un aviso por incidencia, no por evaluación.** El ciclo evalúa cada cuarto de hora; si avisara en
cada vuelta, un problema que dura tres días mandaría trescientos correos. Solo se avisa de lo NUEVO,
y se distingue con `xmax = 0`, que en PostgreSQL separa una fila insertada de una actualizada por el
`ON CONFLICT`: sin segunda consulta y sin carrera entre comprobar y escribir. Encima, un índice único
por incidencia y destinatario.

**Los destinatarios tienen ámbito, igual que las reglas.** El responsable de un taller quiere los
avisos de SU taller. Un buzón con avisos ajenos acaba filtrado a una carpeta y deja de leerse, y
entonces no sirve ninguno.

**Sin SMTP, los avisos esperan.** No fallan ni gastan intentos: marcarlos como error consumiría los
cinco reintentos antes de que exista siquiera la posibilidad de enviarlos, y el día que se configure
el correo ya no saldrían. La pantalla lo dice con esas palabras, porque si no alguien pone
destinatarios y se queda esperando correos que no van a salir.

**El asunto basta.** `[Mobilink] Descuadre de arqueo en Mostrador: 20,00 €`. Un correo de aviso que
hay que abrir para saber si importa es un correo que se archiva sin abrir.

**Encolar un aviso no puede tumbar nada.** `avisarDeIncidencia` traga sus errores: si algo falla ahí,
la incidencia ya está registrada, y eso es lo que no se puede perder.

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** y **recién creada** | **1157 / 1157** en las dos |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | Backend sin avisos |

Tres pruebas: que una incidencia nueva encola un aviso **y solo uno** aunque se reevalúe tres veces;
que sin SMTP los avisos esperan con cero intentos gastados; y que un destinatario suscrito solo a un
tipo no recibe los demás.

## Lo que queda

- **WhatsApp**: el Integration Hub ya tiene un conector de Twilio. Añadirlo es implementar un canal
  más en la misma cola, no otro sistema.
- **Resumen diario** en vez de aviso por incidencia, para los tipos que no son urgentes.
- **Reglas y canales por zona desde la pantalla**: el modelo los admite; la interfaz solo crea los de
  empresa.
