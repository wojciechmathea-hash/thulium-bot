# Thulium AI Agent Backend v0.6.0

Nowości:
- `extraEmails` w `/api/customer-deep-context`, `/api/generate-reply`, `/api/preview-prompt`, `/api/mock-reply`
- kilka e-maili klienta traktowanych jako jeden klient
- analiza wszystkich e-maili w Thulium, Autenti, EDU i VOD

## Render

Build Command:
```bash
npm install && npm run build
```

Start Command:
```bash
npm start
```

Health Check Path:
```text
/health
```

## Przykład generate-reply

```json
{
  "ticketId": "12345",
  "tone": "professional",
  "mode": "preview",
  "includeDeepContext": true,
  "extraEmails": ["mail1@example.com", "mail2@example.com"]
}
```
