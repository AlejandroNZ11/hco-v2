"""
Motor de visión: detectores ONNX (YOLOX / RT-DETR), tracking ByteTrack y la lógica
de los 3 módulos (EPP, conteo de objetos y conteo de personal/aforo).

No sabe nada de WebSockets, Supabase ni Drive: recibe un frame BGR y devuelve
(resultado_para_dibujar, eventos). main.py se encarga de persistir los eventos.
Así la misma lógica se puede reutilizar con una cámara RTSP o en otro servidor.

Todas las coordenadas que salen hacia el navegador están normalizadas (0 a 1).
"""
from __future__ import annotations

import logging
import re
import threading
import time
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
import supervision as sv

import config

log = logging.getLogger("vision.engine")

COCO_LABELS = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
    "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
    "teddy bear", "hair drier", "toothbrush",
]

# Nombres en español para mostrar (y para que el usuario pida "botella" y no "bottle")
ES = {
    "person": "persona", "bottle": "botella", "car": "auto", "truck": "camión", "bus": "bus",
    "motorcycle": "moto", "bicycle": "bicicleta", "cup": "vaso", "suitcase": "maleta",
    "backpack": "mochila", "chair": "silla", "cell phone": "celular", "laptop": "laptop",
}

# Palabras clave para reconocer las clases de un modelo de EPP, sea en inglés o español
EPP_KEYWORDS = {
    "casco": ("helmet", "hardhat", "hard-hat", "hard_hat", "hard hat", "casco"),
    "chaleco": ("vest", "chaleco"),
    "gafas": ("goggle", "glasses", "gafas", "lentes", "eyewear"),
    "guantes": ("glove", "guante"),
}
PERSON_KEYWORDS = ("person", "persona", "worker", "trabajador", "human")
# Zona vertical (fracción del alto de la persona) donde debe estar el centro de cada EPP
EPP_ZONA_Y = {"casco": (-0.15, 0.35), "gafas": (-0.05, 0.35), "chaleco": (0.12, 0.80), "guantes": (0.0, 1.05)}


def parse_labels(valor: str) -> list[str]:
    if valor.strip().lower() == "coco":
        return list(COCO_LABELS)
    return [p.strip() for p in valor.split(",") if p.strip()]


def descargar_si_falta(ruta: str, url: str) -> bool:
    """Descarga el modelo una vez si no existe en disco. Devuelve True si el archivo está disponible."""
    path = Path(ruta)
    if path.exists() and path.stat().st_size > 0:
        return True
    if not url:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    log.info("Descargando modelo %s …", url)
    try:
        urllib.request.urlretrieve(url, tmp)  # noqa: S310 (URL controlada por el administrador)
        tmp.replace(path)
        return True
    except Exception as exc:  # pragma: no cover - depende de la red
        log.error("No se pudo descargar %s: %s", url, exc)
        tmp.unlink(missing_ok=True)
        return False


# =====================================================================================
# Detector ONNX genérico
# =====================================================================================
class OnnxDetector:
    """
    Soporta:
      * YOLOX (export oficial; salida (1, N, 5 + C) sin decodificar o ya decodificada).
      * RT-DETR exportado desde lyuwenyu/RT-DETR (entradas images + orig_target_sizes)
        o desde Hugging Face transformers/optimum (salidas logits + pred_boxes).
    """

    def __init__(self, path: str, kind: str, labels: list[str], conf: float | None = None):
        so = ort.SessionOptions()
        so.intra_op_num_threads = config.ORT_THREADS
        so.inter_op_num_threads = 1
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(path, sess_options=so, providers=["CPUExecutionProvider"])
        self.kind = kind.lower()
        self.labels = labels
        self.conf = conf if conf is not None else config.CONF_THRESHOLD
        self.inputs = self.session.get_inputs()
        self.input_name = self.inputs[0].name
        shape = self.inputs[0].shape
        # Tamaño de entrada fijo del modelo (los YOLOX oficiales: 416 nano/tiny, 640 el resto)
        self.size = int(shape[2]) if isinstance(shape[2], int) else (416 if "nano" in path or "tiny" in path else 640)
        self.output_names = [o.name for o in self.session.get_outputs()]
        self._grids: tuple[np.ndarray, np.ndarray] | None = None
        log.info("Modelo %s cargado (%s, %d px, %d clases)", Path(path).name, self.kind, self.size, len(labels))

    # ---------------------------------------------------------------- utilidades
    def label(self, class_id: int) -> str:
        return self.labels[class_id] if 0 <= class_id < len(self.labels) else str(class_id)

    def _yolox_grids(self) -> tuple[np.ndarray, np.ndarray]:
        if self._grids is None:
            grids, strides = [], []
            for stride in (8, 16, 32):
                n = self.size // stride
                xv, yv = np.meshgrid(np.arange(n), np.arange(n))
                grids.append(np.stack((xv, yv), 2).reshape(1, -1, 2))
                strides.append(np.full((1, n * n, 1), stride))
            self._grids = (np.concatenate(grids, 1), np.concatenate(strides, 1))
        return self._grids

    # ---------------------------------------------------------------- inferencia
    def detect(self, bgr: np.ndarray) -> sv.Detections:
        if self.kind == "rtdetr":
            dets = self._detect_rtdetr(bgr)
        else:
            dets = self._detect_yolox(bgr)
        if len(dets):
            dets = dets.with_nms(threshold=config.NMS_THRESHOLD, class_agnostic=False)
        dets.data["class_name"] = np.array([self.label(int(c)) for c in dets.class_id], dtype=object)
        return dets

    def _detect_yolox(self, bgr: np.ndarray) -> sv.Detections:
        h, w = bgr.shape[:2]
        s = self.size
        r = min(s / h, s / w)
        nh, nw = int(round(h * r)), int(round(w * r))
        padded = np.full((s, s, 3), 114, dtype=np.uint8)
        padded[:nh, :nw] = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
        blob = padded.transpose(2, 0, 1)[None].astype(np.float32)  # BGR 0-255, sin normalizar

        out = self.session.run(None, {self.input_name: blob})[0][0]  # (N, 5 + C)
        # El export oficial NO decodifica la grilla; si el modelo ya viene decodificado
        # las cajas ya están en píxeles y w/h son grandes.
        grids, strides = self._yolox_grids()
        if out.shape[0] == grids.shape[1] and float(np.abs(out[:, 2:4]).max()) < 20:
            out = out.copy()
            out[:, :2] = (out[:, :2] + grids[0]) * strides[0]
            out[:, 2:4] = np.exp(out[:, 2:4]) * strides[0]

        cls_scores = out[:, 5:]
        class_id = cls_scores.argmax(1)
        score = out[:, 4] * cls_scores[np.arange(len(out)), class_id]
        keep = score >= self.conf
        if not keep.any():
            return sv.Detections.empty()
        b = out[keep, :4]
        xyxy = np.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 0] + b[:, 2] / 2, b[:, 1] + b[:, 3] / 2], 1) / r
        xyxy = np.clip(xyxy, 0, [w - 1, h - 1, w - 1, h - 1])
        return sv.Detections(xyxy=xyxy.astype(np.float32), confidence=score[keep].astype(np.float32),
                             class_id=class_id[keep].astype(int))

    def _detect_rtdetr(self, bgr: np.ndarray) -> sv.Detections:
        h, w = bgr.shape[:2]
        s = self.size
        rgb = cv2.cvtColor(cv2.resize(bgr, (s, s)), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        input_names = {i.name for i in self.inputs}

        if "orig_target_sizes" in input_names:  # export de lyuwenyu/RT-DETR
            blob = rgb.transpose(2, 0, 1)[None]
            labels, boxes, scores = self.session.run(
                None, {self.input_name: blob, "orig_target_sizes": np.array([[w, h]], dtype=np.int64)}
            )
            labels, boxes, scores = labels[0], boxes[0], scores[0]
        else:  # export de transformers / optimum (logits + pred_boxes, normalizado ImageNet)
            mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
            std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
            blob = ((rgb - mean) / std).transpose(2, 0, 1)[None].astype(np.float32)
            outs = dict(zip(self.output_names, self.session.run(None, {self.input_name: blob})))
            logits = outs.get("logits", list(outs.values())[0])[0]
            pred = outs.get("pred_boxes", list(outs.values())[1])[0]
            prob = 1 / (1 + np.exp(-logits))
            labels = prob.argmax(1)
            scores = prob.max(1)
            cx, cy, bw, bh = pred[:, 0] * w, pred[:, 1] * h, pred[:, 2] * w, pred[:, 3] * h
            boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], 1)

        keep = scores >= self.conf
        if not keep.any():
            return sv.Detections.empty()
        return sv.Detections(xyxy=boxes[keep].astype(np.float32), confidence=scores[keep].astype(np.float32),
                             class_id=labels[keep].astype(int))


# =====================================================================================
# Motor compartido (un solo juego de modelos para todas las cámaras)
# =====================================================================================
class VisionEngine:
    def __init__(self) -> None:
        self.general: OnnxDetector | None = None
        self.epp: OnnxDetector | None = None
        self.conteo: OnnxDetector | None = None

    def load(self) -> None:
        if descargar_si_falta(config.GENERAL_MODEL_PATH, config.GENERAL_MODEL_URL):
            self.general = OnnxDetector(config.GENERAL_MODEL_PATH, config.GENERAL_MODEL_KIND,
                                        parse_labels(config.GENERAL_MODEL_LABELS))
        else:
            log.error("Sin modelo general: aforo y conteo no funcionarán")
        if descargar_si_falta(config.EPP_MODEL_PATH, config.EPP_MODEL_URL):
            self.epp = OnnxDetector(config.EPP_MODEL_PATH, config.EPP_MODEL_KIND, parse_labels(config.EPP_MODEL_LABELS))
        if descargar_si_falta(config.COUNT_MODEL_PATH, config.COUNT_MODEL_URL):
            self.conteo = OnnxDetector(config.COUNT_MODEL_PATH, config.COUNT_MODEL_KIND,
                                       parse_labels(config.COUNT_MODEL_LABELS))

    def estado(self) -> dict[str, Any]:
        return {
            "general": bool(self.general),
            "epp": bool(self.epp),
            "conteo": bool(self.conteo),
            "clases_general": self.general.labels if self.general else [],
            "clases_epp": self.epp.labels if self.epp else [],
            "clases_conteo": self.conteo.labels if self.conteo else [],
        }

    def crear_procesador(self, cfg: dict[str, Any]) -> "BaseProcessor":
        modulo = cfg.get("modulo")
        clases = {"epp": EppProcessor, "conteo": ConteoProcessor, "aforo": AforoProcessor}
        if modulo not in clases:
            raise ValueError(f"Módulo desconocido: {modulo}")
        return clases[modulo](self, cfg)


# =====================================================================================
# Procesadores por módulo (uno por conexión/cámara: guardan el estado del tracking)
# =====================================================================================
def ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_box(xyxy: np.ndarray, w: int, h: int) -> list[float]:
    x1, y1, x2, y2 = (float(v) for v in xyxy)
    return [round(x1 / w, 4), round(y1 / h, 4), round(x2 / w, 4), round(y2 / h, 4)]


def _es(nombre: str) -> str:
    return ES.get(nombre, nombre)


@dataclass
class Linea:
    """Línea virtual en coordenadas normalizadas. 'in' = cruce en el sentido de la flecha."""
    puntos: list[list[float]]
    anchor: sv.Position
    invertir: bool = False
    _zona: sv.LineZone | None = field(default=None, repr=False)
    _wh: tuple[int, int] = (0, 0)

    def trigger(self, dets: sv.Detections, w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
        if self._zona is None or self._wh != (w, h):
            (x1, y1), (x2, y2) = self.puntos[:2]
            self._zona = sv.LineZone(start=sv.Point(x1 * w, y1 * h), end=sv.Point(x2 * w, y2 * h),
                                     triggering_anchors=[self.anchor])
            self._wh = (w, h)
        if not len(dets) or dets.tracker_id is None:
            vacio = np.zeros(len(dets), dtype=bool)
            return vacio, vacio
        cruza_in, cruza_out = self._zona.trigger(dets)
        return (cruza_out, cruza_in) if self.invertir else (cruza_in, cruza_out)


def _valid_line(valor: Any) -> list[list[float]] | None:
    try:
        pts = [[float(p[0]), float(p[1])] for p in valor]
        return pts if len(pts) >= 2 else None
    except (TypeError, ValueError, IndexError):
        return None


class BaseProcessor:
    modulo = "base"

    def __init__(self, engine: VisionEngine, cfg: dict[str, Any]):
        self.engine = engine
        self.cfg = cfg
        self.camara_id = str(cfg.get("camara_id") or "camara-1")[:60]
        self.area = (str(cfg.get("area")) if cfg.get("area") else None)
        fps = max(1.0, min(15.0, float(cfg.get("fps") or 4)))
        self.tracker = sv.ByteTrack(
            track_activation_threshold=0.3,
            lost_track_buffer=int(fps * 3),  # ~3 s sin ver el objeto antes de olvidarlo
            minimum_matching_threshold=0.8,
            frame_rate=int(round(fps)),
        )
        self.advertencias: list[str] = []
        self.last_seen: dict[int, float] = {}

    def actualizar_config(self, cfg: dict[str, Any]) -> None:
        self.cfg.update(cfg)

    def _olvidar_tracks(self, ahora: float, max_s: float = 60.0) -> list[int]:
        viejos = [t for t, ts in self.last_seen.items() if ahora - ts > max_s]
        for t in viejos:
            self.last_seen.pop(t, None)
        return viejos

    def process(self, bgr: np.ndarray) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        raise NotImplementedError

    def info(self) -> dict[str, Any]:
        return {"modulo": self.modulo, "advertencias": self.advertencias}


# ------------------------------------------------------------------------------- EPP
class EppProcessor(BaseProcessor):
    modulo = "epp"

    def __init__(self, engine: VisionEngine, cfg: dict[str, Any]):
        super().__init__(engine, cfg)
        self.requeridos = [e for e in (cfg.get("epp_requeridos") or ["casco", "chaleco"]) if e in EPP_KEYWORDS]
        self.primer_faltante: dict[int, float] = {}
        self.ultima_alerta: dict[int, float] = {}
        self.ultima_alerta_camara = 0.0
        self.mapa_clases: dict[int, tuple[str, bool]] = {}  # class_id → (epp, es_negativa)
        self.clases_persona: set[int] = set()

        modelo = engine.epp
        if modelo is None:
            self.advertencias.append("No hay modelo de EPP cargado (EPP_MODEL_PATH). El módulo solo detecta personas.")
            self.requeridos = []  # sin modelo no se puede afirmar que falte nada: nunca alertar
            return
        for i, nombre in enumerate(modelo.labels):
            n = nombre.lower()
            if any(k == n or n.startswith(k) for k in PERSON_KEYWORDS):
                self.clases_persona.add(i)
                continue
            negativa = bool(re.match(r"^(no|sin|without)[\s_-]", n))
            for epp, claves in EPP_KEYWORDS.items():
                if any(k in n for k in claves):
                    self.mapa_clases[i] = (epp, negativa)
        detectables = {e for e, _ in self.mapa_clases.values()}
        no_eval = [e for e in self.requeridos if e not in detectables]
        if no_eval:
            self.advertencias.append(f"El modelo de EPP no detecta: {', '.join(no_eval)} (no se evaluará).")
        self.requeridos = [e for e in self.requeridos if e in detectables]

    def _personas_y_epp(self, bgr: np.ndarray) -> tuple[sv.Detections, sv.Detections]:
        modelo = self.engine.epp
        if modelo is None:
            general = self.engine.general.detect(bgr) if self.engine.general else sv.Detections.empty()
            return general[general.data["class_name"] == "person"] if len(general) else general, sv.Detections.empty()
        dets = modelo.detect(bgr)
        if not len(dets):
            return dets, dets
        es_persona = np.isin(dets.class_id, list(self.clases_persona))
        personas = dets[es_persona]
        items = dets[~es_persona]
        if not self.clases_persona and self.engine.general is not None:
            # El modelo de EPP no trae "persona": se toman del modelo general
            general = self.engine.general.detect(bgr)
            personas = general[general.data["class_name"] == "person"] if len(general) else general
        return personas, items

    def _evaluar(self, persona_box: np.ndarray, items: sv.Detections) -> list[str]:
        x1, y1, x2, y2 = persona_box
        pw, ph = x2 - x1, y2 - y1
        presentes, negativos = set(), set()
        for j in range(len(items)):
            epp_neg = self.mapa_clases.get(int(items.class_id[j]))
            if not epp_neg:
                continue
            epp, negativa = epp_neg
            ix1, iy1, ix2, iy2 = items.xyxy[j]
            cx, cy = (ix1 + ix2) / 2, (iy1 + iy2) / 2
            if not (x1 - pw * 0.15 <= cx <= x2 + pw * 0.15):
                continue
            zy0, zy1 = EPP_ZONA_Y[epp]
            if not (y1 + ph * zy0 <= cy <= y1 + ph * zy1):
                continue
            (negativos if negativa else presentes).add(epp)
        return [e for e in self.requeridos if e in negativos or e not in presentes]

    def process(self, bgr: np.ndarray) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        h, w = bgr.shape[:2]
        ahora = time.monotonic()
        personas, items = self._personas_y_epp(bgr)
        personas = self.tracker.update_with_detections(personas)
        cajas, eventos, infractores = [], [], []
        # El cooldown por cámara se evalúa una vez por frame: si varias personas cumplen
        # la regla en el mismo instante, todas se registran (con la misma foto).
        camara_libre = ahora - self.ultima_alerta_camara >= config.EPP_CAMERA_COOLDOWN_S

        for i in range(len(personas)):
            tid = int(personas.tracker_id[i])
            self.last_seen[tid] = ahora
            faltan = self._evaluar(personas.xyxy[i], items) if self.requeridos else []
            seg = 0.0
            if faltan:
                self.primer_faltante.setdefault(tid, ahora)
                seg = ahora - self.primer_faltante[tid]
            else:
                self.primer_faltante.pop(tid, None)

            alerta = (
                faltan
                and seg >= config.EPP_SECONDS_THRESHOLD
                and ahora - self.ultima_alerta.get(tid, -1e9) >= config.EPP_TRACK_COOLDOWN_S
                and camara_libre
            )
            if alerta:
                self.ultima_alerta[tid] = ahora
                infractores.append((i, tid, faltan, seg))

            cajas.append({
                "box": _norm_box(personas.xyxy[i], w, h),
                "track_id": tid,
                "label": f"#{tid} " + ("OK" if not faltan else "sin " + ", ".join(faltan)),
                "estado": "ok" if not faltan else ("alerta" if seg >= config.EPP_SECONDS_THRESHOLD else "aviso"),
                "faltantes": faltan,
                "segundos": round(seg, 1),
            })

        for j in range(len(items)):  # los EPP detectados se dibujan pequeños
            epp_neg = self.mapa_clases.get(int(items.class_id[j]))
            if epp_neg:
                cajas.append({"box": _norm_box(items.xyxy[j], w, h), "label": ("sin " if epp_neg[1] else "") + epp_neg[0],
                              "estado": "item_neg" if epp_neg[1] else "item"})

        if infractores:
            self.ultima_alerta_camara = ahora
            evidencia = self._dibujar_evidencia(bgr, personas, infractores)
            ok, jpg = cv2.imencode(".jpg", evidencia, [cv2.IMWRITE_JPEG_QUALITY, 85])
            for _, tid, faltan, seg in infractores:
                eventos.append({
                    "tipo": "epp_infraccion",
                    "row": {
                        "hora": ahora_iso(), "camara_id": self.camara_id, "area": self.area, "track_id": tid,
                        "estado": "No Conforme", "epp_faltantes": faltan, "segundos_sin_epp": round(seg, 1),
                    },
                    "imagen": jpg.tobytes() if ok else None,
                    "nombre": f"epp_{self.camara_id}_{datetime.now():%Y%m%d_%H%M%S}_t{tid}.jpg",
                })

        for tid in self._olvidar_tracks(ahora, max_s=config.EPP_TRACK_COOLDOWN_S + 60):
            self.primer_faltante.pop(tid, None)
            self.ultima_alerta.pop(tid, None)

        resumen = {"personas": len(personas), "no_conformes": sum(1 for c in cajas if c.get("faltantes"))}
        return {"cajas": cajas, "resumen": resumen}, eventos

    def _dibujar_evidencia(self, bgr: np.ndarray, personas: sv.Detections, infractores: list) -> np.ndarray:
        img = bgr.copy()
        ids = {i for i, *_ in infractores}
        for i in range(len(personas)):
            x1, y1, x2, y2 = personas.xyxy[i].astype(int)
            color = (0, 0, 255) if i in ids else (0, 180, 0)
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        for i, tid, faltan, _ in infractores:
            x1, y1 = personas.xyxy[i][:2].astype(int)
            texto = f"ID {tid}: sin {', '.join(faltan)}"
            (tw, th), _ = cv2.getTextSize(texto, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(img, (x1, max(0, y1 - th - 8)), (x1 + tw + 6, y1), (0, 0, 255), -1)
            cv2.putText(img, texto, (x1 + 3, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        sello = f"{self.camara_id} | {self.area or '-'} | {datetime.now():%Y-%m-%d %H:%M:%S} | NO CONFORME"
        cv2.rectangle(img, (0, img.shape[0] - 22), (img.shape[1], img.shape[0]), (0, 0, 0), -1)
        cv2.putText(img, sello, (6, img.shape[0] - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        return img


# ---------------------------------------------------------------------------- Conteo
class ConteoProcessor(BaseProcessor):
    modulo = "conteo"

    def __init__(self, engine: VisionEngine, cfg: dict[str, Any]):
        super().__init__(engine, cfg)
        self.modelo = engine.conteo or engine.general
        if self.modelo is None:
            self.advertencias.append("No hay modelo cargado para conteo.")
        elif engine.conteo is None:
            self.advertencias.append("Sin modelo propio de conteo: se usa el general (COCO: botella, vaso, maleta…). "
                                     "Para cajas y pallets entrene uno y configure COUNT_MODEL_PATH.")
        pedidas = [str(c).lower() for c in (cfg.get("clases_conteo") or [])]
        disponibles = self.modelo.labels if self.modelo else []
        # El usuario puede pedir en español ("botella") o como se llame en el modelo ("bottle")
        inverso = {v: k for k, v in ES.items()}
        self.clases = {inverso.get(c, c) for c in pedidas if inverso.get(c, c) in disponibles} or (
            {"bottle"} if "bottle" in disponibles else set(disponibles)
        )
        self.modo = cfg.get("modo_conteo") or ("zona" if _valid_line(cfg.get("zona") or []) and len(cfg.get("zona")) >= 3 else "linea")
        self.sentido = cfg.get("sentido") or "in"  # in | out | ambos
        self.linea = Linea(_valid_line(cfg.get("linea")) or [[0.5, 0.05], [0.5, 0.95]], sv.Position.CENTER,
                           bool(cfg.get("invertir")))
        self.zona_pts = _valid_line(cfg.get("zona")) or []
        self._zona: sv.PolygonZone | None = None
        self._zona_wh = (0, 0)
        self.contados: set[int] = set()
        self.totales: Counter[str] = Counter()
        self.pendiente: Counter[str] = Counter()  # lo que falta enviar a Supabase
        self._lock = threading.Lock()  # process() corre en un hilo y pop_pendiente() en el event loop

    def pop_pendiente(self) -> dict[str, int]:
        with self._lock:
            datos = {k: v for k, v in self.pendiente.items() if v}
            self.pendiente.clear()
        return datos

    def _zona_poligono(self, w: int, h: int) -> sv.PolygonZone:
        if self._zona is None or self._zona_wh != (w, h):
            poly = np.array([[x * w, y * h] for x, y in self.zona_pts], dtype=np.int32)
            self._zona = sv.PolygonZone(polygon=poly, triggering_anchors=(sv.Position.CENTER,))
            self._zona_wh = (w, h)
        return self._zona

    def process(self, bgr: np.ndarray) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        h, w = bgr.shape[:2]
        ahora = time.monotonic()
        dets = self.modelo.detect(bgr) if self.modelo else sv.Detections.empty()
        if len(dets):
            dets = dets[np.isin(dets.data["class_name"], list(self.clases))]
        dets = self.tracker.update_with_detections(dets)

        nuevos = np.zeros(len(dets), dtype=bool)
        if self.modo == "zona" and len(self.zona_pts) >= 3:
            nuevos = self._zona_poligono(w, h).trigger(dets) if len(dets) else nuevos
        else:
            cin, cout = self.linea.trigger(dets, w, h)
            nuevos = cin | cout if self.sentido == "ambos" else (cout if self.sentido == "out" else cin)

        cajas = []
        for i in range(len(dets)):
            tid = int(dets.tracker_id[i])
            self.last_seen[tid] = ahora
            clase = str(dets.data["class_name"][i])
            if nuevos[i] and tid not in self.contados:  # cada objeto se cuenta una sola vez
                self.contados.add(tid)
                with self._lock:
                    self.totales[_es(clase)] += 1
                    self.pendiente[_es(clase)] += 1
            cajas.append({"box": _norm_box(dets.xyxy[i], w, h), "track_id": tid, "label": f"{_es(clase)} #{tid}",
                          "estado": "contado" if tid in self.contados else "item"})

        for tid in self._olvidar_tracks(ahora, max_s=30):
            self.contados.discard(tid)
        return {"cajas": cajas, "resumen": {"totales": dict(self.totales)}}, []


# ----------------------------------------------------------------------------- Aforo
class AforoProcessor(BaseProcessor):
    modulo = "aforo"

    def __init__(self, engine: VisionEngine, cfg: dict[str, Any]):
        super().__init__(engine, cfg)
        if engine.general is None:
            self.advertencias.append("No hay modelo general cargado.")
        # Para personas el punto que cruza es el de los pies (más estable que las esquinas)
        self.linea = Linea(_valid_line(cfg.get("linea")) or [[0.05, 0.6], [0.95, 0.6]], sv.Position.BOTTOM_CENTER,
                           bool(cfg.get("invertir")))
        self.ingresos = 0
        self.salidas = 0

    def process(self, bgr: np.ndarray) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        h, w = bgr.shape[:2]
        ahora = time.monotonic()
        dets = self.engine.general.detect(bgr) if self.engine.general else sv.Detections.empty()
        if len(dets):
            dets = dets[dets.data["class_name"] == "person"]
        dets = self.tracker.update_with_detections(dets)
        cin, cout = self.linea.trigger(dets, w, h)

        cajas, eventos = [], []
        for i in range(len(dets)):
            tid = int(dets.tracker_id[i])
            self.last_seen[tid] = ahora
            tipo = "INGRESO" if cin[i] else ("SALIDA" if cout[i] else None)
            if tipo:
                if tipo == "INGRESO":
                    self.ingresos += 1
                else:
                    self.salidas += 1
                eventos.append({"tipo": "aforo", "row": {
                    "hora": ahora_iso(), "camara_id": self.camara_id, "area": self.area, "tipo": tipo,
                    "delta": 1 if tipo == "INGRESO" else -1, "track_id": tid,
                }})
            cajas.append({"box": _norm_box(dets.xyxy[i], w, h), "track_id": tid, "label": f"#{tid}",
                          "estado": "ingreso" if cin[i] else ("salida" if cout[i] else "item")})
        self._olvidar_tracks(ahora)
        return {"cajas": cajas, "resumen": {"ingresos": self.ingresos, "salidas": self.salidas,
                                            "en_cuadro": len(dets)}}, eventos
