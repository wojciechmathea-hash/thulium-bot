# Thulium AI Agent Backend v0.8.0

Nowości:
- workflow prosty dla konsultanta: wygeneruj → edytuj → wyślij,
- sugestia kategorii z kontekstu ticketu,
- automatyczne ustawianie statusu `Zamknięte`,
- endpoint wysyłki wiadomości z panelu,
- endpoint ustawienia statusu/kategorii,
- nadal obsługuje deep context, Autenti, multi-email, Ticket Ops.

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

- `POST /api/ticket-apply-close-category`
- `POST /api/ticket-send-final`

## Ważne

Aby realnie zmieniać ticket / wysyłać wiadomość z panelu, ustaw w Render:

```env
THULIUM_TICKET_WRITE_ENABLED=true
```

Jeśli zostanie `false`, backend zwróci błąd bezpieczeństwa i nic nie zmieni.
