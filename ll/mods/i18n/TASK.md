# i18n

## Request
Every player reads the server in their own game language (Player.langCode): the join greeting, /rules and operator announcements (/announce <key>: one broadcast, each player gets their language). /lang <code|auto> overrides it and is remembered across restarts. BDS scripts cannot see a player's language.

## Acceptance (one tests.txt `## ` section each)
- [x] each player is greeted in their own game language
- [x] /rules answers in the player's language
- [x] one /announce reaches everyone, each in their language
- [x] an unknown language falls back to English
- [x] /lang overrides the game language and is remembered after a restart
- [x] wrong input is refused politely

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
