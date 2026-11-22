# Visión Artificial 24/7 — Evaluación técnica y mejoras

> **Actualización (nov. 2026): la IA ahora corre en el celular.**
> Hugging Face ya no ofrece Spaces Docker gratis (solo "Static"; Docker y Gradio piden PRO).
> Por eso la versión actual hace la inferencia en el navegador (sección 3, que ya era la
> evolución recomendada):
>
> * `onnxruntime-web` (MIT, WASM) en un Web Worker + YOLOX-Nano (Apache 2.0) servido desde
>   `public/models/`. Medido en el navegador de prueba: ~90–115 ms por frame con 1 hilo → 4 FPS.
> * Tracker y reglas portados a JS (`src/features/vision_ia/motor/`), con el mismo comportamiento
>   que `vision_engine.py`.
> * Eventos a Supabase directo desde la app (RLS: cada usuario inserta a su nombre). Fotos de
>   EPP a Drive por la Edge Function `subir-drive` (destino `vision`), igual que las fotos de LUP.
> * Sin conexión: cola con reintento cada 20 s (las filas se guardan en localStorage).
> * Costo: S/ 0. Sin servidor que se duerma; casi no se gastan datos (no viaja video).
>
> Este backend (`vision-backend/`) queda listo para el futuro: cuando haya presupuesto
> (HF PRO, un VPS u Oracle Cloud Always Free, o una PC de la planta) se activa con la variable
> `VITE_VISION_WS_URL` y en *Ajustes → Dónde corre la IA → En el servidor*. Sirve para cámaras
> IP (RTSP), modelos más pesados (RT-DETR) o celulares de gama baja.
>
> Lo que sigue abajo es la evaluación original, válida para el modo servidor.

Este documento revisa la arquitectura pedida (React en Cloudflare Pages + FastAPI en
Hugging Face Spaces Free + Supabase Free + Google Drive) **antes** del código, y
explica qué se cambió respecto al planteamiento original y por qué.

---

## 0. Resumen ejecutivo (lo importante en 10 líneas)

1. **Es viable como piloto con 1–2 cámaras por Space**, no como sistema industrial 24/7
   con SLA. HF Spaces Free no garantiza disponibilidad, corre en CPU y puede reiniciarse.
2. **Con CPU (2 vCPU) hay que usar un modelo pequeño**: YOLOX-Nano/Tiny a 416 px
   (≈40–120 ms por frame) en vez de RT-DETR (≈400–900 ms por frame en CPU). RT-DETR
   queda como opción para cuando haya más CPU o GPU.
3. **El envío se hace con contrapresión**: el celular manda un frame solo cuando recibe la
   respuesta del anterior (1 frame en vuelo). Así el FPS se adapta solo a la red y a la CPU
   y nunca se acumula retraso. Frames JPEG de 640 px, calidad 0,6 (≈25–45 KB).
4. **El conteo de objetos no inserta una fila por unidad**: el backend acumula y suma por
   (cámara, clase, hora) cada 15 s con una función SQL atómica. Eso protege la cuota de
   Realtime del plan Free.
5. **Drive con Service Account no funciona en una cuenta Gmail normal** (la SA no tiene
   cuota). El backend soporta dos modos: OAuth con refresh token (el mismo que ya usa la
   Edge Function `subir-drive`) **o** Service Account + Unidad compartida (Workspace).
6. **No existe un modelo de EPP con licencia libre, listo para producción y que detecte
   casco + chaleco + gafas + guantes.** Hay que entrenar uno (YOLOX o RT-DETR, ambos
   Apache 2.0) con un dataset de licencia compatible. El código ya lo soporta; sin ese
   modelo el módulo EPP no puede funcionar.
7. **Cámaras IP (RTSP) no llegan al navegador.** Para ellas se necesita un proceso puente
   (fuera de HF) — se deja el protocolo listo para eso.
8. **La autenticación del WebSocket usa la sesión de Supabase del usuario** (el backend la
   valida contra `auth/v1/user`); no hace falta un secreto extra en Vite.
9. **Privacidad:** las fotos de EPP muestran personas. Con enlaces `lh3` públicos cualquiera
   con el enlace las ve. Ver sección 10.
10. **Inferencia en el navegador (onnxruntime-web) es la mejor evolución** para Aforo y
    Conteo (cero imágenes por la red, sin depender de que HF esté despierto). Se recomienda
    como fase 2; el protocolo de eventos ya está separado para poder hacerlo.

---

## 1. Hugging Face Spaces Free: sueño, CPU y disponibilidad

| Tema | Realidad | Qué se hizo |
|---|---|---|
| Sueño por inactividad | Los Spaces gratis se duermen tras un periodo sin tráfico (hoy ~48 h, HF puede cambiarlo). Despertar = 1–3 min (arranque del contenedor + carga de modelos). | Una cámara conectada genera tráfico continuo y lo mantiene despierto. El frontend muestra "Despertando servidor…" y reintenta; hay `GET /health` para hacer *ping* antes de abrir el WebSocket. |
| Reinicios | HF reinicia Spaces por mantenimiento o al actualizar la imagen, sin aviso. | Reconexión automática con *backoff* exponencial (1 s → 30 s máx.) y reenvío de la configuración de la cámara al reconectar. El estado de tracking se pierde en un reinicio (un `track_id` nuevo puede volver a contarse si estaba cruzando la línea en ese instante). |
| Sin GPU | 2 vCPU compartidas. | ONNX Runtime con 2 hilos, un solo modelo general compartido por todas las conexiones, semáforo para no saturar la CPU, y modelos pequeños. |
| Uso 24/7 | Los términos de HF permiten Spaces de demo; un uso productivo intensivo 24/7 puede ser limitado o suspendido. | **Recomendación honesta:** usar HF Free para el piloto. Para producción, un VPS barato (2–4 vCPU) o un mini PC en planta corre exactamente el mismo `Dockerfile` sin cambios. |
| Space privado | Un Space privado exige el token de HF en la cabecera, que el navegador no puede mandar en un WebSocket. | El Space debe ser **público**, pero el WebSocket exige la sesión de Supabase en el primer mensaje y rechaza conexiones sin sesión válida. Los secretos viven en *Settings → Secrets* del Space (no en el repo). |

**Rendimiento esperado en 2 vCPU (aprox., medir en el Space real):**

| Modelo | Entrada | ms/frame | FPS útiles |
|---|---|---|---|
| YOLOX-Nano (COCO) | 416 | 40–80 | 5–8 |
| YOLOX-Tiny (COCO) | 416 | 80–150 | 4–6 |
| YOLOX-S | 640 | 250–450 | 2–3 |
| RT-DETR-R18 | 640 | 400–900 | 1–2 |

Para aforo y conteo bastan 3–5 FPS si la línea se coloca donde la gente/objetos no pasan
corriendo. Para EPP, 2–4 FPS es suficiente (la regla es "2 s sin EPP").

Con **dos módulos que necesitan modelos distintos** (p. ej. EPP: general + EPP), el tiempo
por frame se suma. Por eso cada conexión ejecuta **solo** los modelos de su módulo.

## 2. Latencia del WebSocket desde datos móviles

* RTT típico 4G: 40–120 ms; en planta con mala cobertura, 200–600 ms y picos de segundos.
* Subida de un JPEG de 35 KB con 2 Mbps de subida ≈ 140 ms.
* Total por frame ≈ RTT + subida + inferencia ≈ 250–700 ms → **2–4 FPS reales**.

**Decisión:** *stop-and-wait* (1 frame en vuelo). Si la red empeora, baja el FPS en vez de
acumular cola y mostrar recuadros con 10 s de retraso. Además:

* **FPS adaptativo:** tope configurable (por defecto 5 FPS) y la cadencia real la marca la
  respuesta del servidor. Si la latencia supera 1,5 s, el cliente baja la resolución a 480 px
  y la calidad a 0,5; si vuelve a < 600 ms, sube de nuevo.
* **Recuadros sobre el video:** se dibujan en un canvas encima del `<video>` en vivo
  (no sobre el frame procesado), con coordenadas normalizadas 0–1. Con latencia, el recuadro
  va levemente detrás del objeto; es aceptable para supervisión.
* **Consumo de datos:** 3 FPS × 35 KB ≈ 105 KB/s ≈ **9 GB/día por cámara**. En datos móviles
  esto es caro: para 24/7 la cámara debe estar en **Wi-Fi**. Esto es otro argumento para la
  inferencia en el navegador (sección 3).

## 3. ¿Inferencia en el navegador (onnxruntime-web) y enviar solo eventos?

**Sí es posible y es la mejor arquitectura a mediano plazo para Aforo y Conteo:**

* YOLOX-Nano en onnxruntime-web (WASM SIMD + hilos, o WebGPU en Chrome Android reciente)
  corre a 5–15 FPS en un celular de gama media.
* El tracking (ByteTrack) habría que portarlo a JS (≈300 líneas) o usar un tracker IoU
  simple, suficiente con 10+ FPS.
* Solo viajan eventos (≈100 bytes) → datos móviles despreciables, no depende de HF.

**Limitaciones:** el celular se calienta y gasta batería 24/7 (debe estar enchufado y con
buena ventilación); los modelos (4–30 MB) se descargan una vez (cachear con el PWA); EPP
necesita subir la foto, lo que en el navegador requiere pasar por la Edge Function
`subir-drive` (que ya existe) porque los secretos de Google no pueden estar en el cliente.

**Decisión para esta entrega:** se implementa la arquitectura pedida (servidor), pero el
backend separa *inferencia* de *eventos* (`vision_engine.py` produce eventos; `main.py` los
persiste). Así, en fase 2 el navegador puede generar los mismos eventos e insertarlos
directamente en Supabase con las mismas tablas.

## 4. Compresión de frames y FPS adaptativo

* `canvas.toBlob('image/jpeg', 0.6)` a **640 px** de lado mayor (480 px en modo degradado).
  Los modelos trabajan a 416/640, así que mandar 1080p solo gasta red.
* WebP sería ~25 % más liviano, pero Safari iOS no codifica WebP en canvas de forma fiable;
  se usa JPEG por compatibilidad.
* Mensaje binario: 4 bytes de `frame_id` + JPEG (sin base64, que agrega 33 %).
* Si la pestaña pasa a segundo plano, el navegador congela la cámara; el cliente lo detecta
  (`visibilitychange`) y pausa el envío.

## 5. Reconexión

* Cliente: *backoff* exponencial con *jitter* (1, 2, 4, 8… hasta 30 s), reintento inmediato
  al recuperar red (`online`) y al volver a la pestaña. Al reconectar se reenvía `hello`
  (sesión + configuración de cámara).
* Servidor: `ping`/`pong` de Uvicorn cada 20 s para detectar conexiones muertas (los
  proxys de HF cortan conexiones inactivas), límite de tamaño por mensaje (1,5 MB) y
  limpieza del estado de tracking al cerrar.
* Supabase Realtime: se reutiliza el hook `useSupabaseRealtime` de la app, que ya resuelve
  el token y recarga la lista al reconectar (para no perder eventos ocurridos sin conexión).

## 6. Screen Wake Lock

* `navigator.wakeLock.request('screen')` funciona en Chrome Android y Safari iOS ≥ 16.4,
  **solo en HTTPS** (Cloudflare Pages lo es) y **solo con la pestaña visible**.
* El sistema lo libera solo al cambiar de pestaña, bloquear la pantalla o con batería baja:
  se vuelve a pedir en `visibilitychange`.
* No impide que el usuario apague la pantalla con el botón, ni que el SO mate el navegador
  por temperatura. Para 24/7 real: celular dedicado, enchufado, con "modo kiosco"
  (Android: *Fijar aplicación*), brillo bajo y desactivar optimización de batería del navegador.

## 7. Cámaras IP (RTSP)

* El navegador **no puede abrir RTSP**. Opciones, de más simple a más robusta:
  1. Usar el celular como cámara (lo implementado).
  2. Un **puente** en la red local (mini PC / Raspberry Pi / la PC de garita) que lea RTSP con
     OpenCV/FFmpeg y mande frames al mismo WebSocket del backend (mismo protocolo: `hello` +
     binarios). Es un script de ~60 líneas; o, mejor, correr el backend completo en esa PC
     leyendo RTSP directamente (sin internet de por medio para el video).
  3. go2rtc / MediaMTX para convertir RTSP a WebRTC y verlo en el navegador.
* HF Spaces **no** puede alcanzar cámaras dentro de la red de la planta (no hay IP pública
  ni VPN), así que el puente es obligatorio para cámaras IP.

## 8. Supabase Free: límites de Realtime y base de datos

Cifras orientativas del plan Free (verificar en supabase.com/pricing, cambian):
~200 conexiones Realtime simultáneas, ~2 millones de mensajes Realtime/mes,
500 MB de base de datos, y el **proyecto se pausa tras 1 semana sin actividad**
(con cámaras 24/7 no ocurrirá).

* Cada `INSERT` se entrega a **cada** cliente suscrito: 1 evento × 10 pantallas = 10 mensajes.
* Aforo: 1 fila por cruce. 2.000 cruces/día × 10 pantallas × 30 días = 600 k mensajes/mes. OK.
* Conteo de cajas a 1 fila por unidad podría ser 20 k/día → 6 M mensajes/mes → **se pasa**.
  Por eso **el conteo se agrega**: el backend suma por (cámara, clase, hora) y hace
  *upsert* cada 15 s mediante la función `vision_sumar_conteo` → como máximo
  4 updates/min por clase y cámara, independiente del volumen.
* Las tablas de eventos crecen: 2.000 filas/día ≈ 0,5 MB/día. Se incluye una función de
  limpieza opcional (`vision_purgar_antiguos`) para conservar N días.
* Escrituras desde el backend con la **service_role key** (secreto del Space; omite RLS).
  El frontend solo lee con RLS `authenticated`.

## 9. Google Drive con Service Account

* **Las Service Accounts no tienen cuota de almacenamiento propia** (desde 2024 la subida a
  "Mi unidad" de la SA falla con `storageQuotaExceeded`). Opciones:
  1. **OAuth con refresh token de una cuenta normal** (recomendado aquí): es lo que ya usa la
     Edge Function `subir-drive`. Los archivos consumen la cuota de esa cuenta (15 GB gratis).
     Un JPEG de evidencia pesa ~60–120 KB → ~150.000 fotos.
  2. **Service Account + Unidad compartida** (requiere Google Workspace): agregar la SA como
     *Administrador de contenido* de la unidad compartida y subir con `supportsAllDrives=true`.
  3. Delegación de dominio (Workspace): la SA actúa como un usuario. Solo con admin de Workspace.
* El backend soporta los modos 1 y 2; elige según los secretos configurados.
* **Enlace `lh3.googleusercontent.com/d/{id}`:** no es una API oficial; funciona con archivos
  compartidos "cualquiera con el enlace" y puede aplicar límites de tráfico. La app ya lo usa
  en RDR con `referrerPolicy="no-referrer"`; aquí igual. En una Unidad compartida, el admin
  puede prohibir compartir fuera de la organización → el enlace no cargaría.
* Límites de la API de Drive (≈12.000 consultas/min por proyecto) no son un problema: la
  regla de 5 min de *cooldown* limita las subidas.

## 10. Privacidad y aspectos legales

* Las fotos de "No Conforme" identifican a trabajadores. Con un enlace público, cualquiera
  que lo obtenga puede verlas. Según la normativa de datos personales aplicable (p. ej. Ley
  29733 en Perú), se recomienda: aviso de videovigilancia en el área, carpeta de Drive
  dedicada, y a futuro servir las fotos con un proxy autenticado (la Edge Function
  `rdr-imagen` es una base) en vez de enlaces públicos. Se deja la variable
  `DRIVE_PUBLIC_LINKS=true|false`.
* El backend nunca guarda frames en disco: todo se procesa en memoria.

## 11. De dónde salen los modelos (licencias)

| Uso | Modelo / herramienta | Licencia | Comentario |
|---|---|---|---|
| Personas, botellas | **YOLOX** COCO (Megvii) en ONNX | Apache 2.0 | Release oficial con `.onnx` listos (`yolox_nano.onnx`, `yolox_tiny.onnx`, `yolox_s.onnx`). Es el modelo por defecto. |
| Alternativa más precisa | **RT-DETR** (repo `lyuwenyu/RT-DETR`, PaddleDetection o `transformers` + pesos `PekingU/rtdetr_*`) | Apache 2.0 | **No** usar la implementación de Ultralytics (AGPL). Exportar a ONNX con `optimum` o el script del repo. Soportado en `vision_engine.py`. |
| Tracking y líneas | **Supervision** (Roboflow) — ByteTrack, LineZone, PolygonZone | MIT | |
| EPP | **No hay** un ONNX listo con licencia permisiva que cubra los 4 EPP. | — | Entrenar YOLOX-S/Tiny (Apache) con un dataset verificado. Candidatos a revisar **uno por uno** (la licencia la pone cada autor): *Hard Hat Workers* (dominio público, solo casco), datasets de Roboflow Universe marcados **CC BY 4.0** (chaleco/gafas/guantes), *SH17* (verificar licencia antes de uso comercial). Evitar datasets CC BY-NC si el uso es comercial y el *Construction-PPE* de Ultralytics (AGPL). Lo mejor: **300–1.000 fotos propias de la planta** etiquetadas con CVAT/Label Studio (Apache/MIT). |
| Cajas, pallets | COCO no tiene "caja" ni "pallet". | — | Mismo camino: entrenar YOLOX con fotos propias (pocas clases, se entrena rápido en Google Colab gratis). |

**Advertencia:** la licencia de los *pesos* hereda restricciones del *dataset* con el que se
entrenaron. Un modelo entrenado con YOLOX (Apache) sobre un dataset CC BY-NC no es libre
para uso comercial.

## 12. Riesgos de la lógica de negocio (y mitigaciones)

* **Cooldown por `track_id`:** si la persona sale de cuadro y vuelve, ByteTrack le da un ID
  nuevo → puede generar otra alerta antes de 5 min. Mitigación incluida: además del cooldown
  por track, hay un *cooldown por cámara* de 20 s para evitar ráfagas.
* **"2 s seguidos":** se mide con la hora del servidor entre frames. Si un frame intermedio
  ve el casco (falso positivo), el contador se reinicia: el sistema prefiere no alertar a
  alertar mal.
* **Aforo por línea:** ingresos − salidas se desvía con el tiempo (personas que cruzan
  juntas y se fusionan, oclusiones). Mitigación: el aforo se calcula **por día** y se puede
  corregir con un "ajuste" manual en la pantalla; colocar la cámara cenital (desde arriba)
  mejora mucho la precisión.
* **Conteo sin duplicados:** se cuenta cada `track_id` una sola vez por cruce en el sentido
  configurado. Si el tracker pierde el objeto *justo* sobre la línea y lo re-identifica con
  otro ID, puede contar doble; se mitiga con `lost_track_buffer` ≈ 3 s.

## 13. Cambios respecto al pedido original

| Pedido | Cambio | Motivo |
|---|---|---|
| RT-DETR o YOLOX | YOLOX-Nano por defecto, RT-DETR opcional | CPU de 2 vCPU |
| Conteo "por tipo y hora" con inserts | Upsert agregado cada 15 s | Cuota Realtime |
| Drive con Service Account | OAuth refresh token (recomendado) o SA + Unidad compartida | La SA no tiene cuota |
| CORS para Cloudflare Pages | CORS + validación de `Origin` en el WebSocket (CORS no aplica a WebSockets) | Seguridad |
| Seguridad no especificada | Sesión de Supabase obligatoria en el WebSocket | Space público |
| Selector de "4 módulos" | 3 módulos: EPP, Detección de objetos industriales y Conteo de personal (las 3 tarjetas que ya existen en el Menú) | Aclarado por el usuario: no hay módulo de placas/OCR |