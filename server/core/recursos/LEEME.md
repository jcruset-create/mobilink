# Recursos de la foto del empleado

Lo que hace falta para cambiarle el fondo a la foto de un empleado
(`../fotoFondo.ts`, `../fotoSilueta.ts`).

## `selfie_multiclass_256x256.onnx` — el modelo que recorta a la persona

- **Qué es:** «Selfie Multiclass» de MediaPipe (Google). Para cada píxel de una
  foto de 256 × 256 dice si es fondo, pelo, piel del cuerpo, piel de la cara,
  ropa u otra cosa. Aquí solo se usa «fondo o no».
- **Licencia:** Apache License 2.0 (ficha del modelo de Google, 10/05/2023).
  Permite el uso comercial.
- **De dónde sale:**
  `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`
- **Cómo se convirtió** (el original es `.tflite`; aquí se ejecuta con
  `onnxruntime-web`, que necesita `.onnx`):

  ```bash
  pip install tensorflow tf2onnx
  python -m tf2onnx.convert --tflite selfie_multiclass_256x256.tflite \
      --output selfie_multiclass_256x256.onnx --opset 17
  ```

  Es una conversión de formato: los pesos son los mismos. La entrada es
  `[1, 256, 256, 3]` con los colores de 0 a 1; la salida, `[1, 256, 256, 6]`
  sin normalizar (hay que pasarle un softmax; la clase 0 es el fondo).
- **Se ejecuta en el servidor.** La foto no sale a ningún servicio de fuera.

## `fondo-foto.jpg` — el fondo

El mural de Confortauto, recortado en cuadrado (1200 × 1200) de forma que el
logo queda arriba a la derecha, por encima de donde cae la cabeza en la foto
normalizada. Para cambiar de fondo basta con sustituir este fichero por otra
imagen cuadrada; las fotos ya guardadas no cambian solas.

## `../muestras/figura-sin-cara.jpg` — solo para las pruebas

Una figura sin cara sobre un fondo inventado: no es la foto de nadie. Sirve
para comprobar en las pruebas que el modelo de verdad encuentra a una persona.
