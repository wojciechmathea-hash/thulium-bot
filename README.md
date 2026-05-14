# Thulium AI Agent Backend v1.0.1-clean

Ta paczka jest zrobiona na podstawie screena dokumentacji `POST tickets/:id/agent_response`.

## Najważniejsza poprawka

Wysyłka odpowiedzi używa dokładnie payloadu z dokumentacji:

```json
{
  "body": "Treść wiadomości",
  "body_type": "PLAIN",
  "user_login": "CHATGPT"
}
```

Wcześniej błędnie testowaliśmy `body` jako obiekt, np. `{ "body": { "content": "..." } }`, a dokumentacja pokazuje, że `body` to zwykły string.

## ENV

W Render ustaw:

```env
THULIUM_TICKET_WRITE_ENABLED=true
THULIUM_AGENT_LOGIN=CHATGPT
THULIUM_AGENT_RESPONSE_BODY_TYPE=PLAIN
```

`THULIUM_AGENT_LOGIN` musi być loginem agenta/użytkownika w Thulium, który może wysyłać odpowiedzi. Jeśli `CHATGPT` jest tylko użytkownikiem API i nie jest agentem, ustaw tu login prawdziwego agenta.

## Health

Po wdrożeniu `/health` musi pokazać:

```json
"version": "1.0.1-clean",
"senderVersion": "v1.0.1-exact-pdf-payload",
"exactPdfPayload": true
```
