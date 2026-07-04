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

# Lambda Web Adapter: on AWS Lambda this extension turns function
# invocations into plain HTTP requests against the gunicorn server below.
# Outside Lambda (Render, local docker) the file is inert.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

# PORT=8080 is the adapter's default; Render overrides PORT at runtime.
# WEB_CONCURRENCY: 1 on Lambda (one request per instance), 2 on Render.
ENV PYTHONUNBUFFERED=1 PORT=8080
CMD ["sh", "-c", "gunicorn --workers ${WEB_CONCURRENCY:-2} --threads 4 --timeout 120 --bind 0.0.0.0:${PORT} api.app:app"]
