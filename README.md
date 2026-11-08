# Countdown

A small progressive web app that counts down to a target date and time,
shown in **days, hours and minutes**. Plain HTML, CSS and JavaScript — no
frameworks, no build step, no dependencies. Open `index.html` and it runs.

Install it to a phone home screen and it works with no network connection.

## Design notes

**The remaining time is recomputed from the clock on every update.** The app
never decrements a stored counter. Each render does
`target.getTime() - Date.now()` and splits that difference into days, hours
and minutes. This matters on a phone: when the screen turns off the OS
throttles or suspends JavaScript timers, so a counter that subtracts one
minute per tick silently falls behind by however long the device slept.
Reading the clock means the display is correct the instant it becomes
visible again. The app additionally re-renders on `visibilitychange`,
`focus` and `pageshow`, so the correction is immediate on resume rather than
waiting for the next scheduled tick.

**Everything is in your local time zone.** The target is entered in a
`datetime-local` input, whose value carries no time-zone offset, and is
rebuilt into a `Date` with the local-time constructor
(`new Date(y, m, d, h, min)`). So `18:00` means 18:00 where you are, and the
device's own time-zone database handles daylight saving. No UTC string is
ever parsed or formatted.

**Timers wake once a minute, not once a second.** Since the smallest unit
displayed is a minute, the next render is scheduled for the exact moment the
minute digit changes — `remaining % 60000` milliseconds away. The delay is
recomputed from the clock after every render, so the schedule re-centres
itself instead of accumulating drift.

### One honest caveat about DST

The day/hour/minute split is pure millisecond arithmetic on the gap between
two instants, so `days` counts elapsed **24-hour periods**. During a week
containing a daylight-saving change a calendar day is 23 or 25 hours long,
so on those weeks the split can read an hour away from a calendar-based
count. The total remaining time is exact either way; only the way it is
divided into buckets differs. For a countdown this is the normal and
expected behaviour.

A time that does not exist because DST skipped it (for example 02:30 on a
spring-forward morning) is rejected with an error rather than silently
shifted, since there is no such instant to count down to.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Markup and PWA wiring. Links the manifest, icons and iOS meta tags. All paths are relative (`./`) so the app works from a GitHub Pages subdirectory as well as a domain root. |
| `styles.css` | All styling. Fluid type so the digits scale on a phone, `tabular-nums` so they don't jitter, and `env(safe-area-inset-*)` padding so it clears the notch when installed. Dark-only by design. |
| `app.js` | The countdown itself: local-time parsing and validation, the days/hours/minutes maths, the self-correcting scheduler, settings persistence, and service worker registration. |
| `manifest.json` | Web app manifest — name, colours, display mode and icons. Makes the app installable. |
| `sw.js` | Service worker. Precaches the app shell; network-first for navigations, cache-first for static files. This is what makes it work offline. |
| `icons/` | App icons: 192 and 512 `any`, a 512 `maskable`, and a 180 `apple-touch-icon` for iOS. |
| `tools/make-icons.py` | Regenerates the icons with Pillow, so they can be restyled rather than being opaque binaries. |
| `.nojekyll` | Tells GitHub Pages to serve the files as-is instead of running them through Jekyll. |

## Running locally

A service worker needs `https://` or `localhost` — opening the file with a
`file://` URL will load the page but refuse to register the worker. Serve
the directory instead:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Updating a deployed copy

The service worker precaches the app shell, so after editing any file you
must bump `CACHE_VERSION` in `sw.js`:

```js
var CACHE_VERSION = 'v2';
```

That changes the cache name, which makes the new worker build a fresh cache
on install and delete the old one on activate. Leave it alone and returning
visitors keep getting the cached copy. When a new version is waiting, the
app shows an "Update ready" badge rather than swapping the page out
mid-session.

## Usage

Open **Set target**, give the countdown a name and pick a date and time, and
press Save. Both are stored in `localStorage` on the device. **Reset**
restores the placeholder target, which is the next 1 January at midnight
local time.
