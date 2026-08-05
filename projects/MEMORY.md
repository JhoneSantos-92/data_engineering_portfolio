# Estado do projeto — Pipeline de Indicadores Econômicos BR (BCB)

Este arquivo é o "estado atual" do projeto: qualquer sessão futura (Claude Code ou outra ferramenta) deve conseguir retomar o trabalho a partir daqui, sem precisar reconstruir contexto de conversas anteriores.

## Objetivo

Pipeline de dados real usando a API SGS do Banco Central (séries: Selic código `11`, IPCA código `433`, Câmbio código `10813`), arquitetura medallion (Bronze → Silver → Gold → Diamond), carga incremental via watermark. Projeto de portfólio, construído de forma didática — decisões de design são discutidas e explicadas antes de implementadas. Ver `docs/architecture.md` para o desenho completo (fonte da verdade para decisões de arquitetura).

## Etapas concluídas e validadas

**Etapa 1 — Arquitetura:** camadas definidas, fonte de dados escolhida, estratégia de carga incremental com watermark decidida. Ver `docs/architecture.md`.

**Etapa 3 — Chamada à API do BC:** `src/bcb_client.py` completo:
- `fetch_serie_bcb`, `parse_rows`, `get_max_reference_date`
- `SeriesConfig` / `SERIES_CATALOG` (dataclass com campo `ativa: bool` — fonte única de verdade para quais séries existem e quais rodam hoje)
- `fetch(series_id, data_inicial, data_final) -> FetchResult`, assinatura `Callable[[str, date, date], FetchResult]`
- Exceções de rede documentadas na docstring (`HTTPError`, `Timeout`, `ConnectionError`)

**Etapa 8 — Orquestração (estruturalmente pronta):** `src/watermark.py`:
- `WatermarkStore`, `Watermark`, `FetchResult`, `process_series`
- Testado com 6 cenários via smoke test: primeira execução/backfill de 90 dias, idempotência no mesmo dia, janela sem dado novo (fim de semana) preservando `last_value_date`, GX reprovando o bronze bloqueando o avanço do watermark, falha de rede no `fetch` capturada especificamente (log distinto, watermark não avança), `KeyError` de série mal cadastrada propagando sem ser engolido pelo catch de rede
- `src/run_daily.py` como entrypoint: deriva a lista de séries ativas de `SERIES_CATALOG` filtrando `ativa=True` (sem lista hardcoded duplicada)

## Decisão de persistência

Watermark e dados (Bronze/Silver/Gold) no mesmo arquivo DuckDB local (`warehouse.duckdb`), schema `control` separado para metadados de execução (`control.ingestion_watermark`).

**Limitação conhecida e aceita para o escopo atual:** não suporta múltiplos workers concorrentes escrevendo ao mesmo tempo. Migraria para Postgres se o projeto crescesse para execução distribuída de verdade.

## Pendente, de propósito

`write_bronze`, `validate_bronze`, `load_silver`, `validate_silver` (etapas 4, 5, 6) ainda não implementados. `process_series` já espera essas quatro funções como parâmetros (`Callable`), mas `run_daily.py` ainda não tem o que passar — **não roda de ponta a ponta até essas peças existirem**. Marcado com `# TODO` no código; isso é o estado esperado do projeto nesta etapa, não é bug.

## Ainda não formalizado

Etapa 2 (estrutura de pastas) — ver histórico do repositório/commits para o estado mais recente após esta sessão.
