# JSON UI Demo

## What it does
A server form with its own look, as the sample for the app lab (`node lab.mjs app run -a jsonui_demo`). `/scriptevent demo:open` (console) or `/lab:menu` (a player) shows an ActionFormData whose title starts with the invisible marker `§d§e§m§o§r`; rp/ui/server_form.json draws such forms as a dark card with a gold header, the body and the buttons, and leaves every other form vanilla. The pick prints `DEMO <name> picked <diamond|emerald|close|closed>`.

## Acceptance (each line = one tests.txt section)
- [x] the demo form reaches a real client with its marker in the title
- [x] a player opens it with /lab:menu

## Do not
- loosen tests.txt to make it pass
