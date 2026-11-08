// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: hourglass-half;

/* ===================================================================
   Countdown - Scriptable widget
   ===================================================================

   A Home Screen and Lock Screen widget that counts down to the same
   instant as the web app at https://fin3750-cell.github.io/countdown/

   iOS widgets cannot be produced by a website. They require a WidgetKit
   extension, which is native Swift. Scriptable is a free app that embeds
   a JavaScript runtime inside its own WidgetKit extension, which is what
   makes this possible without Xcode.

   SETUP
   -----
   1. Install Scriptable from the App Store (free).
   2. Open Scriptable, tap + , paste this whole file, and name it
      "Countdown".
   3. Home Screen: long-press the wallpaper -> + -> Scriptable -> pick a
      size -> add it. Then long-press the new widget -> Edit Widget ->
      Script: Countdown.
   4. Lock Screen: long-press the Lock Screen -> Customise -> tap the
      widget area -> add Scriptable -> tap it -> Script: Countdown.

   A REAL LIMITATION, STATED UP FRONT
   ----------------------------------
   iOS decides when widgets refresh. It budgets refreshes across the day
   and commonly lands around every 15-30 minutes; it is not a live clock
   and it cannot be forced. `refreshAfterDate` below is a hint, not a
   guarantee.

   That is why this widget leads with DAYS and shows hours as a secondary
   figure, and why the minute figure only appears on the final day. A
   minute-precision widget would frequently display a stale minute and
   look broken. Open the web app when you want the exact minute - that
   one is accurate to the second it is opened.

   The countdown itself is still computed from the clock on every render,
   exactly like the web app, so whenever iOS does refresh, the value it
   draws is correct for that moment.
   =================================================================== */

// ------------------------------------------------------------------
// Configuration - edit these two lines to retarget the widget.
// ------------------------------------------------------------------

// 17 December 2026, 2:44 PM MST.
// MST is UTC-7 and December is outside daylight saving across the
// Mountain zone, so this is unambiguously 21:44 UTC. Anchoring the
// instant (rather than a local wall-clock reading) keeps this widget and
// the web app pointed at the same real moment.
const TARGET = new Date(Date.UTC(2026, 11, 17, 21, 44, 0, 0));

const TITLE = 'Countdown';
const APP_URL = 'https://fin3750-cell.github.io/countdown/';

// ------------------------------------------------------------------
// Lock Screen font sizes, in points. Tune these if the text looks wrong
// on your device - they are the only numbers you should need to touch.
//
// The Lock Screen gives a widget very little room:
//   circular     roughly 72pt across, but only the inscribed square is
//                usable, so plan for about 50pt of width and height
//   rectangular  roughly 160 x 72pt, about 152 x 64pt after padding
//
// Every accessory text below also sets minimumScaleFactor, so if a value
// is wider than its box the system shrinks it instead of truncating it.
// A three-digit day count will shrink rather than turn into "36...".
// ------------------------------------------------------------------
const LOCK = {
  circularNumber: 24,   // the big day count in the circular widget
  circularLabel: 9,     // the word "days" beneath it
  rectTitle: 11,        // the widget name, top line
  rectValue: 20,        // the hero line, e.g. "39d 2h"
  rectDate: 10          // the target date, bottom line
};

// Palette, matched to the web app.
const BG_TOP = new Color('#18234c');
const BG_BOTTOM = new Color('#0b1020');
const FG = new Color('#f1f5ff');
const FG_DIM = new Color('#93a0c4');
const ACCENT = new Color('#38bdf8');

// ------------------------------------------------------------------
// Countdown maths - identical approach to the web app: always derived
// from the current clock, never decremented.
// ------------------------------------------------------------------

function breakdown(targetMs, nowMs) {
  const remaining = targetMs - nowMs;
  if (remaining <= 0) {
    return { done: true, days: 0, hours: 0, minutes: 0 };
  }
  const totalMinutes = Math.floor(remaining / 60000);
  return {
    done: false,
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
    remaining: remaining
  };
}

const parts = breakdown(TARGET.getTime(), Date.now());

/** "39d 2h", or "2h 44m" on the final day. */
function shortText(p) {
  if (p.done) return 'Now';
  if (p.days > 0) return p.days + 'd ' + p.hours + 'h';
  return p.hours + 'h ' + p.minutes + 'm';
}

/** The target rendered in the device's own time zone. */
function targetText() {
  const df = new DateFormatter();
  df.dateFormat = 'EEE d MMM, h:mm a';
  return df.string(TARGET);
}

/**
 * A shorter form for the Lock Screen, which has far less width than a
 * Home Screen widget. Drops the weekday: "17 Dec, 2:44 PM".
 */
function targetTextShort() {
  const df = new DateFormatter();
  df.dateFormat = 'd MMM, h:mm a';
  return df.string(TARGET);
}

/**
 * Lock Screen text helper.
 *
 * Two things matter here and are easy to get wrong:
 *
 *  - minimumScaleFactor lets the system shrink text that does not fit
 *    rather than clipping it, which is what stops a long value turning
 *    into an ellipsis in a 50pt-wide circle.
 *  - No text colour is set anywhere in the accessory widgets. iOS renders
 *    Lock Screen widgets with its own vibrant monochrome treatment and
 *    ignores custom colours, so setting them achieves nothing and can
 *    make the result less legible on some wallpapers.
 */
function lockText(container, string, size, opts) {
  const o = opts || {};
  const t = container.addText(string);
  t.font = o.bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.lineLimit = 1;
  t.minimumScaleFactor = o.scale || 0.5;
  if (o.center) t.centerAlignText();
  return t;
}

// ------------------------------------------------------------------
// Widget builders
// ------------------------------------------------------------------

function applyBackground(w) {
  const g = new LinearGradient();
  g.colors = [BG_TOP, BG_BOTTOM];
  g.locations = [0, 1];
  w.backgroundGradient = g;
}

function buildHomeScreen(family) {
  const w = new ListWidget();
  applyBackground(w);
  w.url = APP_URL; // tapping the widget opens the web app
  w.setPadding(14, 14, 14, 14);

  const title = w.addText(TITLE);
  title.font = Font.mediumSystemFont(12);
  title.textColor = FG_DIM;
  title.lineLimit = 1;

  w.addSpacer(6);

  if (parts.done) {
    const t = w.addText('Arrived');
    t.font = Font.boldSystemFont(family === 'small' ? 30 : 36);
    t.textColor = ACCENT;
  } else {
    const big = w.addText(String(parts.days));
    big.font = Font.boldSystemFont(family === 'small' ? 46 : 54);
    big.textColor = FG;

    const unit = w.addText(parts.days === 1 ? 'day' : 'days');
    unit.font = Font.mediumSystemFont(13);
    unit.textColor = ACCENT;

    w.addSpacer(4);

    const sub = w.addText(parts.hours + 'h ' + parts.minutes + 'm');
    sub.font = Font.systemFont(12);
    sub.textColor = FG_DIM;
  }

  w.addSpacer();

  const when = w.addText(targetText());
  when.font = Font.systemFont(10);
  when.textColor = FG_DIM;
  when.lineLimit = 2;

  return w;
}

function buildAccessory(family) {
  const w = new ListWidget();
  w.url = APP_URL;

  // Gives the standard translucent Lock Screen pill behind the content.
  w.addAccessoryWidgetBackground = true;

  if (family === 'accessoryInline') {
    // Inline widgets are one line rendered in the system's own font next
    // to the clock. iOS overrides any font set here, so none is set -
    // only the text is ours. Keep it short or iOS will truncate it.
    w.addText(TITLE + ' ' + shortText(parts));
    return w;
  }

  if (family === 'accessoryCircular') {
    // No padding: the circle's usable area is already only the inscribed
    // square, so every point of inset is one we cannot spare.
    w.setPadding(0, 0, 0, 0);

    const stack = w.addStack();
    stack.layoutVertically();
    stack.centerAlignContent();
    stack.addSpacer();

    // Scales hard (0.3) because a three-digit day count has to fit the
    // same box as a one-digit one.
    lockText(stack, parts.done ? '0' : String(parts.days),
      LOCK.circularNumber, { bold: true, center: true, scale: 0.3 });

    lockText(stack, parts.done ? 'now' : (parts.days === 1 ? 'day' : 'days'),
      LOCK.circularLabel, { center: true, scale: 0.6 });

    stack.addSpacer();
    return w;
  }

  // accessoryRectangular: three lines in about 64pt of height, so the
  // sizes have to add up to less than that with spacing included.
  w.setPadding(0, 2, 0, 2);
  w.addSpacer(1);

  lockText(w, TITLE, LOCK.rectTitle, { scale: 0.7 });

  lockText(w, parts.done ? 'Arrived' : shortText(parts),
    LOCK.rectValue, { bold: true, scale: 0.4 });

  // The short date form - the full one with the weekday does not fit the
  // Lock Screen's width at a readable size.
  lockText(w, targetTextShort(), LOCK.rectDate, { scale: 0.7 });

  w.addSpacer(1);
  return w;
}

// ------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------

// `config.widgetFamily` is undefined when the script is run manually
// inside the Scriptable app, so default to a medium preview.
const family = config.widgetFamily || 'medium';
const isAccessory =
  typeof family === 'string' && family.indexOf('accessory') === 0;

const widget = isAccessory ? buildAccessory(family) : buildHomeScreen(family);

// Ask iOS to come back sooner when the target is close. This is only a
// hint - the system refreshes on its own budget and may ignore it.
if (!parts.done) {
  const minutesOut = parts.remaining / 60000;
  const refreshMins = minutesOut < 60 ? 5 : (minutesOut < 1440 ? 15 : 60);
  widget.refreshAfterDate = new Date(Date.now() + refreshMins * 60000);
}

if (config.runsInWidget || config.runsInAccessoryWidget) {
  // Required on the Lock Screen: without setWidget() Scriptable renders
  // an error message in the widget instead of the content.
  Script.setWidget(widget);
} else {
  // Manual run inside the app - show a preview so the script can be
  // checked before it is attached to a widget.
  if (isAccessory) {
    await widget.presentAccessoryRectangular();
  } else if (family === 'small') {
    await widget.presentSmall();
  } else if (family === 'large') {
    await widget.presentLarge();
  } else {
    await widget.presentMedium();
  }
}

Script.complete();
