# unbreakable

## Request
/unbreakable: the item in hand never wears out (NBT tag Unbreakable), /nbt shows the held item's full NBT. BDS scripts cannot read or write item NBT (only the few properties the API exposes).

## Acceptance (one tests.txt `## ` section each)
- [x] the held pickaxe gets the Unbreakable tag and keeps it
- [x] it really does not wear: digging leaves its damage at 0

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
