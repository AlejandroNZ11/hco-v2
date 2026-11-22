# Visión IA (IA en el celular)

Ruta: `/vision/ia?modulo=epp|conteo|aforo` — las 3 tarjetas de "Inteligencia Artificial" del Menú.

## Cómo funciona

```
Cámara trasera ─► Web Worker (onnxruntime-web + YOLOX) ─► tracker + reglas (motor/)
                                                           ├─► Supabase (eventos, conteos)
                                                           └─► subir-drive ─► Google Drive (fotos EPP)
Panel en vivo ◄── Supabase Realtime
```

| Archivo | Qué hace |
|---|---|
| `vision_ia.jsx` | Pantalla: selector, cámara, Wake Lock, overlay, ajustes |
| `PanelVision.jsx` | Panel en vivo por módulo (Realtime) |
| `motor/detector.worker.js` | Corre el modelo ONNX fuera del hilo principal |
| `motor/yolox.js` | Decodifica la salida de YOLOX + NMS |
| `motor/tracker.js` | IDs por objeto (estilo ByteTrack) |
| `motor/geometria.js` | Línea bidireccional y zona |
| `motor/procesadores.js` | Reglas de EPP, conteo de objetos y conteo de personal |
| `motor/persistencia.js` | Guardado con cola y reintentos |
| `motor/useMotorLocal.js` | Une todo: captura, detección, reglas, guardado |
| `useVisionSocket.js` | Modo servidor opcional (`vision-backend/`) |

Reglas de EPP: alerta si una persona lleva **2 s seguidos** sin un EPP obligatorio; máximo
1 alerta cada **5 min por persona** y 1 foto cada **20 s por cámara** (`REGLAS` en `procesadores.js`).

## Modelos

Se configuran en `public/models/modelos.json` (no hace falta recompilar si solo cambia ese archivo
y el `.onnx`). Por defecto solo está el modelo general (`yolox_nano.onnx`, COCO: personas,
botellas, etc.). Para EPP o cajas/pallets:

1. Entrenar un YOLOX (Apache 2.0) con fotos propias — ver `vision-backend/README.md` §5.
2. Exportar a ONNX sin `--decode_in_inference`, entrada 416×416.
3. Copiar el `.onnx` a `public/models/` (o subirlo a un repo de modelos de Hugging Face, que es
   gratis, y usar la URL `https://huggingface.co/<usuario>/<repo>/resolve/main/epp.onnx`).
4. En `modelos.json` poner esa `url` y las `etiquetas` en el orden del entrenamiento
   (p. ej. `["person","helmet","vest","goggles","gloves","no_helmet"]`).

Cloudflare Pages no acepta archivos de más de 25 MB: un modelo más grande debe ir en Hugging Face.

## Rendimiento

WASM con 1 hilo (la página no está "cross-origin isolated"). En el navegador de prueba:
~100 ms por frame → 4 FPS. En celulares de gama baja bajar *Ajustes → FPS máximo* a 2–3.
El motor (14 MB, ~4 MB comprimido) y los modelos se descargan la primera vez que se abre
Visión IA y quedan en caché (`vision-ia-modelos`), así que luego funciona sin internet
(los eventos se guardan cuando vuelve la señal).
