# Backend v1.2.1 - poprawka losowania ticketów

Problem z poprzedniej wersji:
- Thulium potrafi zwracać HTTP 500 dla `/api/tickets?status_id=1`.
- Dlatego backend nie powinien zaczynać losowania od filtrów statusu.

Co zmieniono:
- `/api/random-open-ticket` najpierw odpytuje `/api/tickets` bez filtrów.
- Dopiero później próbuje warianty z paginacją i statusami.
- Dodano głębokie wyciąganie ticketów z różnych struktur odpowiedzi.
- Dodano fallback `loose`, który wybiera ticket-like rekordy, jeśli odpowiedź nie zawiera statusu w przewidywalnej strukturze.

Nowy ENV opcjonalny:

```env
THULIUM_RANDOM_TICKET_FILTER_MODE=loose
```

`loose` jest domyślny.
