# cmdguard

## Request
Sees every command a player types, vanilla ones included, before it runs: /mute <player> [minutes] silences chat AND /tell /msg /w /me (a BDS script can only stop chat); short aliases (/day /night /gmc /gms) rewrite into the real command; every command is written to commands.log with time and place. BDS scripts cannot see or change vanilla commands.

## Acceptance (one tests.txt `## ` section each)
- [x] a muted player can neither chat nor whisper (/tell /msg /w /me)
- [x] other players still talk, and /unmute gives the voice back
- [x] short aliases run the real command
- [x] every command is logged with the time and place
- [x] wrong input is refused; players without op cannot mute

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
