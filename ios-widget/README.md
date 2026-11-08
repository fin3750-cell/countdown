# iOS widget

## Why the web app cannot be the widget

iOS Home Screen and Lock Screen widgets are produced by a **WidgetKit
extension**, which is native Swift compiled in Xcode. There is no web API
that lets a website or a Progressive Web App publish a widget, and the web
app capabilities Apple has added for Home Screen web apps (Web Push,
badging, wake lock, and opening as a web app by default in iOS 26) do not
include widgets.

So there are exactly two ways to get a live countdown on the Home or Lock
Screen, and neither of them is "the website":

1. **Scriptable** — a free app that embeds a JavaScript runtime inside its
   own WidgetKit extension. `countdown-widget.js` in this folder is that
   script. No Xcode, no developer account.
2. **A native app** — your own WidgetKit extension in Swift. Full control
   and no third-party dependency, but it needs a Mac, Xcode, and an Apple
   Developer account to stay installed beyond 7 days.

"Add to Home Screen" on the web app is a third thing: a launcher icon, not
a widget. It opens the full app, but the numbers on the icon never change.

## Setup (Scriptable)

1. Install **Scriptable** from the App Store (free).
2. Open it, tap **+**, paste the whole of `countdown-widget.js`, and name
   the script **Countdown**.
3. Run it once inside the app to confirm it renders.
4. **Home Screen** — long-press the wallpaper → **+** → Scriptable → pick a
   size → Add. Then long-press the new widget → **Edit Widget** →
   Script: **Countdown**.
5. **Lock Screen** — long-press the Lock Screen → **Customise** → tap the
   widget area → add **Scriptable** → tap the placeholder → Script:
   **Countdown**.

Tapping the widget opens the web app.

If the widget reads "edit widget to select script", go back into Customise
and tap the widget to pick the script — the association does not always
take on the first attempt. On the Lock Screen, make sure you picked the
Scriptable widget of the shape you want (circular, rectangular or inline).

## Refresh rate: the real limitation

**iOS decides when widgets refresh.** It budgets refreshes across the day
and commonly lands somewhere around every 15–30 minutes. This cannot be
forced; `refreshAfterDate` in the script is a hint the system is free to
ignore.

This is why the widget leads with **days** and shows hours as a secondary
figure, and why minutes only matter on the final day. A minute-precision
widget would routinely display a stale minute and look broken.

Open the web app when you want the exact figure — that one is correct to
the second it is opened, because it recomputes from the clock on every
render and again on resume. The widget uses the same clock-derived
calculation, so whenever iOS *does* refresh it, the value drawn is correct
for that moment.

## Adjusting the Lock Screen font sizes

All Lock Screen sizes live in one block near the top of
`countdown-widget.js`:

```js
const LOCK = {
  circularNumber: 24,   // the big day count in the circular widget
  circularLabel: 9,     // the word "days" beneath it
  rectTitle: 11,        // the widget name, top line
  rectValue: 20,        // the hero line, e.g. "39d 2h"
  rectDate: 10          // the target date, bottom line
};
```

Change a number, save, and the widget picks it up on its next refresh
(or long-press → Edit Widget → reselect the script to force it sooner).

The Lock Screen is tight. Plan for roughly:

| Family | Outer size | Usable area |
| --- | --- | --- |
| `accessoryCircular` | ~72pt across | ~50 × 50pt (the inscribed square) |
| `accessoryRectangular` | ~160 × 72pt | ~152 × 64pt after padding |

At the defaults above the rectangular stack needs about 53pt of the 64pt
available and the circular about 40pt of 50pt, so there is room to go
larger if you want — but not much.

Three things are deliberate and worth leaving alone:

- **Every accessory text sets `minimumScaleFactor`.** Text that does not
  fit shrinks instead of truncating, so a three-digit day count degrades
  to smaller digits rather than `36…`.
- **No text colour is set on the Lock Screen.** iOS applies its own
  vibrant monochrome treatment to accessory widgets and ignores custom
  colours, so setting them achieves nothing and can hurt legibility on
  some wallpapers. Colour is only used on the Home Screen.
- **The inline widget sets no font at all.** iOS renders inline widgets
  in the system font beside the clock and overrides anything set here.
  Only the text is ours, so keep it short or it will be truncated.

## Retargeting

Edit the two configuration lines near the top of `countdown-widget.js`:

```js
const TARGET = new Date(Date.UTC(2026, 11, 17, 21, 44, 0, 0));
const TITLE = 'Countdown';
```

The target is anchored as a fixed instant in UTC, matching the web app's
default, so both point at the same real moment. Note the month is
zero-based: `11` is December.

## Status

The countdown arithmetic in this script is unit-tested and the file passes
a JavaScript syntax check. The **widget rendering itself has not been run
on an iOS device** — there is no iPhone in the build environment — so treat
the layout, font sizes and Lock Screen behaviour as needing a look on your
own phone.

## No-code alternatives

If you would rather not paste a script, several App Store apps provide
countdown widgets with no coding: **Widgetsmith**, **Countdown**,
**Countie**, **Days Left**. You would re-enter the target date in the app;
they have no connection to this project.
