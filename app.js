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

  var MS_PER_MINUTE = 60 * 1000;
  var MINUTES_PER_HOUR = 60;
  var MINUTES_PER_DAY = 24 * 60;

  // Versioned storage keys, so a future format change can't be fed stale data.
  var KEY_TARGET = 'countdown.target.v1';   // value: "YYYY-MM-DDTHH:MM"
  var KEY_TITLE = 'countdown.title.v1';     // value: free text

  // ---------------------------------------------------------------
  // Element references
  // ---------------------------------------------------------------

  var el = {
    clock:       document.querySelector('.clock'),
    days:        document.getElementById('days'),
    hours:       document.getElementById('hours'),
    minutes:     document.getElementById('minutes'),
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
    offline:     document.getElementById('offline-badge'),
    update:      document.getElementById('update-badge'),
    reloadBtn:   document.getElementById('reload-btn'),
    settings:    document.querySelector('.settings')
  };

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------

  var targetDate = null;   // a Date object: the fixed instant we count to
  var timerId = null;      // handle for the pending setTimeout

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
   * The placeholder target used on a first visit: the next 1 January at
   * 00:00 local time. It is always in the future and needs no explanation,
   * and the user is expected to replace it in the Set target panel.
   */
  function defaultTarget() {
    var now = new Date();
    return new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
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
      return { done: true, days: 0, hours: 0, minutes: 0, remainingMs: remainingMs };
    }

    // floor() gives "whole minutes still to run", the usual countdown
    // convention: it reads 0 minutes during the final 59 seconds.
    var totalMinutes = Math.floor(remainingMs / MS_PER_MINUTE);

    return {
      done: false,
      days: Math.floor(totalMinutes / MINUTES_PER_DAY),
      hours: Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR),
      minutes: totalMinutes % MINUTES_PER_HOUR,
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

    if (parts.done) {
      el.clock.classList.add('is-done');
      el.reached.hidden = false;
      el.readout.textContent = 'The target date and time has arrived.';
    } else {
      el.clock.classList.remove('is-done');
      el.reached.hidden = true;
      el.readout.textContent = describe(parts);
    }
  }

  // ---------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------

  /**
   * Schedule the next render for the exact moment the minute digit changes.
   *
   * The displayed minute count is floor(remaining / 60000), so it changes
   * when `remaining` crosses a multiple of 60000. `remaining % 60000` is
   * precisely how long that is away. Sleeping for just that long means we
   * wake once a minute rather than once a second, and - because the delay is
   * recomputed from the clock after every render - the schedule re-centres
   * itself instead of accumulating drift.
   */
  function scheduleNext() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (!targetDate) return;

    var remainingMs = targetDate.getTime() - Date.now();

    // Target reached: nothing left to animate, so stop scheduling entirely.
    if (remainingMs <= 0) return;

    var untilNextChange = remainingMs % MS_PER_MINUTE;
    if (untilNextChange === 0) untilNextChange = MS_PER_MINUTE;

    // +250ms so we land just after the boundary rather than a hair before it
    // and re-render the same value twice.
    timerId = setTimeout(tick, untilNextChange + 250);
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

    var name = (titleText || '').trim();
    el.title.textContent = name || 'Countdown';
    document.title = name ? name + ' - Countdown' : 'Countdown';

    var zone = localZoneName();
    el.targetLine.textContent = formatTargetForDisplay(date) +
      (zone ? ' · ' + zone : '');

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
    if (titleText.trim()) {
      storageSet(KEY_TITLE, titleText.trim());
    } else {
      storageRemove(KEY_TITLE);
    }

    applyTarget(parsed, titleText);

    // Collapse the panel so the digits are the thing on screen again.
    if (el.settings) el.settings.open = false;
  });

  el.resetBtn.addEventListener('click', function () {
    storageRemove(KEY_TARGET);
    storageRemove(KEY_TITLE);
    el.error.hidden = true;
    applyTarget(defaultTarget(), '');
  });

  // Recompute the moment the app becomes visible again. This is the handler
  // that makes a sleeping phone a non-issue: whatever the OS did to our
  // timers while the screen was off, the first thing we do on return is read
  // the clock and re-arm.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tick();
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
    var storedTitle = storageGet(KEY_TITLE) || '';

    applyTarget(storedTarget || defaultTarget(), storedTitle);
    updateOnlineBadge();
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
