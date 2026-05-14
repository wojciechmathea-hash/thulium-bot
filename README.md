# Thulium AI Agent Backend v0.5.0

Dodaje deep context:
- historia zgłoszeń Thulium po adresie e-mail klienta,
- odczyt read-only dokumentów Autenti,
- dotychczasowy odczyt platform EDU/VOD,
- endpoint `/api/customer-deep-context`,
- `includeDeepContext` w `/api/generate-reply`.

Render:
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Health Check Path: `/health`

Hasła trzymaj wyłącznie w Render Environment.
