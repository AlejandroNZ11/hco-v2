"""
Escritura en Supabase vía REST (PostgREST) con la SERVICE_ROLE key, y validación de la
sesión del usuario que abre el WebSocket.

Se usa httpx directo (en vez de supabase-py) para tener menos dependencias y control de
reintentos. Si Supabase no responde, las filas quedan en una cola en memoria y se
reintentan cada 30 s (hasta 2.000 filas; si el contenedor se reinicia, se pierden).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections import deque
from typing import Any

import httpx

import config

log = logging.getLogger("vision.supabase")


class SupabaseService:
    def __init__(self) -> None:
        self.url = config.SUPABASE_URL
        self.key = config.SUPABASE_SERVICE_ROLE_KEY
        self.activo = bool(self.url and self.key)
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=8.0))
        self._pendientes: deque[tuple[str, str, Any]] = deque(maxlen=2000)
        self._cache_usuarios: dict[str, tuple[float, dict[str, Any]]] = {}
        if not self.activo:
            log.warning("Supabase no configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY): no se guardarán eventos")

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if extra:
            h.update(extra)
        return h

    async def _post(self, ruta: str, cuerpo: Any, prefer: str = "return=minimal") -> None:
        res = await self._http.post(f"{self.url}/rest/v1/{ruta}", json=cuerpo, headers=self._headers({"Prefer": prefer}))
        if res.status_code >= 500 or res.status_code == 429:
            raise httpx.HTTPStatusError(f"{res.status_code}", request=res.request, response=res)
        if res.status_code >= 400:
            # Error de datos (columna inválida, check…): reintentar no lo arregla
            log.error("Supabase rechazó %s: %s %s", ruta, res.status_code, res.text[:300])

    async def _con_reintentos(self, tipo: str, ruta: str, cuerpo: Any) -> bool:
        if not self.activo:
            return False
        for intento in range(3):
            try:
                await self._post(ruta, cuerpo)
                return True
            except (httpx.HTTPError, OSError) as exc:
                log.warning("Supabase %s falló (intento %d): %s", ruta, intento + 1, exc)
                await asyncio.sleep(1.0 * (2 ** intento))
        self._pendientes.append((tipo, ruta, cuerpo))
        return False

    async def insertar(self, tabla: str, fila: dict[str, Any]) -> bool:
        return await self._con_reintentos("insert", tabla, fila)

    async def sumar_conteo(self, camara_id: str, area: str | None, clase: str, hora_iso: str, cantidad: int) -> bool:
        return await self._con_reintentos("rpc", "rpc/vision_sumar_conteo", {
            "p_camara_id": camara_id, "p_area": area, "p_clase": clase, "p_hora": hora_iso, "p_cantidad": cantidad,
        })

    async def reintentar_pendientes(self) -> None:
        for _ in range(len(self._pendientes)):
            tipo, ruta, cuerpo = self._pendientes.popleft()
            try:
                await self._post(ruta, cuerpo)
            except (httpx.HTTPError, OSError):
                self._pendientes.append((tipo, ruta, cuerpo))
                break  # sigue caído: esperar al siguiente ciclo

    @property
    def pendientes(self) -> int:
        return len(self._pendientes)

    async def verificar_usuario(self, access_token: str) -> dict[str, Any] | None:
        """Valida el JWT de la sesión del usuario contra Supabase Auth. Cachea 5 min."""
        if not access_token or not self.url:
            return None
        clave = hashlib.sha256(access_token.encode()).hexdigest()
        cache = self._cache_usuarios.get(clave)
        if cache and time.time() < cache[0]:
            return cache[1]
        apikey = config.SUPABASE_ANON_KEY or self.key
        try:
            res = await self._http.get(f"{self.url}/auth/v1/user",
                                       headers={"apikey": apikey, "Authorization": f"Bearer {access_token}"})
        except httpx.HTTPError as exc:
            log.warning("No se pudo validar la sesión: %s", exc)
            return None
        if res.status_code != 200:
            return None
        usuario = res.json()
        if len(self._cache_usuarios) > 500:
            self._cache_usuarios.clear()
        self._cache_usuarios[clave] = (time.time() + 300, usuario)
        return usuario

    async def close(self) -> None:
        await self._http.aclose()
