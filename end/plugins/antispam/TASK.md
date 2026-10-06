# antispam

## Request
Chat flood control at the packet level: more than 3 chat packets in 3 seconds are dropped before the game sees them (PacketReceiveEvent). BDS scripts can cancel a chat message but never see or drop raw packets.

## Acceptance (one tests.txt `## ` section each)
- [x] the 4th and 5th message within 3 s never reach the game
- [x] after the window, chat works again

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
