# worldpng

## Request
/worldpng [radius]: a top-down picture of the land around the player (block colors, shaded by height like a map), saved as a PNG file in the plugin folder (for a website, Discord, backups) and handed to the player as a map item showing the same picture. BDS scripts can neither write files nor draw on maps.

## Acceptance (one tests.txt `## ` section each)
- [x] a player gets a PNG of the land around them, with the blocks' colors
- [x] the same picture comes as a map item
- [x] a raised block is lit and the ground south of it in shadow (like a vanilla map)
- [x] wrong input is refused

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
