import json
import logging
import logging.config
from datetime import UTC, datetime
from typing import Any

from app.storage import storage_manager


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def configure_logging() -> None:
    log_directory = storage_manager.paths.logs
    log_directory.mkdir(parents=True, exist_ok=True)

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "json": {"()": JsonFormatter},
                "console": {
                    "format": "%(asctime)s %(levelname)s [%(name)s] %(message)s",
                },
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "console",
                    "level": "INFO",
                },
                "file": {
                    "class": "logging.handlers.RotatingFileHandler",
                    "formatter": "json",
                    "filename": str(log_directory / "aura-api.log"),
                    "maxBytes": 5_000_000,
                    "backupCount": 5,
                    "level": "INFO",
                },
            },
            "root": {
                "handlers": ["console", "file"],
                "level": "INFO",
            },
        },
    )


def close_storage_log_handlers() -> None:
    root = logging.getLogger()
    for handler in list(root.handlers):
        if isinstance(handler, logging.FileHandler):
            root.removeHandler(handler)
            handler.close()


def reconfigure_storage_logging() -> None:
    close_storage_log_handlers()
    configure_logging()
