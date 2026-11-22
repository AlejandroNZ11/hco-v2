"""Configuración del backend leída de variables de entorno (Secrets / Variables del Space)."""
from __future__ import annotations

import os
from pathlib import Path


def _env(nombre: str, defecto: str = "") -> str:
    # .strip(): los secretos pegados en paneles web suelen traer un salto de línea al final
    return (os.environ.get(nombre) or defecto).strip()


def _env_bool(nombre: str, defecto: bool) -> bool:
    valor = _env(nombre)
    if not valor:
        return defecto
    return valor.lower() in ("1", "true", "si", "sí", "yes", "on")


def _env_float(nombre: str, defecto: float) -> float:
    try:
        return float(_env(nombre) or defecto)
    except ValueError:
        return defecto


def _env_lista(nombre: str, defecto: str = "") -> list[str]:
    return [p.strip() for p in _env(nombre, defecto).split(",") if p.strip()]


BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = Path(_env("MODELS_DIR", str(BASE_DIR / "models")))

# --- Seguridad / CORS ---------------------------------------------------------
# Orígenes permitidos (dominio de Cloudflare Pages). Ej: https://hco.pages.dev,https://hco.miempresa.com
ALLOWED_ORIGINS = _env_lista("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
# Regex extra para las vistas previas de Cloudflare (https://<hash>.hco.pages.dev)
ALLOWED_ORIGIN_REGEX = _env("ALLOWED_ORIGIN_REGEX", r"https://([a-z0-9-]+\.)*pages\.dev")
# Solo para pruebas locales: permite WebSocket sin sesión de Supabase
AUTH_DISABLED = _env_bool("AUTH_DISABLED", False)

# --- Supabase -----------------------------------------------------------------
SUPABASE_URL = _env("SUPABASE_URL").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = _env("SUPABASE_ANON_KEY")  # opcional, para validar sesiones

# --- Google Drive ------------------------------------------------------------------
# Modo A (recomendado con Gmail): OAuth con refresh token
GOOGLE_CLIENT_ID = _env("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = _env("GOOGLE_CLIENT_SECRET")
GOOGLE_REFRESH_TOKEN = _env("GOOGLE_REFRESH_TOKEN")
# Modo B (Workspace): JSON de la Service Account (texto o base64) + carpeta en una Unidad compartida
GOOGLE_SERVICE_ACCOUNT_JSON = _env("GOOGLE_SERVICE_ACCOUNT_JSON")
DRIVE_FOLDER_ID = _env("DRIVE_FOLDER_ID")
DRIVE_PUBLIC_LINKS = _env_bool("DRIVE_PUBLIC_LINKS", True)

# --- Modelos ------------------------------------------------------------------------
# Modelo general (personas, vehículos, botellas…). YOLOX COCO oficial (Apache 2.0).
GENERAL_MODEL_PATH = _env("GENERAL_MODEL_PATH", str(MODELS_DIR / "yolox_nano.onnx"))
GENERAL_MODEL_URL = _env(
    "GENERAL_MODEL_URL",
    "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx",
)
GENERAL_MODEL_KIND = _env("GENERAL_MODEL_KIND", "yolox")  # yolox | rtdetr
GENERAL_MODEL_LABELS = _env("GENERAL_MODEL_LABELS", "coco")  # "coco" o lista separada por comas

# Modelo de EPP (entrenado por ustedes). Clases esperadas, p. ej.:
#   person,helmet,vest,goggles,gloves,no_helmet,no_vest
EPP_MODEL_PATH = _env("EPP_MODEL_PATH", str(MODELS_DIR / "epp.onnx"))
EPP_MODEL_URL = _env("EPP_MODEL_URL")
EPP_MODEL_KIND = _env("EPP_MODEL_KIND", "yolox")
EPP_MODEL_LABELS = _env("EPP_MODEL_LABELS", "person,helmet,vest,goggles,gloves")

# Modelo de conteo propio (cajas, pallets…). Si no existe se usa el general.
COUNT_MODEL_PATH = _env("COUNT_MODEL_PATH", str(MODELS_DIR / "conteo.onnx"))
COUNT_MODEL_URL = _env("COUNT_MODEL_URL")
COUNT_MODEL_KIND = _env("COUNT_MODEL_KIND", "yolox")
COUNT_MODEL_LABELS = _env("COUNT_MODEL_LABELS", "caja,pallet,botella,producto")

CONF_THRESHOLD = _env_float("CONF_THRESHOLD", 0.35)
NMS_THRESHOLD = _env_float("NMS_THRESHOLD", 0.5)
ORT_THREADS = int(_env_float("ORT_THREADS", 2))
# Cuántos frames se procesan a la vez en todo el servidor (2 vCPU → 1 o 2)
MAX_CONCURRENT_INFERENCE = int(_env_float("MAX_CONCURRENT_INFERENCE", 1))

# --- Reglas de negocio ---------------------------------------------------------------
EPP_SECONDS_THRESHOLD = _env_float("EPP_SECONDS_THRESHOLD", 2.0)
EPP_TRACK_COOLDOWN_S = _env_float("EPP_TRACK_COOLDOWN_S", 300.0)
EPP_CAMERA_COOLDOWN_S = _env_float("EPP_CAMERA_COOLDOWN_S", 20.0)
COUNT_FLUSH_SECONDS = _env_float("COUNT_FLUSH_SECONDS", 15.0)
MAX_FRAME_BYTES = int(_env_float("MAX_FRAME_BYTES", 1_500_000))
