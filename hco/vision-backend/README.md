---
title: HCO Vision IA
emoji: 🦺
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# HCO · Backend de Visión Artificial (opcional, para el futuro)

> **Hoy la IA corre en el celular y no necesita este backend** (ver la actualización al inicio de
> [EVALUACION.md](EVALUACION.md)). Hugging Face ya no permite Spaces Docker gratis.
> Use este backend cuando quiera pagar un servidor (HF PRO, VPS, Oracle Cloud Always Free o una
> PC de la planta): mismos módulos, mismas tablas y mismo panel. En la app se activa definiendo
> `VITE_VISION_WS_URL` y eligiendo *Ajustes → Dónde corre la IA → En el servidor*.

FastAPI + WebSockets + ONNX Runtime (CPU) para los 3 módulos de la app HCO:
**Detección de EPPs**, **Detección de objetos industriales** (conteo) y **Conteo de personal** (aforo).

* Evaluación técnica y límites: [EVALUACION.md](EVALUACION.md)
* SQL de Supabase: `supabase/sql/vision_artificial.sql` (en el repo de la app)
* Pantalla en la app: `src/features/vision_ia/` → ruta `/vision/ia?modulo=epp|conteo|aforo`

Licencias: YOLOX (Apache 2.0), ONNX Runtime (MIT), Supervision (MIT), FastAPI (MIT). **Nada de Ultralytics (AGPL).**

---

## 1. Supabase

1. Supabase Dashboard → **SQL Editor** → pegar `supabase/sql/vision_artificial.sql` → **Run**.
   Al final debe listar las 4 tablas `vision_*` en la publicación de Realtime.
2. Copiar de *Project Settings → API*:
   * `Project URL` → secreto `SUPABASE_URL`
   * `service_role` key → secreto `SUPABASE_SERVICE_ROLE_KEY` (**solo en el Space, nunca en Vite**)
   * `anon` key → secreto `SUPABASE_ANON_KEY` (opcional; se usa para validar sesiones)

## 2. Google Drive (evidencias)

Elija **un** modo:

**A) OAuth con refresh token (recomendado con Gmail; es el mismo de la Edge Function `subir-drive`)**
* Reutilice `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REFRESH_TOKEN` que ya tienen
  en los secretos de Supabase (deben tener el scope `https://www.googleapis.com/auth/drive`
  o `drive.file`).
* Cree una carpeta en Drive (p. ej. "HCO Visión IA") y copie su ID de la URL
  (`https://drive.google.com/drive/folders/<ESTE_ID>`) → `DRIVE_FOLDER_ID`.

**B) Service Account + Unidad compartida (requiere Google Workspace)**
* Google Cloud Console → habilitar **Google Drive API** → crear Service Account → crear clave JSON.
* En Drive: crear una **Unidad compartida**, agregar el e-mail de la SA como
  **Administrador de contenido**, crear una carpeta dentro y copiar su ID → `DRIVE_FOLDER_ID`.
* Pegar el JSON completo (o en base64) en el secreto `GOOGLE_SERVICE_ACCOUNT_JSON`.
* ⚠️ Una SA **sin** Unidad compartida falla con `storageQuotaExceeded`: no tiene cuota propia.

Los archivos se comparten como "cualquiera con el enlace" para que el enlace
`https://lh3.googleusercontent.com/d/{id}` cargue en la app. Para no hacerlos públicos:
`DRIVE_PUBLIC_LINKS=false` (entonces la foto no se verá en el panel hasta implementar un proxy).

## 3. Hugging Face Space

1. https://huggingface.co/new-space → **SDK: Docker** → *Blank* → hardware **CPU basic (gratis)** →
   visibilidad **Public** (un Space privado no acepta WebSockets desde el navegador; la seguridad
   la da la sesión de Supabase).
2. Subir el contenido de esta carpeta `vision-backend/` a la raíz del repo del Space:
   ```powershell
   git clone https://huggingface.co/spaces/<usuario>/<space> hf-space
   ```
   ```powershell
   Copy-Item -Recurse -Force .\vision-backend\* .\hf-space\
   ```
   ```powershell
   cd hf-space; git add .; git commit -m "Backend vision IA"; git push
   ```
   (HF pide un *access token* con permiso de escritura como contraseña.)
3. *Settings → Variables and secrets*:

| Nombre | Tipo | Valor |
|---|---|---|
| `SUPABASE_URL` | Secret | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | service_role key |
| `SUPABASE_ANON_KEY` | Secret | anon key (opcional) |
| `ALLOWED_ORIGINS` | Variable | `https://<su-app>.pages.dev,https://<dominio-propio>` |
| `DRIVE_FOLDER_ID` | Variable | ID de la carpeta de evidencias |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | Secret | Modo A |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Secret | Modo B |
| `EPP_MODEL_URL` | Variable | URL directa a su `epp.onnx` (ver §5) |
| `EPP_MODEL_LABELS` | Variable | clases del modelo EPP en orden, p. ej. `person,helmet,vest,goggles,gloves,no_helmet` |
| `COUNT_MODEL_URL` / `COUNT_MODEL_LABELS` | Variable | (opcional) modelo de cajas/pallets |

4. Al terminar el *build* abra `https://<usuario>-<space>.hf.space/health` → debe responder
   `{"ok": true, ...}` y `"drive": "oauth"` o `"service_account"`.

Otras variables (con su valor por defecto): `CONF_THRESHOLD=0.35`, `EPP_SECONDS_THRESHOLD=2`,
`EPP_TRACK_COOLDOWN_S=300`, `EPP_CAMERA_COOLDOWN_S=20`, `COUNT_FLUSH_SECONDS=15`,
`GENERAL_MODEL_URL` (YOLOX-Nano oficial),
`MAX_CONCURRENT_INFERENCE=1`. Ver `config.py`.

## 4. App (Vite / Cloudflare Pages)

Agregar la variable (en `.env` local y en *Cloudflare Pages → Settings → Environment variables*,
para Production y Preview) y volver a desplegar:

```
VITE_VISION_WS_URL=wss://<usuario>-<space>.hf.space/ws
```

Abrir **Menú → Inteligencia Artificial** (o `/vision/ia`). En el celular: elegir módulo →
**Iniciar cámara** (pide permiso) → en Aforo/Conteo tocar **Línea** y marcar 2 puntos; la flecha
verde indica el sentido de INGRESO (**Invertir** lo da vuelta). Para 24/7: celular enchufado,
Wi-Fi, pantalla fijada (Android: *Fijar aplicación*) y sin ahorro de batería para el navegador.

## 5. Modelos propios (EPP, cajas, pallets)

El modelo general (YOLOX-Nano COCO) detecta personas, botellas y otros objetos COCO. **No** detecta EPP,
cajas ni pallets: para eso hay que entrenar un YOLOX (Apache 2.0):

1. Juntar 300–1.000 fotos de la planta y etiquetarlas (CVAT o Label Studio) en formato COCO.
2. Entrenar con el repo oficial `Megvii-BaseDetection/YOLOX` en Google Colab (GPU gratis),
   p. ej. `yolox_tiny` o `yolox_s`.
3. Exportar: `python tools/export_onnx.py -n yolox-s -c best_ckpt.pth --output-name epp.onnx`
   (sin `--decode_in_inference`; el backend decodifica).
4. Subir el `.onnx` a un lugar con descarga directa (p. ej. un repo de modelos en Hugging Face:
   `https://huggingface.co/<usuario>/<repo>/resolve/main/epp.onnx`) y poner esa URL en
   `EPP_MODEL_URL` + las clases en `EPP_MODEL_LABELS`.

Las clases de EPP se reconocen por nombre (inglés o español): `helmet/casco`, `vest/chaleco`,
`goggles/gafas/lentes`, `gloves/guantes`, y las negativas `no_helmet`, `sin_casco`, etc.
También se aceptan modelos RT-DETR exportados a ONNX (`*_MODEL_KIND=rtdetr`) desde
`lyuwenyu/RT-DETR` o `transformers` (nunca desde Ultralytics).

## 6. Probar en local

```powershell
cd vision-backend; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt
```
```powershell
$env:AUTH_DISABLED='true'; .\.venv\Scripts\uvicorn main:app --port 7860
```
`AUTH_DISABLED=true` solo para pruebas: permite conectar sin sesión de Supabase.

## 7. Protocolo del WebSocket

Documentado al inicio de `main.py`. Resumen: `hello` (token + config) → `ready` →
frames binarios (4 bytes `frame_id` + JPEG) → `result` con cajas normalizadas, resumen y eventos.
El mismo protocolo sirve para un puente de cámaras IP (RTSP → OpenCV → WebSocket).
