# Arquitetura — Pipeline de Indicadores Econômicos BR (BCB)

Etapa 1 do ciclo do projeto. Define camadas, fluxo de dados e decisões técnicas antes de travar a estrutura de pastas (etapa 2).

## Fonte de dados

API pública do Banco Central (SGS + Olinda/PTAX) — três séries com cadências diferentes:

| Série | Endpoint | Cadência real |
|---|---|---|
| Câmbio (`USD/BRL`) | Olinda/PTAX | diária, dias úteis |
| Selic (taxa diária) | SGS, código 11 | diária, dias úteis |
| IPCA (variação mensal) | SGS, código 433 | mensal, ~dia 8-10 do mês seguinte |

Sem autenticação, sem custo. Cadências diferentes importam para o watermark (ver seção dedicada) — nem todo dia gera linha nova em todas as séries, e isso é esperado, não é falha de qualidade.

- Schema pensado para múltiplas séries desde o início; cada série ganha sua própria tabela Silver (grãos diferentes: câmbio tem compra/venda, Selic é uma taxa, IPCA é uma variação mensal) — unificação só acontece em Gold/Diamond via join por data.
- Backfill inicial: últimos 90 dias corridos por série (IPCA vai trazer só ~3 observações mensais nesse intervalo — normal).

## Camadas (Medallion + Diamond)

```
BCB API (SGS + PTAX)
   |  requests (retry/backoff, watermark decide o intervalo de datas)
   v
Bronze (JSON bruto + metadata, append-only)   -- [GX checkpoint 1: shape, nulls, tipos]
   |  parse + tipagem + dedupe
   v
Silver (Parquet/Delta tipado, por série)      -- [GX checkpoint 2: regras de negocio]
   |  dbt models (Silver -> Gold)
   v
Gold (agregados por série, dbt-duckdb)
   |  dbt models (Gold -> Diamond, cross-series)
   v
Diamond (KPIs derivados, produto de dado)
   |
   v
Consumo (BI / notebook / API)
```

### Bronze — dados brutos
- JSON cru da API, sem transformação, **append-only** (nunca reescreve o passado).
- Caminho: `data/bronze/{series_id}/ingestion_date=YYYY-MM-DD/run_id=<uuid>.json`, onde `series_id` ∈ `{ptax_usd_brl, selic, ipca}`.
- Metadados embutidos: `_ingested_at`, `_source_url`, `_request_params`, `_run_id`.
- Particionado por **data de ingestão** (não data de referência) — permite auditar/reprocessar execuções sem perder histórico.

### Silver — dados validados e tipados
- Uma tabela por série (grãos diferentes, não força schema único):
  - `silver.fx_rates(reference_date, currency_pair, bid_rate, ask_rate, quote_datetime, source_run_id)`
  - `silver.selic_rates(reference_date, selic_daily_rate, source_run_id)`
  - `silver.ipca_index(reference_month, ipca_monthly_variation, source_run_id)`
- Dedupe por chave natural de cada série (`reference_date`/`reference_month` + identificador da série).
- Formato: Parquet agora → Delta Lake quando `deltalake` entrar (ACID + time travel).
- Só entra em Silver o que passar no checkpoint GX sobre o Bronze.

### Gold — pronto para consumo, por série
- Agregados de negócio via dbt-duckdb: `fx_daily_summary`, `selic_monthly_avg`, `ipca_accumulated_12m`.

### Diamond — insight / produto de dado (equivalente ao que algumas empresas chamam de "Platinum")
- KPIs derivados **cross-série**, o valor que não existe em nenhuma fonte isolada — isso é o que vira produto vendável:
  - `diamond.juro_real_diario` — Selic anualizada − IPCA acumulado 12m (indicador clássico de mercado).
  - `diamond.termometro_cambial` — z-score da variação diária do câmbio vs. volatilidade histórica de 30 dias (sinaliza dias de estresse cambial).
  - `diamond.indice_risco_brasil` — score composto 0-100 normalizando volatilidade cambial + juro real + variação do IPCA (o tipo de indicador que uma fintech/consultoria pagaria para consumir via API).
- Materializado como modelos dbt em cima de Gold.

## Carga incremental — mecanismo de watermark

**Problema:** o pipeline não pode olhar manualmente "qual foi a última data ingerida". Isso precisa ser algo que ele mesmo consulta e atualiza a cada execução, por série (cada uma com sua própria cadência).

**Mecanismo escolhido: tabela de controle** (não inferir a partir de scan no Bronze — mais lento, mais frágil, sem espaço pra guardar estado de falha).

```
control.ingestion_watermark
├── series_id            (PK) -- 'ptax_usd_brl' | 'selic' | 'ipca'
├── checked_through_date       -- ultima data ate onde o pipeline JA CONFIRMOU
│                                  (com ou sem dado novo) — usada pra calcular a proxima janela
├── last_value_date            -- ultima data que REALMENTE trouxe uma observacao
│                                  (serve pra observabilidade: se checked_through
│                                  se afasta muito de last_value_date, a serie
│                                  pode ter parado de publicar / API mudou)
├── last_run_id
├── last_status                -- 'success' | 'failed'
└── updated_at
```

Por que dois campos de data em vez de um só "última data ingerida"? Porque Selic/Câmbio não publicam todo dia (fins de semana) e IPCA só publica 1x/mês — se eu avançasse o watermark só quando *chega dado novo*, a janela de busca (`data_inicial..data_final`) cresceria indefinidamente nos dias sem publicação, e o pipeline reconsultaria o mesmo intervalo vazio repetidas vezes. `checked_through_date` resolve isso: avança sempre que a checagem foi bem-sucedida, tenha vindo dado ou não.

Pseudocódigo, uma execução por série (Airflow roda isso 1x/dia, com um task por `series_id`, ou task dinâmico mapeado sobre as 3 séries):

```
função processar_serie(series_id):
    watermark = SELECT checked_through_date, last_value_date
                FROM control.ingestion_watermark
                WHERE series_id = series_id

    se watermark não existe:
        # primeira carga da série
        data_inicial = hoje - 90 dias
    senão:
        data_inicial = watermark.checked_through_date + 1 dia

    data_final = hoje  # (ou hoje-1 se a serie so consolida no dia seguinte)

    se data_inicial > data_final:
        log("série já em dia, nada a fazer")
        retorna

    resposta = chamar_api_bcb(series_id, data_inicial, data_final)

    se resposta.falhou:
        log_erro(resposta)
        alerta(series_id, "falha na chamada da API")
        retorna   # watermark NÃO avança -> próxima execução tenta a mesma janela de novo

    escrever_bronze(series_id, resposta, run_id, ingestion_date=hoje)   # append

    checkpoint_1 = great_expectations.validar_bronze(series_id, resposta)
    se checkpoint_1.falhou:
        alerta(series_id, "GX reprovou o bronze")
        retorna   # watermark não avança; dado já está no bronze pra auditoria,
                   # mas não é promovido, e a janela será reprocessada na próxima run

    carregar_silver(series_id, resposta)   # parse + tipagem + dedupe
    checkpoint_2 = great_expectations.validar_silver(series_id)
    se checkpoint_2.falhou:
        alerta(series_id, "GX reprovou o silver")
        retorna   # mesma lógica: não avança watermark

    # só chega aqui se TUDO passou
    nova_last_value_date = MAX(data das linhas retornadas) se resposta tem linhas, senão watermark.last_value_date

    UPDATE control.ingestion_watermark
    SET checked_through_date = data_final,
        last_value_date = nova_last_value_date,
        last_run_id = run_id,
        last_status = 'success',
        updated_at = agora()
    WHERE series_id = series_id
```

Pontos que fazem isso seguro pra rodar sozinho, sem supervisão manual:

- **Idempotente por construção:** o watermark só avança depois que Bronze *e* os dois checkpoints GX passam. Se cair no meio, a próxima execução automaticamente reprocessa a mesma janela — não precisa de ninguém olhando pra decidir "de onde eu retomo".
- **Bronze append-only + watermark separado** significa que reprocessamento total do histórico (mudança de schema, bug) é só resetar (ou ignorar) a linha do `control.ingestion_watermark` daquela série e rodar com uma flag `--full-refresh` que força `data_inicial = data mínima histórica` — sem tocar no Bronze já gravado (novas partições de `ingestion_date`, Silver é quem decide reconstruir a partir de todo o Bronze).
- **Observabilidade de graça:** o gap entre `checked_through_date` e `last_value_date` vira uma métrica pronta pra etapa 9 (alerta se uma série some por N dias além do esperado pela sua cadência).

## Execução

Airflow, 1x/dia (`@daily`), DAG `bcb_indicadores_pipeline`, com task dinâmico por série:
`[extract_bronze, validate_bronze, load_silver, validate_silver] × {ptax_usd_brl, selic, ipca} → dbt_run_gold → dbt_run_diamond → notify`

## Decisões técnicas (formalizar como ADR na etapa 11)

| Decisão | Alternativa descartada | Motivo |
|---|---|---|
| Great Expectations | Pandera | Familiaridade prévia; evita duas libs cobrindo o mesmo papel ([[feedback_lean_tooling]]) |
| Airflow | Dagster | Consistência com o case `data-patching-medallion` já publicado no portfólio |
| Bronze particionado por data de ingestão, append-only | Particionar/sobrescrever por data de referência | Auditoria e reprocessamento sem perder histórico de execuções |
| Watermark em tabela de controle (`checked_through_date` + `last_value_date`) | Inferir última data via scan no Bronze | Mais rápido, guarda estado de falha, evita janela de busca crescer indefinidamente em séries com gap (fim de semana / mensal) |
| Camada Diamond além de Gold | Parar em Gold | KPIs cross-série (juro real, risco cambial) são o produto de dado real; não existem isolados em nenhuma fonte |
| Uma tabela Silver por série (grão próprio) | Schema único tipo EAV (`series_id, metric, value`) | Câmbio tem 2 valores (compra/venda), Selic e IPCA têm grão de tempo diferente — forçar schema único complica sem necessidade |
| Execução 1x/dia | Streaming / múltiplas vezes ao dia | BC atualiza no máximo 1x por dia útil; rodar mais rápido não traria dado novo |
| pip-tools (`requirements.in` + `pip-compile`) | `pip freeze` bruto | Lock file reprodutível e revisável |

## Próxima etapa

Etapa 2 — estrutura de repositório (pastas seguindo convenção de mercado), a partir deste desenho.
