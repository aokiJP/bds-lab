# WebSocket でつなぐ。
#
# 道を ws に切り替えて、つなぎ先を画面に出す。
# `/connect`（= `/wsserver`）は**クライアント側の命令**で、ビヘイビアーパックの
# function からは実行できない。宛先は出すので、チャットにそのまま貼ってほしい。
#
# つなぎ先を変えるには /scriptevent tsrepl:ws ws://127.0.0.1:19131
scriptevent tsrepl:ws
