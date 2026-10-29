### Fixed
- The key bar's Show/Hide keyboard control on a touch screen no longer fights itself: its label,
  pressed state and its tap's action are one word from the tap, held until the measured keyboard
  confirms it or the settle window runs out — a tap can never do the opposite of what the control
  just said. Show puts a keyboard back after Android's back gesture (blur and refocus inside the
  tap; a focus alone raises nothing there), and the blur reads as the keyboard going where the
  measurement is blind (a zoomed page, a floating keyboard), the word standing through the hiding
  animation the measurement still reports.
- Switching the key bar's Input line and direct typing on a touch screen no longer raises and puts
  away the keyboard: direct to line hands the grid's keyboard to the input line, focus and all, so
  the keyboard stays up where the user had it.
