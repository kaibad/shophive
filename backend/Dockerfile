# Stage 1: Builder
FROM dhi.io/python:3.13-alpine3.21-dev AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/venv/bin:$PATH"

WORKDIR /app

RUN python -m venv /app/venv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip uninstall pip -y  

# Stage 2: Runtime
FROM dhi.io/python:3.13-alpine3.21

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/venv/bin:$PATH"

WORKDIR /app

# Venv from builder (all deps, self-contained)
COPY --from=builder /app/venv /app/venv

# App source + Python entrypoint (no shell needed)
COPY --chown=65532:65532 . .
COPY --chown=65532:65532 entrypoint.py /entrypoint.py

USER 65532

EXPOSE 8000

# Python directly as PID 1 — no shell wrapper
ENTRYPOINT ["python", "/entrypoint.py"]
CMD ["gunicorn", "backend.wsgi:application", "--bind", "0.0.0.0:8000"]

