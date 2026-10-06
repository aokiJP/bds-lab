# guard

## Request
/guard <x1> <z1> <x2> <z2>: a no-entry zone. Moves into it are cancelled on the server (the client is pulled back); BDS scripts cannot stop a player's movement, only teleport them afterwards.

## Acceptance (one tests.txt `## ` section each)
- [x] walking into the zone is stopped at its edge
- [x] the zone survives a restart (saved in the plugin's folder)
- [x] off: free to walk in

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
