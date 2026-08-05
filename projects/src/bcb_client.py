from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import requests

from watermark import FetchResult

BCB_SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados"


@dataclass(frozen=True)
class SeriesConfig:
    codigo: str
    ativa: bool = True


SERIES_CATALOG: dict[str, SeriesConfig] = {
    "selic": SeriesConfig(codigo="11"),
    "ipca": SeriesConfig(codigo="433"),
    "ptax_usd_brl": SeriesConfig(codigo="10813"),
}


def fetch_serie_bcb(codigo_serie: str, data_inicial: date, data_final: date) -> list[dict]:
    params = {
        "formato": "json",
        "dataInicial": data_inicial.strftime("%d/%m/%Y"),
        "dataFinal": data_final.strftime("%d/%m/%Y"),
    }
    url = BCB_SGS_URL.format(codigo=codigo_serie)
    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()
    return response.json()


def parse_rows(dados_brutos: list[dict]) -> list[dict]:
    return [
        {
            "reference_date": datetime.strptime(item["data"], "%d/%m/%Y").date(),
            "valor": float(item["valor"]),
        }
        for item in dados_brutos
    ]


def get_max_reference_date(rows: list[dict]) -> Optional[date]:
    if not rows:
        return None
    return max(row["reference_date"] for row in rows)


def fetch(series_id: str, data_inicial: date, data_final: date) -> FetchResult:
    """Busca uma janela de datas de uma série do SGS e monta o FetchResult.

    Raises:
        KeyError: series_id não está cadastrado em SERIES_CATALOG.
        requests.exceptions.HTTPError: resposta HTTP de erro (4xx/5xx) do SGS.
        requests.exceptions.Timeout: SGS não respondeu dentro do timeout de 10s.
        requests.exceptions.ConnectionError: falha de rede/DNS ao alcançar o SGS.
    """
    codigo_serie = SERIES_CATALOG[series_id].codigo
    dados_brutos = fetch_serie_bcb(codigo_serie, data_inicial, data_final)
    rows = parse_rows(dados_brutos)
    max_reference_date = get_max_reference_date(rows)
    return FetchResult(rows=rows, max_reference_date=max_reference_date)
