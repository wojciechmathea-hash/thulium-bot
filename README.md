# Thulium AI Agent Backend v0.7.0

Nowości:
- rozbudowane funkcje zgłoszeń Thulium,
- słowniki ticketów: statusy, kolejki, kategorie, statystyki dzienne,
- wyszukiwanie zgłoszeń,
- ładowanie zgłoszenia i deep context,
- bezpieczne akcje write jako dry-run domyślnie,
- `THULIUM_TICKET_WRITE_ENABLED=false` domyślnie.

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

## Nowe endpointy

- `GET /api/ticket-dictionaries`
- `POST /api/ticket-load`
- `POST /api/ticket-search`
- `POST /api/ticket-update`
- `POST /api/ticket-comment`
- `POST /api/ticket-agent-response`

## Bezpieczeństwo zapisów

Operacje zapisujące domyślnie działają jako dry-run.

Aby pozwolić backendowi na zapisy w Thulium, ustaw w Render:
```env
THULIUM_TICKET_WRITE_ENABLED=true
```

Wtyczka nadal pokazuje tryby i wymaga świadomego wyboru.
