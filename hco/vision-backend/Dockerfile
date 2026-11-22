# Hugging Face Spaces (SDK Docker, CPU Basic gratis: 2 vCPU / 16 GB)
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=2 \
    MODELS_DIR=/home/user/app/models \
    HF_HOME=/home/user/.cache/huggingface

# libglib2.0-0 / libgomp1: requeridas por OpenCV y ONNX Runtime en imágenes slim
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces ejecuta el contenedor con el usuario 1000
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
# supervision instala opencv-python (con GUI, necesita libGL).
# Se reemplaza por la versión headless para que no haya dos cv2 en conflicto.
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && (pip uninstall -y opencv-python opencv-contrib-python || true) \
    && pip install --force-reinstall --no-deps "opencv-python-headless>=4.10,<6.0"

COPY --chown=user . .
RUN mkdir -p /home/user/app/models && chown -R user:user /home/user

USER user

# Descarga el modelo general YOLOX-Nano (Apache 2.0) en la construcción para que el
# arranque sea rápido. Si falla (sin red), se descarga al iniciar.
RUN python -c "import config, vision_engine as v; v.descargar_si_falta(config.GENERAL_MODEL_PATH, config.GENERAL_MODEL_URL)" || true

EXPOSE 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", \
     "--ws-ping-interval", "20", "--ws-ping-timeout", "20", "--ws-max-size", "2000000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
