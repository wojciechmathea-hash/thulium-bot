# Backend v1.2.2 - losowanie tylko z wybranych kolejek

Losowanie używa tylko kolejek:

- MFA
- MFA_TRADERS
- Profitable_Trader_AI
- SUPPORT_MFA_TRADERS
- BOK
- ALL_IN_TRADERS_PL
- ALL_IN_TRADERS_ENG
- ALLINTRADERS_AI

Backend pobiera kolejki z `/api/ticket_queues`, dopasowuje nazwy, a następnie filtruje kandydatów z `/api/tickets`.

Opcjonalnie w Render można nadpisać/dodać kolejki:

```env
THULIUM_RANDOM_QUEUE_NAMES=MFA,MFA_TRADERS,Profitable_Trader_AI,SUPPORT_MFA_TRADERS,BOK,ALL_IN_TRADERS_PL,ALL_IN_TRADERS_ENG,ALLINTRADERS_AI
```
