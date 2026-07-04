# Stage 1: build the React frontend
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python serving image (Flask + models + built frontend)
FROM python:3.14-slim
WORKDIR /app
COPY requirements-serve.txt ./
RUN pip install --no-cache-dir -r requirements-serve.txt
COPY src/ src/
COPY api/ api/
COPY models/ models/
COPY --from=frontend /build/dist frontend/dist/

# Render sets PORT; default matches its convention for local runs.
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "gunicorn --workers 2 --threads 4 --timeout 120 --bind 0.0.0.0:${PORT:-10000} api.app:app"]
