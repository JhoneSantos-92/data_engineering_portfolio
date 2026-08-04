import logging

import duckdb

from bcb_client import SERIES_CATALOG, fetch
from watermark import WatermarkStore, process_series

logger = logging.getLogger(__name__)


def main() -> None:
    con = duckdb.connect("warehouse.duckdb")
    store = WatermarkStore(con)
    series_ativas = [series_id for series_id, config in SERIES_CATALOG.items() if config.ativa]

    for series_id in series_ativas:
        try:
            # TODO: falta write_bronze/validate_bronze/load_silver/validate_silver — etapas 4-6
            process_series(series_id, watermark_store=store, fetch=fetch)
        except Exception:
            logger.exception("%s: falha inesperada, série pulada nesta execução", series_id)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
