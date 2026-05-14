# Thulium AI Agent Backend v0.9.2

Poprawka:
- naprawiono błąd `sendTicketReplySmart is not defined`,
- wysyłka nadal działa w trybie: najpierw wyślij odpowiedź, dopiero potem zamknij ticket,
- jeśli wysyłka nie działa, ticket nie jest zamykany,
- kategorie nie są tworzone; backend wybiera wyłącznie z kategorii istniejących w Thulium,
- jeśli konsultant wybierze/wpisze kategorię, której nie ma w Thulium, wiadomość nie zostanie wysłana i ticket nie zostanie zamknięty.

Wymagane do realnej wysyłki:
```env
THULIUM_TICKET_WRITE_ENABLED=true
```
