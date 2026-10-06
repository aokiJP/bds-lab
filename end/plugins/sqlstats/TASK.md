# sqlstats

## Request
A real SQL database (SQLite) of player statistics: /stats [name], /top <blocks|deaths|joins>. BDS scripts store only small dynamic properties: no queries, no sorting, no sharing with other programs.

## Acceptance (one tests.txt `## ` section each)
- [x] blocks a player breaks are counted in SQLite
- [x] the database survives a restart, joins keep counting
- [x] the file is a normal SQLite database other programs can read

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
