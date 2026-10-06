---
name: bds-forms
description: Build menus, shops and input forms that survive real players: closing, being busy, bad input. Use for ActionFormData / ModalFormData / MessageFormData work and kit ask / menu / input / confirm.
---

# Forms

Not for how a form looks (use `bds-json-ui`) or a whole shop or economy (start from `shop` in `bds-recipes`, then come back here).

1. kit `menu` / `input` / `confirm` / `ask` (signatures: AGENTS.md); each gives undefined when the player closes it: check before reading the answer.
2. A form a command opens: QA also closes it (a crash there is a Q line).
3. In tests.txt one section per path: `until form`, then a button, the inputs, or `@A form close` (line forms: AGENTS.md).

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- A closed form gives canceled (selection / formValues undefined): check it before reading the answer; kit ask/menu/input/confirm return undefined then. (when missed: cannot read property 'selection' of undefined when a player presses Esc) `api-form-cancel`
- A form shown while the player has another screen open is refused (UserBusy): kit ask() retries; plain show() does not. (when missed: the form never appears when opened from a chat word or right after joining) `api-busy`
<!-- rules:end -->

Done when `go` passes a section per button, one per input value at its edges (0, max, empty text) and one that closes the form.

Limits: `go` presses with real clients that a script drives, and `sim` only hints; neither shows how the form looks to a person, nor what a person would try that no section does.

Final report: list the buttons, values and close paths tested, then end with `say what was not verified` (the form's look, real-player presses, any path without a section).
