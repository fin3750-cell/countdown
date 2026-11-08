// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: image;

/* ===================================================================
   Countdown - Lock Screen wallpaper generator
   ===================================================================

   Renders a full-screen countdown image and hands it to Shortcuts, so a
   daily automation can set it as your Lock Screen wallpaper.

   WHY THIS EXISTS
   ---------------
   iOS wallpaper is a static image. There is no way to point it at a URL
   and have it refresh itself. What you CAN do is regenerate the image on
   a schedule and set it again, which is what the Shortcuts automation
   below does.

   Because that runs on a schedule rather than continuously, this image
   shows DAYS only. A wallpaper claiming "2h 44m" would be wrong within
   the hour. Days is the honest unit for something redrawn once a day.
   Open the web app when you want the exact figure.

   SETUP
   -----
   1. Scriptable: tap +, paste this file, name it "Countdown Wallpaper".
      Run it once inside the app to preview the image.

   2. Shortcuts app -> + (new shortcut):
        a. Add action "Run Script" (from Scriptable).
             Script: Countdown Wallpaper
        b. Add action "Set Wallpaper".
             Image:  Output from the previous step (tap the variable)
             Screen: Lock Screen
             Turn OFF "Show Preview"
             Turn OFF "Crop to Subject"
      Name it "Update Countdown Wallpaper" and run it once to test.

   3. Shortcuts -> Automation tab -> + -> Time of Day
        Pick a time (early morning works well), Repeat: Daily
        Action: Run Shortcut -> "Update Countdown Wallpaper"
        Choose "Run Immediately" and turn off "Notify When Run"

   One automation holds one time of day. If you want more than one update
   per day, create a second automation pointing at the same shortcut.

   TROUBLESHOOTING
   ---------------
   The handoff in step 2a is the part that most often goes wrong: the
   "Set Wallpaper" action must take the Run Script OUTPUT as its image,
   not a photo you picked. If the wallpaper does not change, open the
   shortcut and confirm the Image field shows a variable chip and not a
   thumbnail.

   STATUS
   ------
   The countdown arithmetic here is unit-tested and the file passes a
   syntax check, but the rendering has NOT been run on an iOS device -
   there is no iPhone in the environment it was written in. Expect to
   adjust LAYOUT below once you see it on your own screen.
   =================================================================== */

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------

// 17 December 2026, 2:44 PM MST = 21:44 UTC. Same instant as the web app.
const TARGET = new Date(Date.UTC(2026, 11, 17, 21, 44, 0, 0));
const TITLE = 'ELDER WELLS';

// Vertical placement, as a fraction of screen height.
//
// The iPhone Lock Screen is crowded: the date and clock occupy roughly
// the top quarter, widgets sit just below them, and the bottom holds the
// flashlight and camera buttons plus the home indicator. That leaves the
// middle band free, which is where this puts everything.
//
// Nudge these if your clock style or widgets overlap the number.
const LAYOUT = {
  title: 0.44,      // small label above the number
  number: 0.49,     // the big day count
  unit: 0.70,       // the word "days" (must clear number + numberSize)
  date: 0.77,       // the target date
  numberSize: 0.19, // big number height, as a fraction of screen height
  titleSize: 0.019,
  unitSize: 0.028,
  dateSize: 0.021
};

const BG_TOP = { r: 0x18, g: 0x23, b: 0x4c };
const BG_BOTTOM = { r: 0x0b, g: 0x10, b: 0x20 };
const FG = new Color('#f1f5ff');
const FG_DIM = new Color('#93a0c4');
const ACCENT = new Color('#38bdf8');

// ------------------------------------------------------------------
// Countdown maths - derived from the clock, never decremented.
// ------------------------------------------------------------------

function daysRemaining(targetMs, nowMs) {
  const remaining = targetMs - nowMs;
  if (remaining <= 0) return { done: true, days: 0 };
  // Whole 24-hour periods, matching the web app and the widget so the
  // three never disagree with each other.
  return { done: false, days: Math.floor(remaining / 86400000) };
}

const state = daysRemaining(TARGET.getTime(), Date.now());

function targetText() {
  const df = new DateFormatter();
  df.dateFormat = 'EEEE d MMMM, h:mm a';
  return df.string(TARGET);
}

// ------------------------------------------------------------------
// Drawing
// ------------------------------------------------------------------

/**
 * DrawContext has no gradient fill, so the background is painted as a
 * stack of thin horizontal bands with interpolated colours. 160 bands is
 * far more than the eye can separate at this size.
 */
function paintBackground(dc, w, h) {
  const bands = 160;
  const bandH = Math.ceil(h / bands);
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const c = new Color(
      '#' +
      [
        Math.round(BG_TOP.r + (BG_BOTTOM.r - BG_TOP.r) * t),
        Math.round(BG_TOP.g + (BG_BOTTOM.g - BG_TOP.g) * t),
        Math.round(BG_TOP.b + (BG_BOTTOM.b - BG_TOP.b) * t)
      ].map(v => v.toString(16).padStart(2, '0')).join('')
    );
    dc.setFillColor(c);
    dc.fillRect(new Rect(0, i * (h / bands), w, bandH + 1));
  }
}

function drawCentered(dc, text, yFraction, fontSize, color, bold) {
  const w = dc.size.width;
  const h = dc.size.height;
  dc.setFont(bold ? Font.boldSystemFont(fontSize) : Font.systemFont(fontSize));
  dc.setTextColor(color);
  dc.setTextAlignedCenter();
  // A generous rect height: drawTextInRect draws from the top of the
  // rect, so the box only needs to be tall enough not to clip descenders.
  dc.drawTextInRect(text, new Rect(0, yFraction * h, w, fontSize * 1.5));
}

function buildImage() {
  const screen = Device.screenSize();
  const w = screen.width;
  const h = screen.height;

  const dc = new DrawContext();
  dc.size = new Size(w, h);
  dc.opaque = true;
  // Renders at the device's native pixel density rather than at point
  // size, so the wallpaper is not soft on a Retina display.
  dc.respectScreenScale = true;

  paintBackground(dc, w, h);

  drawCentered(dc, TITLE, LAYOUT.title, h * LAYOUT.titleSize, FG_DIM, false);

  if (state.done) {
    drawCentered(dc, 'TODAY', LAYOUT.number, h * LAYOUT.numberSize * 0.5, ACCENT, true);
  } else {
    drawCentered(dc, String(state.days), LAYOUT.number, h * LAYOUT.numberSize, FG, true);
    drawCentered(dc, state.days === 1 ? 'day to go' : 'days to go',
      LAYOUT.unit, h * LAYOUT.unitSize, ACCENT, false);
  }

  drawCentered(dc, targetText(), LAYOUT.date, h * LAYOUT.dateSize, FG_DIM, false);

  return dc.getImage();
}

// ------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------

const image = buildImage();

if (config.runsInApp) {
  // Run manually inside Scriptable: show a preview so the layout can be
  // checked before it is wired into a Shortcut.
  await QuickLook.present(image);
} else {
  // Run from Shortcuts: hand the image to the next action, which should
  // be "Set Wallpaper".
  Script.setShortcutOutput(image);
}

Script.complete();
