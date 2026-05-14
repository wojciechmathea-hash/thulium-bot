# Thulium AI Agent Backend v0.9.1

Krytyczna poprawka:
- backend najpierw wysyła odpowiedź,
- dopiero po udanej wysyłce zamyka ticket i ustawia kategorię,
- jeżeli wysyłka nie działa, ticket NIE jest zamykany.

Dodatkowo:
- testuje kilka możliwych endpointów odpowiedzi Thulium,
- zwraca diagnostykę `attempts`, jeśli żaden endpoint nie zadziała,
- generowanie odpowiedzi nie wykonuje już realnego zamknięcia ticketu; tylko sugeruje kategorię/status,
- AI ma instrukcję, że odpowiada na ostatnią wiadomość klienta, a resztę traktuje jako kontekst.

Render:
```bash
npm install && npm run build
npm start
```

Realne wysyłanie i zamykanie wymaga:
```env
THULIUM_TICKET_WRITE_ENABLED=true
```
