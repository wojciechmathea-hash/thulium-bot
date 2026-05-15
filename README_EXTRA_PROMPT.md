# Backend v1.2.3 - dodatkowy prompt do generowania odpowiedzi

Endpoint `POST /api/generate-reply` przyjmuje teraz opcjonalne pole:

```json
{
  "ticketId": "123",
  "tone": "professional",
  "extraEmails": [],
  "extraPrompt": "Napisz krótko, podkreśl że konto zostało aktywowane."
}
```

`extraPrompt` jest przekazywany do modelu jako dodatkowa instrukcja konsultanta tylko dla tej konkretnej odpowiedzi.
