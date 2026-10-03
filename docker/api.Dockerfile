FROM python:3.15.0rc2-slim-bookworm@sha256:1776b3fd7a71293417958958442a2ee7a7e7098f952a9c65b3b1c65de629aee7 AS wheels

ENV PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY apps/api/requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

FROM python:3.15.0rc2-slim-bookworm@sha256:1776b3fd7a71293417958958442a2ee7a7e7098f952a9c65b3b1c65de629aee7 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 anmplayer \
    && useradd --uid 10001 --gid anmplayer --create-home --shell /usr/sbin/nologin anmplayer

WORKDIR /app/apps/api
COPY --from=wheels /wheels /wheels
COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

COPY --chown=anmplayer:anmplayer VERSION /app/VERSION
COPY --chown=anmplayer:anmplayer apps/api .
COPY --chown=anmplayer:anmplayer docker/api-entrypoint.sh /usr/local/bin/anm-player-api-entrypoint
RUN chmod 0755 /usr/local/bin/anm-player-api-entrypoint \
    && mkdir -p /data /aura-state \
    && chown -R anmplayer:anmplayer /data /aura-state

USER anmplayer
EXPOSE 8000
ENTRYPOINT ["anm-player-api-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
