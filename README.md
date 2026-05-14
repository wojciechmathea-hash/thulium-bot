# Thulium AI Agent Backend v0.9.6

Poprawka na podstawie odpowiedzi Thulium:

Thulium zwrócił:
`Pole "body" nie może być puste.`

To potwierdza, że endpoint jest poprawny:
`POST /api/tickets/:id/agent_response`

Problemem był format payloadu. Wersja v0.9.6 testuje teraz dużo więcej formatów pola `body`, m.in.:

- `{ "body": { "content": "..." } }`
- `{ "body": { "text": "..." } }`
- `{ "body": { "html": "<p>...</p>" } }`
- `{ "body": [{ "type": "text", "content": "..." }] }`
- `{ "body": [{ "content_type": "text/html", "content": "<p>...</p>" }] }`
- `body[content]=...`
- `body[text]=...`
- `body[html]=...`

Kolejność nadal jest bezpieczna:
1. preflight statusu/kategorii,
2. wysyłka odpowiedzi,
3. dopiero po udanej wysyłce zamknięcie ticketu i ustawienie kategorii.

Wymagane do realnej wysyłki:
```env
THULIUM_TICKET_WRITE_ENABLED=true
```
