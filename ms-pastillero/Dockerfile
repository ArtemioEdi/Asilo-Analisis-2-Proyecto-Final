FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=America/Guatemala \
    PASTILLERO_BD=/datos/pastillero.db \
    VIGIA_URL=http://ms-vigia:8081

RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /datos

EXPOSE 8082
HEALTHCHECK --interval=20s --timeout=4s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8082/salud').read()"

CMD ["gunicorn", "--bind", "0.0.0.0:8082", "--workers", "1", "--threads", "4", \
     "--access-logfile", "-", "app:app"]
