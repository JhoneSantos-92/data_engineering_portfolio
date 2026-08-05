import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from uuid import uuid4

import duckdb
import requests

BACKFILL_DAYS = 90

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FetchResult:
    rows: list[dict]
    max_reference_date: Optional[date]


@dataclass(frozen=True)
class Watermark:
    series_id: str
    checked_through_date: Optional[date]
    last_value_date: Optional[date]


class WatermarkStore:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con
        self._con.execute("CREATE SCHEMA IF NOT EXISTS control")
        self._con.execute(
            """
            CREATE TABLE IF NOT EXISTS control.ingestion_watermark (
                series_id VARCHAR PRIMARY KEY,
                checked_through_date DATE,
                last_value_date DATE,
                last_run_id VARCHAR,
                last_status VARCHAR,
                updated_at TIMESTAMP
            )
            """
        )

    def get(self, series_id: str) -> Optional[Watermark]:
        row = self._con.execute(
            """
            SELECT series_id, checked_through_date, last_value_date
            FROM control.ingestion_watermark
            WHERE series_id = ?
            """,
            [series_id],
        ).fetchone()
        if row is None:
            return None
        return Watermark(series_id=row[0], checked_through_date=row[1], last_value_date=row[2])

    def advance(
        self,
        series_id: str,
        checked_through_date: date,
        last_value_date: Optional[date],
        run_id: str,
    ) -> None:
        self._con.execute(
            """
            INSERT INTO control.ingestion_watermark
                (series_id, checked_through_date, last_value_date, last_run_id, last_status, updated_at)
            VALUES (?, ?, ?, ?, 'success', ?)
            ON CONFLICT (series_id) DO UPDATE SET
                checked_through_date = excluded.checked_through_date,
                last_value_date = excluded.last_value_date,
                last_run_id = excluded.last_run_id,
                last_status = excluded.last_status,
                updated_at = excluded.updated_at
            """,
            [series_id, checked_through_date, last_value_date, run_id, datetime.now()],
        )


def process_series(
    series_id: str,
    watermark_store: WatermarkStore,
    fetch: Callable[[str, date, date], FetchResult],
    write_bronze: Callable[[str, FetchResult, str, date], None],
    validate_bronze: Callable[[str, FetchResult], bool],
    load_silver: Callable[[str, FetchResult], None],
    validate_silver: Callable[[str], bool],
    today: Optional[date] = None,
) -> None:
    today = today or date.today()
    run_id = str(uuid4())

    watermark = watermark_store.get(series_id)
    if watermark is None or watermark.checked_through_date is None:
        data_inicial = today - timedelta(days=BACKFILL_DAYS)
    else:
        data_inicial = watermark.checked_through_date + timedelta(days=1)

    data_final = today

    if data_inicial > data_final:
        logger.info("%s: já em dia, nada a fazer", series_id)
        return

    try:
        fetch_result = fetch(series_id, data_inicial, data_final)
    except (requests.exceptions.HTTPError, requests.exceptions.Timeout, requests.exceptions.ConnectionError):
        logger.exception("%s: falha ao chamar a API do BC, watermark não avança", series_id)
        return

    write_bronze(series_id, fetch_result, run_id, today)

    if not validate_bronze(series_id, fetch_result):
        logger.warning("%s: GX reprovou o bronze, watermark não avança", series_id)
        return

    load_silver(series_id, fetch_result)

    if not validate_silver(series_id):
        logger.warning("%s: GX reprovou o silver, watermark não avança", series_id)
        return

    # se a janela não trouxe linha nova (ex: fim de semana), mantém o último
    # last_value_date conhecido em vez de apagá-lo com None
    last_value_date = fetch_result.max_reference_date
    if last_value_date is None and watermark is not None:
        last_value_date = watermark.last_value_date

    watermark_store.advance(
        series_id=series_id,
        checked_through_date=data_final,
        last_value_date=last_value_date,
        run_id=run_id,
    )
