# tempban

## Request
/tempban <player> <minutes> [reason]: kicks now and refuses the player's login until the time is up, showing the reason and the time left on their disconnect screen; kept across restarts (bans.json). /bans lists them, /unban2 <player> lifts one early. BDS scripts can kick, but cannot refuse a login or show why.

## Acceptance (one tests.txt `## ` section each)
- [x] an operator bans a player for some minutes: kicked now with the reason
- [x] the banned player cannot log in again until the time is up, and sees why
- [x] the ban survives a server restart and is listed
- [x] it ends by itself when the time is up
- [x] /unban2 lets them in early
- [x] wrong input is refused
- [x] players without op cannot ban

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
