# autotape's own README demo — autotape recording itself (well, VHS recording
# autotape while autotape drives VHS). The agent wait is hidden with Wait+Screen.
Output docs/demo.gif
Require autotape
Set FontSize 22
Set Width 1500
Set Height 720
Set Padding 24
Set Margin 20
Set MarginFill "#0d1117"
Set BorderRadius 10
Set Framerate 30
Set TypingSpeed 100ms
Set Theme "Catppuccin Mocha"
Set CursorBlink false
Set WaitTimeout 300s

Type "autotape . --cmd 'node fixtures/greet.js' --out /tmp/greet-demo"
Enter
Sleep 3s
Hide
Wait+Screen /review passed|lint error|inconclusive/
Show
Sleep 5s
