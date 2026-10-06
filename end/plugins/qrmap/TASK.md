# qrmap

## Request
/qr <text>: a map item showing a scannable QR code of the text (the pure-Python `qrcode` library from PyPI). Any Python library works the same way (`node lab.mjs lib add <pkg>`); BDS scripts can use no native or PyPI code.

## Acceptance (one tests.txt `## ` section each)
- [x] a QR code map for a URL
- [x] the code is a real QR (finder patterns in three corners)

## Guessed
- sample of what this platform can do and BDS cannot (bds-lab showcase)
