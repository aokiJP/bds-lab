# livemap

## Request
A live web map: open http://<server>:<port>/ in a browser to see the land from above and every player moving on it (refreshes by itself). GET /map.png is the picture, GET /players.json the positions. The land is redrawn one row per tick, so the server never stalls. BDS scripts cannot serve web pages, draw pictures or write files.

## Acceptance (one tests.txt `## ` section each)
- [x] a browser gets a page that shows the map and the players
- [x] the map shows the land from above, a block placed shows up within seconds
- [x] players appear as dots where they stand, and in players.json
- [x] players can ask for the address

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
