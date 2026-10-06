---
name: bds-json-ui
description: Change how screens look with JSON UI (rp/ui/*.json): custom server-form layouts for script forms, HUD elements, _ui_defs, namespaces, bindings. Use when the request is about the look of a form, menu or HUD rather than what it does.
---

# JSON UI

1. Make the form work first (`bds-forms`, tests on the real server); the look comes second.
2. Find the vanilla screen and element: `sample rp/ui/server_form.json [key/key]`, `help ui`.
3. A pixel layout: `ui build <layout.yaml>` → rp/ui/<screen>.json, registered in _ui_defs, plus a preview PNG of the boxes (read it).
4. Edit; `check` after each change (every @ref, _ui_defs entry, texture path and enum value is resolved against this pack and vanilla); `go`.
5. Report: what `check` resolved statically, what the tests proved about the form, and that the look needs a real client.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- A new rp/ui file is loaded only when listed in rp/ui/_ui_defs.json ("ui_defs": ["ui/x.json"]); a file named like a vanilla screen (server_form.json, hud_screen.json) changes that screen and keeps its namespace. (when missed: nothing changes in the game, no error anywhere) `ui-defs`
- Every name@base is namespace.element that exists in this pack or vanilla (`check` suggests the nearest); look the element up with `sample rp/ui/<screen>.json` instead of guessing. (when missed: Type not specified (or @-base not found) in the client log) `ui-refs`
- Only texture paths that exist (rp/textures or vanilla); an invented textures/ui/... draws nothing. (when missed: an invisible image) `ui-texture`
- Change a vanilla screen with small `modifications` (insert_front / insert_back / replace on its controls), never a copy of the whole file: a copy breaks on the next game update and hides other packs. (when missed: the screen breaks after a Minecraft update) `ui-modify` [source]
- Custom server forms: put a marker in the form title (title('§s§h§o§p§rShop')) and show the custom control with a view binding on #title_text; tests see the raw title (`~ title\("§s§h§o§p`). (when missed: every form turns custom, or none does) `ui-title-route` [source]
- BDS never loads RP UI and the test clients do not draw it: `check` passing is the only automatic proof. Say what was checked statically and that the look still needs a real client (`app run`, or the person). (when missed: a look reported that nobody saw) `ui-unverified` [source]
- A view binding needs source_property_name and target_property_name; a collection binding needs binding_collection_name. (when missed: a control that never shows or never updates) `ui-binding`
<!-- rules:end -->

Rules marked [source] come from a reference project and are not re-run here; the rest are proven by tests/rp-offline.mjs.
