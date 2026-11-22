"""
Backend de Visión Artificial (FastAPI + WebSockets) para Hugging Face Spaces (Docker).

Protocolo del WebSocket  /ws
---------------------------------
1. Cliente → {"type": "hello", "token": "<access_token de Supabase>", "config": {...}}
      config = {
        "modulo": "epp" | "conteo" | "aforo",
        "camara_id": "garita-1", "area": "Almacén", "fps": 4,
        "linea": [[x1, y1], [x2, y2]],            # normalizado 0–1 (aforo y conteo)
        "invertir": false,                         # intercambia INGRESO / SALIDA
        "zona": [[x, y], ...],                     # opcional, conteo por zona (≥ 3 puntos)
        "sentido": "in" | "out" | "ambos",         # conteo por línea
        "clases_conteo": ["botella"],
        "epp_requeridos": ["casco", "chaleco", "gafas", "guantes"]
      }
   Servidor → {"type": "ready", "info": {...}, "modelos": {...}}
2. Cliente → mensaje BINARIO: 4 bytes frame_id (uint32 big-endian) + JPEG.
   Servidor → {"type": "result", "frame_id": n, "ms": 85, "cajas": [...], "resumen": {...}, "eventos": [...]}
   El cliente manda el siguiente frame cuando recibe el resultado (1 frame en vuelo).
3. Cliente → {"type": "config", "config": {...}}   (cambia línea/módulo; reinicia el tracking)
   Cliente → {"type": "ping"}  → {"type": "pong"}

Ejecutar en local:  uvicorn main:app --port 7860 --reload
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import struct
import time
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import config
from drive_service import DriveService
from supabase_service import SupabaseService
from vision_engine import ConteoProcessor, VisionEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("vision.main")

engine = VisionEngine()
drive: DriveService | None = None
db: SupabaseService | None = None
semaforo = asyncio.Semaphore(config.MAX_CONCURRENT_INFERENCE)
tareas: set[asyncio.Task] = set()  # referencias para que el GC no cancele tareas en segundo plano
estado = {"inicio": time.time(), "conexiones": 0, "frames": 0, "listo": False}


def en_segundo_plano(coro) -> None:
    t = asyncio.create_task(coro)
    tareas.add(t)
    t.add_done_callback(tareas.discard)


async def _ciclo_reintentos() -> None:
    while True:
        await asyncio.sleep(30)
        with suppress(Exception):
            if db:
                await db.reintentar_pendientes()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global drive, db
    drive = DriveService()
    db = SupabaseService()
    # Descargar/cargar modelos fuera del event loop (puede tardar en el primer arranque)
    await asyncio.to_thread(engine.load)
    estado["listo"] = True
    reintentos = asyncio.create_task(_ciclo_reintentos())
    yield
    reintentos.cancel()
    await drive.close()
    await db.close()


app = FastAPI(title="HCO Visión Artificial", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_origin_regex=config.ALLOWED_ORIGIN_REGEX or None,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def origen_permitido(origin: str | None) -> bool:
    # CORS no aplica a WebSockets: el navegador conecta igual, por eso se valida aquí.
    if not origin:
        return True  # clientes no-navegador (p. ej. puente RTSP); igual necesitan sesión válida
    if origin in config.ALLOWED_ORIGINS:
        return True
    return bool(config.ALLOWED_ORIGIN_REGEX and re.fullmatch(config.ALLOWED_ORIGIN_REGEX, origin))


@app.get("/")
async def raiz() -> dict[str, Any]:
    return {"servicio": "HCO Visión Artificial", "ws": "/ws", "health": "/health"}


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": estado["listo"],
        "uptime_s": int(time.time() - estado["inicio"]),
        "conexiones": estado["conexiones"],
        "frames": estado["frames"],
        "modelos": engine.estado(),
        "drive": drive.modo if drive else "desactivado",
        "supabase": bool(db and db.activo),
        "pendientes_supabase": db.pendientes if db else 0,
    }


# ------------------------------------------------------------------- persistencia de eventos
async def guardar_evento(ev: dict[str, Any]) -> None:
    """Sube la evidencia (si hay) y guarda la fila. Una falla de Drive no impide guardar el evento."""
    tabla = {"epp_infraccion": "vision_epp_infracciones", "aforo": "vision_aforo_eventos"}.get(ev["tipo"])
    if not tabla or not db:
        return
    fila = dict(ev["row"])
    if ev.get("imagen") and drive and drive.activo:
        try:
            subida = await drive.subir_jpeg(ev["imagen"], ev.get("nombre") or "evidencia.jpg", config.DRIVE_FOLDER_ID)
            fila["foto_url"] = subida["url"]
            fila["drive_file_id"] = subida["file_id"]
        except Exception as exc:
            log.error("Evidencia no subida a Drive: %s", exc)
    await db.insertar(tabla, fila)


async def enviar_conteos(proc: ConteoProcessor) -> None:
    pendiente = proc.pop_pendiente()
    if not pendiente or not db:
        return
    hora = datetime.now(timezone.utc).isoformat()
    for clase, cantidad in pendiente.items():
        await db.sumar_conteo(proc.camara_id, proc.area, clase, hora, cantidad)


async def _ciclo_conteo(get_proc) -> None:
    while True:
        await asyncio.sleep(config.COUNT_FLUSH_SECONDS)
        proc = get_proc()
        if isinstance(proc, ConteoProcessor):
            await enviar_conteos(proc)


# ------------------------------------------------------------------------------ WebSocket
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    if not origen_permitido(ws.headers.get("origin")):
        await ws.close(code=1008)
        return
    await ws.accept()

    try:
        hola = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=15))
    except Exception:
        await ws.close(code=1008)
        return
    if hola.get("type") != "hello":
        await ws.close(code=1008)
        return

    usuario = None
    if not config.AUTH_DISABLED:
        usuario = await db.verificar_usuario(str(hola.get("token") or "")) if db else None
        if not usuario:
            await ws.send_json({"type": "error", "codigo": "auth", "mensaje": "Sesión inválida o vencida"})
            await ws.close(code=1008)
            return
    if not estado["listo"]:
        await ws.send_json({"type": "error", "codigo": "cargando", "mensaje": "El servidor está cargando los modelos"})
        await ws.close(code=1013)
        return

    actual: dict[str, Any] = {"proc": None}
    try:
        actual["proc"] = engine.crear_procesador(dict(hola.get("config") or {}))
    except ValueError as exc:
        await ws.send_json({"type": "error", "codigo": "config", "mensaje": str(exc)})
        await ws.close(code=1008)
        return

    estado["conexiones"] += 1
    flush = asyncio.create_task(_ciclo_conteo(lambda: actual["proc"]))
    log.info("Cámara conectada: %s (%s) usuario=%s", actual["proc"].camara_id, actual["proc"].modulo,
             (usuario or {}).get("email", "-"))
    await ws.send_json({"type": "ready", "info": actual["proc"].info(), "modelos": engine.estado()})

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if msg.get("text") is not None:
                data = json.loads(msg["text"])
                if data.get("type") == "ping":
                    await ws.send_json({"type": "pong", "t": data.get("t")})
                elif data.get("type") == "config":
                    if isinstance(actual["proc"], ConteoProcessor):
                        await enviar_conteos(actual["proc"])
                    try:
                        actual["proc"] = engine.crear_procesador(dict(data.get("config") or {}))
                        await ws.send_json({"type": "ready", "info": actual["proc"].info(), "modelos": engine.estado()})
                    except ValueError as exc:
                        await ws.send_json({"type": "error", "codigo": "config", "mensaje": str(exc)})
                continue

            payload = msg.get("bytes")
            if not payload or len(payload) < 5:
                continue
            if len(payload) > config.MAX_FRAME_BYTES:
                await ws.send_json({"type": "error", "codigo": "frame", "mensaje": "Frame demasiado grande"})
                continue
            frame_id = struct.unpack(">I", payload[:4])[0]
            frame = cv2.imdecode(np.frombuffer(payload[4:], dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await ws.send_json({"type": "result", "frame_id": frame_id, "cajas": [], "resumen": {}, "eventos": []})
                continue

            t0 = time.perf_counter()
            proc = actual["proc"]
            async with semaforo:
                resultado, eventos = await asyncio.to_thread(proc.process, frame)
            estado["frames"] += 1

            for ev in eventos:
                en_segundo_plano(guardar_evento(ev))
            await ws.send_json({
                "type": "result",
                "frame_id": frame_id,
                "ms": int((time.perf_counter() - t0) * 1000),
                **resultado,
                # Al navegador solo va la fila (sin bytes de imagen) para avisar en pantalla
                "eventos": [{"evento": ev["tipo"], **ev["row"]} for ev in eventos],
            })
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.exception("Error en la conexión: %s", exc)
        with suppress(Exception):
            await ws.close(code=1011)
    finally:
        estado["conexiones"] -= 1
        flush.cancel()
        if isinstance(actual["proc"], ConteoProcessor):
            en_segundo_plano(enviar_conteos(actual["proc"]))
        log.info("Cámara desconectada: %s", getattr(actual["proc"], "camara_id", "-"))
