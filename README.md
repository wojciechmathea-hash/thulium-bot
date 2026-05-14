# Thulium AI Agent Backend v0.3.0

Ta wersja ma skonfigurowanego Agenta AI oraz dodatkowe endpointy testowe.

## Render

Build Command:
```bash
npm install && npm run build
```

Start Command:
```bash
npm start
```

Health Check Path:
```text
/health
```

## Endpointy

- `GET /health`
- `GET /api/agent-config` — pokazuje aktywną konfigurację agenta
- `POST /api/preview-prompt` — pobiera ticket z Thulium i pokazuje prompt bez wywołania OpenAI
- `POST /api/mock-reply` — testuje wtyczkę bez OpenAI i bez pobierania ticketu
- `POST /api/generate-reply` — normalne generowanie przez OpenAI
- `POST /api/test-thulium`
- `POST /webhooks/thulium`

## Konfiguracja Agenta

Możesz nadpisać instrukcje w Render Environment:

- `AGENT_INSTRUCTIONS`
- `AGENT_BUSINESS_RULES`
- `AGENT_KNOWLEDGE_BASE`

Jeżeli ich nie ustawisz, backend użyje domyślnej konfiguracji w `server.js`.

## Ważne

Nie wgrywaj klucza OpenAI do GitHuba ani do wtyczki. Klucz OpenAI ustaw wyłącznie w Render jako `OPENAI_API_KEY`.
