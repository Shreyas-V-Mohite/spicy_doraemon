# The chemistry service (FastAPI + RDKit + PubChemPy) as a container, for
# Render, Fly or any Docker host. Listens on $PORT (default 8000).
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /bin/uv

# Run as a normal user; the PubChem cache is written next to the code.
RUN useradd --create-home --uid 1000 app
WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev

COPY app ./app
# The demo molecules, so they work with no network.
COPY cache ./cache
RUN chown -R app:app /app
USER app

ENV PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8000'), timeout=3)"
CMD ["sh", "-c", "exec uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
