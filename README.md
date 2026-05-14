# Thulium AI Agent Backend v0.9.5

Poprawka:
- naprawiono błąd `isWriteAllowed is not defined`,
- dodano samowystarczalny write guard `exactWriteAllowed`,
- endpointy ticketów nadal są zgodne z PDF Thulium:
  - `POST /api/tickets/:id/agent_response`
  - `PUT /api/tickets/:id`
  - `GET /api/ticket_statuses`
  - `GET /api/ticket_categories`
  - `GET /api/ticket_queues`

Kolejność działania:
1. preflight statusu/kategorii,
2. wysyłka odpowiedzi,
3. dopiero po udanej wysyłce zamknięcie ticketu i ustawienie kategorii.

Wymagane do realnej wysyłki:
```env
THULIUM_TICKET_WRITE_ENABLED=true
```
