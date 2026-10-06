# webapi

## Request
Web API: the server answers HTTP. GET /status (players, TPS), GET /players/<name>, POST /say (token). BDS scripts cannot listen on a socket at all (@minecraft/server-net only sends requests out).

## Acceptance (one tests.txt `## ` section each)
- [x] GET /status lists the players the server sees
- [x] GET /players/<name> and 404 for someone offline
- [x] POST /say needs the token, then reaches players
- [x] survives /reload (the port is closed and opened again)

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
