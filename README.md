# Thulium AI Agent Backend v0.9.7

Ta wersja wymusza nową logikę wysyłki:
- usuwa poprzednie definicje `sendTicketReplySmart`,
- używa tylko endpointu z PDF:
  `POST /api/tickets/:id/agent_response`,
- zaczyna od strukturalnego payloadu:
  `{ "body": { "content": "..." } }`,
- w `sendResult` pojawia się:
  `"senderVersion": "v0.9.7-structured-body-only"`.

Jeżeli po wdrożeniu w błędzie dalej widzisz pierwsze próby:
`{ "message": "..." }`, `{ "content": "..." }`,
to Render nadal uruchamia starą wersję backendu.

Wymagane do realnej wysyłki:
```env
THULIUM_TICKET_WRITE_ENABLED=true
```
