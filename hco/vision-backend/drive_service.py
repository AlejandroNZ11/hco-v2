"""
Subida de evidencias a Google Drive directamente desde memoria (sin escribir en disco).

Dos modos, según los secretos configurados:
  A) OAuth con refresh token de una cuenta normal (GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN).
     Es el mismo esquema que usa la Edge Function `subir-drive` de la app. Usa la cuota de esa cuenta.
  B) Service Account (GOOGLE_SERVICE_ACCOUNT_JSON) + carpeta dentro de una UNIDAD COMPARTIDA.
     Ojo: una Service Account NO tiene cuota propia; subir a su "Mi unidad" falla con
     storageQuotaExceeded. La SA debe ser "Administrador de contenido" de la unidad compartida.

Devuelve enlaces https://lh3.googleusercontent.com/d/{file_id} (los muestra la app con
referrerPolicy="no-referrer"). Para que esos enlaces carguen el archivo debe ser público
("cualquiera con el enlace"), controlado por DRIVE_PUBLIC_LINKS.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid

import httpx

import config

log = logging.getLogger("vision.drive")

TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
FILES_URL = "https://www.googleapis.com/drive/v3/files"
SCOPES = ["https://www.googleapis.com/auth/drive"]


def lh3_url(file_id: str) -> str:
    return f"https://lh3.googleusercontent.com/d/{file_id}"


class DriveService:
    def __init__(self) -> None:
        self._token = ""
        self._expira = 0.0
        self._lock = asyncio.Lock()
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
        self._sa_credentials = None
        self.modo = "desactivado"

        if config.GOOGLE_REFRESH_TOKEN and config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET:
            self.modo = "oauth"
        elif config.GOOGLE_SERVICE_ACCOUNT_JSON:
            try:
                from google.oauth2 import service_account

                raw = config.GOOGLE_SERVICE_ACCOUNT_JSON
                if not raw.lstrip().startswith("{"):
                    raw = base64.b64decode(raw).decode("utf-8")
                self._sa_credentials = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=SCOPES)
                self.modo = "service_account"
            except Exception as exc:
                log.error("GOOGLE_SERVICE_ACCOUNT_JSON inválido: %s", exc)
        if self.modo != "desactivado" and not config.DRIVE_FOLDER_ID:
            log.warning("DRIVE_FOLDER_ID vacío: los archivos irán a la raíz de la cuenta")
        log.info("Drive en modo: %s", self.modo)

    @property
    def activo(self) -> bool:
        return self.modo != "desactivado"

    async def _access_token(self) -> str:
        async with self._lock:
            if self._token and time.time() < self._expira:
                return self._token
            if self.modo == "oauth":
                res = await self._http.post(TOKEN_URL, data={
                    "client_id": config.GOOGLE_CLIENT_ID,
                    "client_secret": config.GOOGLE_CLIENT_SECRET,
                    "refresh_token": config.GOOGLE_REFRESH_TOKEN,
                    "grant_type": "refresh_token",
                })
                data = res.json()
                if res.status_code != 200 or "access_token" not in data:
                    raise RuntimeError(f"Token de Google rechazado: {data.get('error_description') or data}")
                self._token = data["access_token"]
                self._expira = time.time() + int(data.get("expires_in", 3600)) - 300
            else:
                from google.auth.transport.requests import Request

                # google-auth firma el JWT y pide el token (bloqueante → hilo aparte)
                await asyncio.to_thread(self._sa_credentials.refresh, Request())
                self._token = self._sa_credentials.token
                self._expira = time.time() + 50 * 60
            return self._token

    async def subir_jpeg(self, contenido: bytes, nombre: str, carpeta_id: str | None = None) -> dict[str, str]:
        """Sube bytes JPEG y devuelve {'file_id', 'url'}. Lanza excepción si falla tras reintentos."""
        if not self.activo:
            raise RuntimeError("Drive no está configurado")
        carpeta = carpeta_id or config.DRIVE_FOLDER_ID
        metadata = {"name": nombre, "mimeType": "image/jpeg"}
        if carpeta:
            metadata["parents"] = [carpeta]

        boundary = f"hco{uuid.uuid4().hex}"
        cuerpo = (
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
            + json.dumps(metadata).encode()
            + f"\r\n--{boundary}\r\nContent-Type: image/jpeg\r\n\r\n".encode()
            + contenido
            + f"\r\n--{boundary}--".encode()
        )

        ultimo_error: Exception | None = None
        for intento in range(3):
            try:
                token = await self._access_token()
                res = await self._http.post(
                    UPLOAD_URL,
                    params={"uploadType": "multipart", "supportsAllDrives": "true", "fields": "id"},
                    headers={"Authorization": f"Bearer {token}",
                             "Content-Type": f"multipart/related; boundary={boundary}"},
                    content=cuerpo,
                )
                if res.status_code == 401:
                    self._token = ""  # token vencido: se renueva en el siguiente intento
                    raise RuntimeError("401 de Drive")
                if res.status_code == 403 and "storageQuotaExceeded" in res.text:
                    # Error típico de Service Account sin Unidad compartida: reintentar no sirve
                    raise PermissionError("La Service Account no tiene cuota: use una Unidad compartida o OAuth")
                res.raise_for_status()
                file_id = res.json()["id"]
                if config.DRIVE_PUBLIC_LINKS:
                    await self._hacer_publico(file_id, token)
                return {"file_id": file_id, "url": lh3_url(file_id)}
            except PermissionError:
                raise
            except Exception as exc:  # red, 5xx, 429…
                ultimo_error = exc
                await asyncio.sleep(1.5 * (2 ** intento))
        raise RuntimeError(f"No se pudo subir a Drive: {ultimo_error}")

    async def _hacer_publico(self, file_id: str, token: str) -> None:
        res = await self._http.post(
            f"{FILES_URL}/{file_id}/permissions",
            params={"supportsAllDrives": "true"},
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "reader", "type": "anyone"},
        )
        if res.status_code >= 400:
            # En Unidades compartidas el admin puede prohibir compartir fuera de la organización
            log.warning("No se pudo hacer público %s (%s): %s", file_id, res.status_code, res.text[:200])

    async def close(self) -> None:
        await self._http.aclose()
