# Random Open Ticket - backend v1.2.0

Dodane endpointy:

- `GET /api/random-open-ticket`
- `POST /api/random-open-ticket`

Backend korzysta z endpointów Thulium widocznych w PDF:
- `GET /api/tickets` — lista zgłoszeń
- `GET /api/ticket_statuses` — lista statusów zgłoszeń

Logika:
1. Pobiera statusy.
2. Szuka statusu otwartego/nowego (`Nowy`, `Open`, `Otwarty`, `New`).
3. Pobiera listę ticketów przez `/api/tickets`.
4. Filtruje otwarte tickety.
5. Zwraca losowy ticket i jego `ticketId`.

Wtyczka powinna używać `/api/random-open-ticket`, nie `/api/ticket-search`.
