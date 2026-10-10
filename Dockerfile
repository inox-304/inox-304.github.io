FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts/build-server.mjs ./scripts/build-server.mjs
RUN npm run build:server

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS application
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/pyproject.toml backend/uv.lock ./backend/
RUN uv sync --project backend --locked --no-dev
COPY backend ./backend
COPY --from=frontend /app/dist-server ./dist-server
COPY public/cms/plantillas ./public/cms/plantillas
RUN useradd --uid 10001 --create-home inox && mkdir -p /data && chown -R inox:inox /data /app
USER inox
ENV INOX_DATA_DIR=/data FRONTEND_DIST=/app/dist-server
EXPOSE 8000
CMD ["sh", "-c", "backend/.venv/bin/python backend/manage.py migrate --noinput && backend/.venv/bin/python backend/manage.py collectstatic --noinput && cd backend && .venv/bin/gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --timeout 60 --access-logfile - --error-logfile -"]
