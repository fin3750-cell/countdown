/* ===================================================================
   Countdown PWA - application logic
   Plain ES2017+ JavaScript. No framework, no build step, no bundler.

   The two design rules that matter:

   1. EVERY update recomputes the remaining time from the real clock
      (Date.now()) against a fixed target instant. Nothing is ever
      decremented. A counter that subtracts 1 each tick drifts whenever
      the browser throttles or suspends timers - which is exactly what
      phones do the moment the screen turns off. Reading the clock means
      the display is correct the instant it becomes visible again, no
      matter how long the device slept.

   2. ALL time handling is local. We never parse or format a UTC string.
      The target is stored as a local wall-clock string and rebuilt into
      a Date with the local-time constructor, so "7:00" means 7:00 where
      the user is, and the device's own tz database handles DST.
   =================================================================== */

'use strict';

(function () {

  // ---------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------

  var MS_PER_SECOND = 1000;
  var SECONDS_PER_MINUTE = 60;
  var SECONDS_PER_HOUR = 60 * 60;
  var SECONDS_PER_DAY = 24 * 60 * 60;

  // Versioned storage keys, so a future format change can't be fed stale data.
  var KEY_TARGET = 'countdown.target.v1';   // value: "YYYY-MM-DDTHH:MM"
  var KEY_TITLE = 'countdown.title.v1';     // value: free text

  // Shown when nothing has been saved on this device yet, and restored by
  // Reset. An empty name is still allowed: clearing the field and saving
  // stores an empty string, which is kept, so "no heading" is a choice the
  // app remembers rather than something this default overrides on reload.
  var DEFAULT_TITLE = 'Elder Wells';

  // Background photo storage.
  //
  // The photo lives in IndexedDB, not localStorage. localStorage only holds
  // strings, so an image would have to be base64-encoded - which inflates it
  // by about a third and then has to fit a quota of roughly 5MB for the
  // whole origin. IndexedDB stores the Blob as binary, with a far larger
  // quota, and hands it straight back on load.
  var DB_NAME = 'countdown';
  var DB_VERSION = 1;
  var STORE_MEDIA = 'media';
  var KEY_BG = 'background';

  var KEY_BG_POS = 'countdown.bgpos.v1';  // value: "0".."100"
  var DEFAULT_BG_POS = 18;

  // Incoming photos are re-encoded down to this before being stored. A
  // modern phone camera produces 3000px+ images of several megabytes; a
  // full-screen background needs nothing like that, and storing the
  // original would waste space and slow every load.
  var MAX_PHOTO_DIM = 1400;
  var PHOTO_QUALITY = 0.82;

  // ---------------------------------------------------------------
  // Element references
  // ---------------------------------------------------------------

  var el = {
    clock:       document.querySelector('.clock'),
    days:        document.getElementById('days'),
    hours:       document.getElementById('hours'),
    minutes:     document.getElementById('minutes'),
    seconds:     document.getElementById('seconds'),
    digits:      document.getElementById('digits'),
    readout:     document.getElementById('a11y-readout'),
    reached:     document.getElementById('reached'),
    title:       document.getElementById('event-title'),
    targetLine:  document.getElementById('target-line'),
    form:        document.getElementById('form'),
    titleInput:  document.getElementById('title-input'),
    targetInput: document.getElementById('target-input'),
    tzHint:      document.getElementById('tz-hint'),
    error:       document.getElementById('error'),
    resetBtn:    document.getElementById('reset'),
    photoInput:  document.getElementById('photo-input'),
    photoHint:   document.getElementById('photo-hint'),
    photoReset:  document.getElementById('photo-reset'),
    posInput:    document.getElementById('pos-input'),
    offline:     document.getElementById('offline-badge'),
    update:      document.getElementById('update-badge'),
    reloadBtn:   document.getElementById('reload-btn'),
    settings:    document.querySelector('.settings')
  };

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------

  var targetDate = null;       // a Date object: the fixed instant we count to
  var timerId = null;          // handle for the pending setTimeout
  var lastAnnouncement = null; // last text written to the live region
  var currentPhotoUrl = null;  // object URL for a custom background, if any

  // ---------------------------------------------------------------
  // localStorage helpers
  //
  // Storage can throw outright in private mode or when the user has
  // blocked site data, so every access is wrapped. A failure degrades to
  // "settings aren't remembered", never to a broken app.
  // ---------------------------------------------------------------

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) { /* ignore */ }
  }

  // ---------------------------------------------------------------
  // Background photo: IndexedDB
  //
  // Every call is wrapped and resolves rather than rejecting on failure.
  // IndexedDB can be entirely unavailable in private browsing or when site
  // data is blocked, and a custom background is a nicety - its absence must
  // never stop the countdown from running.
  // ---------------------------------------------------------------

  function idbOpen() {
    return new Promise(function (resolve) {
      var request;
      try {
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_MEDIA)) {
          db.createObjectStore(STORE_MEDIA);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
      request.onblocked = function () { resolve(null); };
    });
  }

  function idbRun(mode, operation) {
    return idbOpen().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx, store, request;
        try {
          tx = db.transaction(STORE_MEDIA, mode);
          store = tx.objectStore(STORE_MEDIA);
          request = operation(store);
        } catch (err) {
          resolve(null);
          return;
        }
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { resolve(null); };
        tx.oncomplete = function () { db.close(); };
      });
    }).catch(function () { return null; });
  }

  function loadStoredPhoto() {
    return idbRun('readonly', function (store) { return store.get(KEY_BG); });
  }

  function saveStoredPhoto(blob) {
    return idbRun('readwrite', function (store) { return store.put(blob, KEY_BG); });
  }

  function clearStoredPhoto() {
    return idbRun('readwrite', function (store) { return store.delete(KEY_BG); });
  }

  // ---------------------------------------------------------------
  // Background photo: decoding, resizing and applying
  // ---------------------------------------------------------------

  /**
   * Re-encode a chosen file down to a sane size as a JPEG Blob.
   *
   * Going through a canvas does two useful things beyond shrinking it.
   * It normalises the format: an iPhone may hand over a HEIC file, which
   * Safari can decode but which other browsers cannot, and the canvas
   * re-encode turns it into a JPEG everything understands. It also strips
   * EXIF metadata, including any GPS coordinates the photo was carrying.
   */
  function preparePhoto(file) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        URL.revokeObjectURL(objectUrl);

        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (!w || !h) {
          reject(new Error('That image could not be read.'));
          return;
        }

        var scale = Math.min(1, MAX_PHOTO_DIM / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));

        try {
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        } catch (err) {
          reject(new Error('That image could not be processed.'));
          return;
        }

        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('That image could not be converted.'));
        }, 'image/jpeg', PHOTO_QUALITY);
      };

      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('That file is not an image this browser can open.'));
      };

      img.src = objectUrl;
    });
  }

  /**
   * Point the background layer at a Blob, or back at the shipped photo.
   *
   * The object URL is revoked before a new one replaces it; without that,
   * each photo change would leak its predecessor for the life of the page.
   */
  function applyPhoto(blob) {
    if (currentPhotoUrl) {
      URL.revokeObjectURL(currentPhotoUrl);
      currentPhotoUrl = null;
    }
    if (blob) {
      currentPhotoUrl = URL.createObjectURL(blob);
      document.documentElement.style.setProperty(
        '--bg-image', 'url("' + currentPhotoUrl + '")');
    } else {
      // Removing the property lets the CSS fallback - the shipped photo -
      // take over again.
      document.documentElement.style.removeProperty('--bg-image');
    }
  }

  function applyPhotoPosition(percent) {
    var n = Number(percent);
    if (!isFinite(n)) n = DEFAULT_BG_POS;
    n = Math.min(100, Math.max(0, Math.round(n)));
    document.documentElement.style.setProperty('--bg-pos-y', n + '%');
    if (el.posInput) el.posInput.value = String(n);
    return n;
  }

  function setPhotoHint(text, isError) {
    if (!el.photoHint) return;
    el.photoHint.textContent = text;
    el.photoHint.classList.toggle('is-error', !!isError);
  }

  // ---------------------------------------------------------------
  // Local-time parsing and formatting
  // ---------------------------------------------------------------

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * Parse a datetime-local value ("YYYY-MM-DDTHH:MM", optionally with
   * seconds) into a Date in LOCAL time.
   *
   * Why not `new Date(string)`? For date-time strings the ECMAScript spec
   * says a value with no time-zone offset is local, but that rule arrived
   * late and older engines disagreed - some read it as UTC. Feeding the
   * components to `new Date(y, m, d, h, min)` is unambiguous local time in
   * every engine, so we do that instead.
   *
   * Returns a Date, or null if the string is malformed or not a real date.
   */
  function parseLocalDateTime(value) {
    if (typeof value !== 'string') return null;

    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!match) return null;

    var year   = Number(match[1]);
    var month  = Number(match[2]);   // 1-12 as written
    var day    = Number(match[3]);
    var hour   = Number(match[4]);
    var minute = Number(match[5]);
    var second = match[6] ? Number(match[6]) : 0;

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;

    var date = new Date(year, month - 1, day, hour, minute, second, 0);

    // The Date constructor silently rolls overflow forward: 2025-02-30
    // becomes 2025-03-02. Reading the fields back catches that, so an
    // impossible date is rejected rather than quietly shifted.
    if (date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute) {
      // Note: the hour check can also legitimately fail for a time that does
      // not exist because DST skipped it (e.g. 02:30 on a spring-forward
      // night). Rejecting it is the right call - we cannot count down to an
      // instant that never occurs.
      return null;
    }

    return date;
  }

  /** Format a Date back into a datetime-local input value, in local time. */
  function toInputValue(date) {
    return date.getFullYear() + '-' +
           pad2(date.getMonth() + 1) + '-' +
           pad2(date.getDate()) + 'T' +
           pad2(date.getHours()) + ':' +
           pad2(date.getMinutes());
  }

  /** A human-readable target, rendered with the device's own locale and zone. */
  function formatTargetForDisplay(date) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      }).format(date);
    } catch (err) {
      // Intl is present everywhere that supports service workers, but the
      // fallback costs one line and removes a crash path.
      return date.toString();
    }
  }

  /** The IANA zone name the device is actually using, e.g. "America/New_York". */
  function localZoneName() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return tz || '';
    } catch (err) {
      return '';
    }
  }

  // ---------------------------------------------------------------
  // Default target
  // ---------------------------------------------------------------

  /**
   * The target used on a first visit, and restored by the Reset button:
   *
   *     17 December 2026, 2:44 PM MST
   *
   * This is anchored as a fixed INSTANT, not as a local wall-clock time.
   * Mountain Standard Time is UTC-7, and December is outside daylight
   * saving everywhere in the Mountain zone (Denver is on MST in winter;
   * Arizona is on MST all year), so 2:44 PM MST is unambiguously 21:44 UTC.
   *
   * Anchoring the instant rather than the wall-clock reading means the
   * countdown ends at the same real moment wherever it is opened. The
   * display still renders in the viewer's own zone, so on a Mountain-time
   * device this reads back as 2:44 PM MST, while a viewer in New York sees
   * the same instant written as 4:44 PM EST.
   *
   * Note that this is a fixed date rather than a rolling one: once it
   * passes, the app shows the "arrived" state until a new target is set.
   */
  function defaultTarget() {
    return new Date(Date.UTC(2026, 11, 17, 21, 44, 0, 0));
  }

  // ---------------------------------------------------------------
  // The countdown maths
  // ---------------------------------------------------------------

  /**
   * Split the gap between now and the target into whole days, hours and
   * minutes.
   *
   * This is deliberately pure millisecond arithmetic on a difference of two
   * instants, so there is no calendar ambiguity: `days` counts elapsed
   * 24-hour periods. Across a DST change a calendar day is 23 or 25 hours
   * long, so on those weeks the day/hour split can read an hour away from a
   * calendar-based count. The total remaining time is exact either way.
   */
  function breakdown(targetMs, nowMs) {
    var remainingMs = targetMs - nowMs;

    if (remainingMs <= 0) {
      return {
        done: true, days: 0, hours: 0, minutes: 0, seconds: 0,
        remainingMs: remainingMs
      };
    }

    // floor() gives "whole seconds still to run", the usual countdown
    // convention: it reads 0 seconds during the final fraction of a second.
    var totalSeconds = Math.floor(remainingMs / MS_PER_SECOND);

    return {
      done: false,
      days: Math.floor(totalSeconds / SECONDS_PER_DAY),
      hours: Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR),
      minutes: Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
      seconds: totalSeconds % SECONDS_PER_MINUTE,
      remainingMs: remainingMs
    };
  }

  /** "2 days, 3 hours and 4 minutes" - for the screen-reader live region. */
  function describe(parts) {
    function unit(n, word) {
      return n + ' ' + word + (n === 1 ? '' : 's');
    }
    return unit(parts.days, 'day') + ', ' +
           unit(parts.hours, 'hour') + ' and ' +
           unit(parts.minutes, 'minute') + ' remaining';
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  function render() {
    if (!targetDate) return;

    // Read the clock fresh on every single render. This is the whole point.
    var parts = breakdown(targetDate.getTime(), Date.now());

    el.days.textContent = String(parts.days);
    el.hours.textContent = pad2(parts.hours);
    el.minutes.textContent = pad2(parts.minutes);
    el.seconds.textContent = pad2(parts.seconds);

    if (parts.done) {
      el.clock.classList.add('is-done');
      el.reached.hidden = false;
      announce('The target date and time has arrived.');
    } else {
      el.clock.classList.remove('is-done');
      el.reached.hidden = true;
      // Deliberately announced to minute precision, not second precision -
      // see announce().
      announce(describe(parts));
    }
  }

  /**
   * Update the screen-reader live region only when the text actually
   * changes.
   *
   * This matters now that the display ticks every second. A polite live
   * region that changes every second would make a screen reader talk
   * continuously and bury everything else on the page. describe() reports
   * only days, hours and minutes, so this writes at most once a minute
   * even though the visible seconds keep moving.
   */
  function announce(text) {
    if (text !== lastAnnouncement) {
      lastAnnouncement = text;
      el.readout.textContent = text;
    }
  }

  // ---------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------

  /**
   * Schedule the next render for the exact moment the seconds digit changes.
   *
   * The displayed second count is floor(remaining / 1000), so it changes
   * when `remaining` crosses a multiple of 1000, and `remaining % 1000` is
   * precisely how long that is away. Scheduling to the boundary rather than
   * calling setInterval(1000) keeps the digit flipping in step with the
   * real clock: the delay is recomputed after every render, so the schedule
   * re-centres itself instead of accumulating drift.
   *
   * Nothing is scheduled while the page is hidden. A backgrounded tab is
   * throttled by the browser anyway, and the value would be stale the
   * moment it came back - so instead the work stops entirely and
   * visibilitychange re-renders from the clock on return. That is both
   * cheaper on battery and more correct.
   */
  function scheduleNext() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (!targetDate) return;
    if (document.hidden) return;

    var remainingMs = targetDate.getTime() - Date.now();

    // Target reached: nothing left to animate, so stop scheduling entirely.
    if (remainingMs <= 0) return;

    var untilNextChange = remainingMs % MS_PER_SECOND;
    if (untilNextChange === 0) untilNextChange = MS_PER_SECOND;

    // +25ms so we land just after the boundary rather than a hair before it
    // and render the same value twice.
    timerId = setTimeout(tick, untilNextChange + 25);
  }

  /** Render, then arm the next render. The only scheduling entry point. */
  function tick() {
    render();
    scheduleNext();
  }

  // ---------------------------------------------------------------
  // Applying a target
  // ---------------------------------------------------------------

  function applyTarget(date, titleText) {
    targetDate = date;

    // The heading is optional. With no name set, it is removed from view
    // but kept in the accessibility tree: the <section> is labelled by it
    // via aria-labelledby, and hiding it outright would leave that panel
    // unnamed for screen readers. `visually-hidden` keeps the label while
    // giving the photo back the space.
    var name = (titleText || '').trim();
    el.title.textContent = name || 'Countdown';
    el.title.classList.toggle('visually-hidden', name === '');
    document.title = name ? name + ' - Countdown' : 'Countdown';

    // Just the formatted date here. The abbreviation it already carries
    // ("MST", "EST") names the zone, so appending the full IANA name made
    // the line wrap onto two rows for no new information - and the full
    // name is still shown in the Set target panel's hint.
    el.targetLine.textContent = formatTargetForDisplay(date);

    el.targetInput.value = toInputValue(date);
    el.titleInput.value = name;

    tick();
  }

  // ---------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------

  el.form.addEventListener('submit', function (event) {
    event.preventDefault();
    el.error.hidden = true;

    var raw = el.targetInput.value;
    var parsed = parseLocalDateTime(raw);

    if (!parsed) {
      el.error.textContent = raw
        ? 'That is not a valid date and time. Check the day of the month, and note that a time skipped by a daylight-saving change cannot be used.'
        : 'Pick a target date and time first.';
      el.error.hidden = false;
      return;
    }

    var titleText = el.titleInput.value;

    storageSet(KEY_TARGET, toInputValue(parsed));
    // Stored even when empty. Removing the key instead would mean a
    // deliberately blank heading came back as DEFAULT_TITLE on the next
    // load, which would read as the app ignoring the user.
    storageSet(KEY_TITLE, titleText.trim());

    applyTarget(parsed, titleText);

    // Collapse the panel so the digits are the thing on screen again.
    if (el.settings) el.settings.open = false;
  });

  // Choosing a photo applies it immediately - waiting for Save would mean
  // picking a background without being able to see it first.
  el.photoInput.addEventListener('change', function () {
    var file = el.photoInput.files && el.photoInput.files[0];
    if (!file) return;

    setPhotoHint('Processing photo…', false);

    preparePhoto(file).then(function (blob) {
      applyPhoto(blob);
      return saveStoredPhoto(blob).then(function (ok) {
        var size = Math.round(blob.size / 1024);
        setPhotoHint(ok === null
          ? 'Photo applied, but it could not be saved on this device, so it will not survive a reload.'
          : 'Photo saved on this device (' + size + ' KB). Use the position slider if the subject sits behind the panels.',
          ok === null);
      });
    }).catch(function (err) {
      setPhotoHint(err && err.message ? err.message : 'That photo could not be used.', true);
    }).then(function () {
      // Clear the input so re-picking the same file fires `change` again.
      el.photoInput.value = '';
    });
  });

  el.posInput.addEventListener('input', function () {
    var n = applyPhotoPosition(el.posInput.value);
    storageSet(KEY_BG_POS, String(n));
  });

  el.photoReset.addEventListener('click', function () {
    applyPhoto(null);
    el.photoInput.value = '';
    clearStoredPhoto().then(function () {
      setPhotoHint('Using the photo the app ships with.', false);
    });
  });

  el.resetBtn.addEventListener('click', function () {
    storageRemove(KEY_TARGET);
    storageRemove(KEY_TITLE);
    storageRemove(KEY_BG_POS);
    el.error.hidden = true;

    // "Reset all" means the photo and its framing too.
    applyPhoto(null);
    el.photoInput.value = '';
    applyPhotoPosition(DEFAULT_BG_POS);
    clearStoredPhoto();
    setPhotoHint('Stored on this device only. Applied straight away.', false);

    applyTarget(defaultTarget(), DEFAULT_TITLE);
  });

  // Recompute the moment the app becomes visible again. This is the handler
  // that makes a sleeping phone a non-issue: whatever the OS did to our
  // timers while the screen was off, the first thing we do on return is read
  // the clock and re-arm.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      // Stop the per-second timer while the app is out of sight.
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    } else {
      tick();
    }
  });

  // Belt and braces: different platforms fire different events on resume.
  // `tick()` is idempotent - it renders from the clock and replaces the
  // pending timer - so extra calls are harmless.
  window.addEventListener('focus', tick);
  window.addEventListener('pageshow', tick);

  // The OS clock itself can jump (travel, manual change, NTP correction).
  // Chrome and Safari do not expose a reliable event for that, but a resume
  // or a minute boundary will pick it up on the next tick.

  // ---------------------------------------------------------------
  // Online / offline badge
  // ---------------------------------------------------------------

  function updateOnlineBadge() {
    el.offline.hidden = navigator.onLine !== false;
  }

  window.addEventListener('online', updateOnlineBadge);
  window.addEventListener('offline', updateOnlineBadge);

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------

  function init() {
    var zone = localZoneName();
    el.tzHint.textContent = zone
      ? 'Interpreted in your device’s time zone (' + zone + ').'
      : 'Interpreted in your device’s local time zone.';

    var storedTarget = parseLocalDateTime(storageGet(KEY_TARGET));

    // null means "never saved on this device" -> use the default.
    // "" means "saved deliberately blank" -> respect it.
    var storedTitle = storageGet(KEY_TITLE);
    if (storedTitle === null) storedTitle = DEFAULT_TITLE;

    applyTarget(storedTarget || defaultTarget(), storedTitle);
    updateOnlineBadge();

    // Framing is applied synchronously so the layout does not shift once
    // the photo arrives.
    var storedPos = storageGet(KEY_BG_POS);
    applyPhotoPosition(storedPos === null ? DEFAULT_BG_POS : storedPos);

    // The photo itself loads asynchronously. Until it resolves, the CSS
    // fallback (the shipped photo) is already on screen, so there is no
    // blank frame while IndexedDB is read.
    loadStoredPhoto().then(function (blob) {
      if (blob) {
        applyPhoto(blob);
        setPhotoHint('Using your photo. Choose another to replace it.', false);
      }
    });
  }

  init();

  // ---------------------------------------------------------------
  // Service worker registration
  //
  // Registered with a relative URL so the scope is the directory the app is
  // served from. That is what lets the same files work at
  // https://user.github.io/countdown/ and at a domain root unchanged.
  // ---------------------------------------------------------------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (registration) {

        // A new worker is waiting: tell the user rather than swapping the
        // page out from under them.
        function watch(worker) {
          if (!worker) return;
          worker.addEventListener('statechange', function () {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              el.update.hidden = false;
            }
          });
        }

        if (registration.waiting && navigator.serviceWorker.controller) {
          el.update.hidden = false;
        }
        watch(registration.installing);
        registration.addEventListener('updatefound', function () {
          watch(registration.installing);
        });

        el.reloadBtn.addEventListener('click', function () {
          var waiting = registration.waiting;
          if (waiting) {
            // Ask the waiting worker to take over, then reload when it does.
            waiting.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', function () {
              window.location.reload();
            }, { once: true });
          } else {
            window.location.reload();
          }
        });

      }).catch(function (err) {
        // Registration fails on http:// origins other than localhost, and in
        // some private-browsing modes. The countdown itself still works.
        console.warn('Service worker registration failed:', err);
      });
    });
  }

})();
