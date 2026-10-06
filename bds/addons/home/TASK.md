# Home

## Request
/lab:sethome で今いる場所を家にし、/lab:home でそこへ戻る。ネザーなど別のディメンションの家にも戻れる。再起動しても覚えている。/lab:home は 10 秒に 1 回

## Acceptance (one tests.txt `## ` section each)
- [x] 家が無いうちは /lab:home がそう言う（## no home yet）
- [x] /lab:sethome で今いる場所を家にし、/lab:home でそこへ戻る（## set a home, walk away, go back）
- [x] /lab:home は 10 秒に 1 回（## home again within 10 seconds is refused）
- [x] ネザーなど別のディメンションの家にも戻れ、再起動しても覚えている（## a home in the nether, after a restart）

## Guessed
<!-- values decided without asking -->
