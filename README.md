# Thulium AI Agent Backend v0.9.4

Poprawka zgodna z PDF Thulium REST API:
- używamy dokładnie endpointu wysyłki z dokumentacji:
  `POST /api/tickets/:id/agent_response`
- zamknięcie i kategoria:
  `PUT /api/tickets/:id`
- słowniki:
  `GET /api/ticket_statuses`
  `GET /api/ticket_categories`
  `GET /api/ticket_queues`
- nie używamy wariantów typu `/reply`, `/messages`, `/responses`.

Bezpieczeństwo:
- najpierw preflight statusu/kategorii,
- potem wysyłka odpowiedzi,
- dopiero po udanej wysyłce PUT status/kategoria,
- jeżeli wysyłka nie przejdzie, ticket nie jest zamykany.

Uwaga:
PDF pokazuje endpoint, ale nie pokazuje body dla `agent_response`, więc backend próbuje kilka możliwych nazw pola:
`message`, `content`, `body`, `text`, `response` jako JSON, potem jako form-urlencoded.

Wymagane do realnej wysyłki:
```env
THULIUM_TICKET_WRITE_ENABLED=true
```
