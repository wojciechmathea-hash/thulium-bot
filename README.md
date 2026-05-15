# Thulium AI Agent Backend v1.1.0-agent-login

Ta wersja dodaje wysyłkę odpowiedzi przez konto aktualnego konsultanta.

## Co się zmieniło

Endpoint `POST /api/ticket-send-final` przyjmuje teraz:

```json
{
  "ticketId": "1234",
  "content": "Treść odpowiedzi",
  "agentLogin": "login_agenta"
}
```

Backend wysyła do Thulium dokładnie payload z dokumentacji:

```json
{
  "body": "Treść odpowiedzi",
  "body_type": "PLAIN",
  "user_login": "login_agenta"
}
```

## Nowe endpointy

- `GET /api/agents` — lista agentów z Thulium
- `POST /api/agent-resolve` — walidacja/dopasowanie loginu agenta

## Ważne

API Thulium z PDF pozwala pobrać listę agentów przez `GET /api/agents` oraz dane agenta przez `GET /api/agents/:login`.
Nie ma w PDF endpointu typu „daj mi aktualnie zalogowanego użytkownika przeglądarki”.
Dlatego login bieżącego konsultanta wykrywa wtyczka z UI/session/localStorage, a backend go waliduje przez API.

## Health

Po wdrożeniu `/health` musi pokazać:

```json
"version": "1.1.0-agent-login",
"senderVersion": "v1.1.0-per-user-agent-login",
"perUserAgentLogin": true
```

## ENV

Zostaw fallback:

```env
THULIUM_AGENT_LOGIN=LOGIN_AWARYJNY
THULIUM_AGENT_RESPONSE_BODY_TYPE=PLAIN
THULIUM_TICKET_WRITE_ENABLED=true
```

W normalnym użyciu wtyczka prześle `agentLogin`, więc fallback nie powinien być używany.
