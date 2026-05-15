# Backend v1.2.4 - Leaderboards

Dodane endpointy:
- `GET /api/leaderboard`
- `POST /api/leaderboard-login`
- `POST /api/leaderboard-event`

Dla trwałych statystyk na Render ustaw Persistent Disk i ENV:
```env
LEADERBOARD_STORE_PATH=/var/data/thulium_ai_leaderboard.json
```

Liczenie:
- wysłana odpowiedź = answered +1, closed +1, points +10,
- zamknięcie bez odpowiedzi = closed +1, points +4,
- wybór/logowanie agenta = rejestracja użytkownika bez zwiększania odpowiedzi.
