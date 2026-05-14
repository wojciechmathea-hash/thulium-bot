# Thulium AI Agent Backend v0.4.0

Wersja z konektorami read-only do platform EDU i VOD.

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

## Ważne

Build pobiera Chromium dla Playwright:
```bash
npx playwright install chromium
```

Jeżeli Render pokaże błąd z zależnościami systemowymi Chromium, najpierw ustaw `PLATFORM_LOOKUP_ENABLED=false` i wdroż backend bez odczytu platform. Potem można przenieść konektor na osobną usługę albo dodać Dockerfile.

## Endpointy

- `GET /health`
- `GET /api/agent-config`
- `POST /api/platform-context` body: `{ "email": "klient@example.com" }`
- `POST /api/preview-prompt`
- `POST /api/mock-reply`
- `POST /api/generate-reply`
- `POST /api/test-thulium`
- `POST /webhooks/thulium`

## Tryb read-only

Konektor korzysta z Playwright:
1. Loguje się na platformę.
2. Wchodzi do admina.
3. Próbuje znaleźć pole wyszukiwania i wpisać e-mail klienta.
4. Odczytuje widoczny tekst, tabele i linki.
5. Nie wykonuje żadnych kliknięć typu edycja/usuwanie/zapis.
