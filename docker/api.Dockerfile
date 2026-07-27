FROM python:3.13.14-slim-bookworm@sha256:9d7f287598e1a5a978c015ee176d8216435aaf335ed69ac3c38dd1bbb10e8d64 AS wheels

ENV PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY apps/api/requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

FROM python:3.13.14-slim-bookworm@sha256:9d7f287598e1a5a978c015ee176d8216435aaf335ed69ac3c38dd1bbb10e8d64 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 aura \
    && useradd --uid 10001 --gid aura --create-home --shell /usr/sbin/nologin aura

WORKDIR /app/apps/api
COPY --from=wheels /wheels /wheels
COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

COPY --chown=aura:aura apps/api .
COPY --chown=aura:aura docker/api-entrypoint.sh /usr/local/bin/aura-api-entrypoint
RUN chmod 0755 /usr/local/bin/aura-api-entrypoint \
    && mkdir -p /data /aura-state \
    && chown -R aura:aura /data /aura-state

USER aura
EXPOSE 8000
ENTRYPOINT ["aura-api-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
