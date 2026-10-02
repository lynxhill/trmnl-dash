
const ical = require("node-ical");

module.exports = async function handler(req, res) {
  try {
    // ---------------------------------------------------------
    // ASETUKSET
    // ---------------------------------------------------------
    const ICS_URL = process.env.ICS_URL;
    const TZ = "Europe/Helsinki";
    const START_HOUR = 8;
    const END_HOUR = 17;
    const SCREEN_WIDTH = 800;
    const SCREEN_HEIGHT = 480;
    const PIXELS_PER_HOUR = 40;
    const TIMELINE_HEIGHT = (END_HOUR - START_HOUR) * PIXELS_PER_HOUR;

    if (!ICS_URL) {
      throw new Error("ICS_URL puuttuu ympäristömuuttujista");
    }

    // ---------------------------------------------------------
    // AIKAVYÖHYKE- JA PÄIVÄMÄÄRÄAPURIT
    // ---------------------------------------------------------
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });

    function localParts(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new Error(`Virheellinen päivämäärä: ${date}`);
      }

      const parts = {};
      for (const part of formatter.formatToParts(date)) {
        if (part.type !== "literal") {
          parts[part.type] = Number(part.value);
        }
      }

      return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second
      };
    }

    function dateKey(date) {
      const p = localParts(date);
      return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    }

    function dateTimeKey(date) {
      const p = localParts(date);
      return `${dateKey(date)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`;
    }

    // Muuntaa Suomen paikallisen ajan Date-olioksi.
    function fromLocal(year, month, day, hour = 0, minute = 0, second = 0) {
      const target = Date.UTC(year, month - 1, day, hour, minute, second);
      let guess = target;

      for (let i = 0; i < 5; i++) {
        const p = localParts(new Date(guess));
        const represented = Date.UTC(
          p.year, p.month - 1, p.day,
          p.hour, p.minute, p.second
        );

        const difference = target - represented;
        if (difference === 0) break;
        guess += difference;
      }

      return new Date(guess);
    }

    function addDays(date, days) {
      const p = date instanceof Date ? localParts(date) : date;
      const temp = new Date(Date.UTC(
        p.year, p.month - 1, p.day + days
      ));

      return {
        year: temp.getUTCFullYear(),
        month: temp.getUTCMonth() + 1,
        day: temp.getUTCDate()
      };
    }

    function weekday(date) {
      const p = date instanceof Date ? localParts(date) : date;
      return new Date(Date.UTC(
        p.year, p.month - 1, p.day
      )).getUTCDay();
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTime(date) {
      const p = localParts(date);
      return `${String(p.hour).padStart(2, "0")}.${String(p.minute).padStart(2, "0")}`;
    }

    function minutesFromDayStart(date) {
      const p = localParts(date);
      return p.hour * 60 + p.minute;
    }

    // ---------------------------------------------------------
    // HAETAAN JA PARSITAAN ICS
    // ---------------------------------------------------------
    const icsResponse = await fetch(ICS_URL);

    if (!icsResponse.ok) {
      throw new Error(`Kalenterin haku epäonnistui: HTTP ${icsResponse.status}`);
    }

    const icsText = await icsResponse.text();
    const data = ical.sync.parseICS(icsText);

    // ---------------------------------------------------------
    // KULUVAN TYÖVIIKON RAJAT
    // ---------------------------------------------------------
    const nowParts = localParts(new Date());
    const today = fromLocal(
      nowParts.year, nowParts.month, nowParts.day
    );

    const todayWeekday = weekday(today);
    const daysSinceMonday = todayWeekday === 0 ? 6 : todayWeekday - 1;
    const monday = addDays(today, -daysSinceMonday);
    const friday = addDays(monday, 4);
    const saturday = addDays(monday, 5);

    const weekStart = fromLocal(monday.year, monday.month, monday.day);
    const weekEnd = fromLocal(saturday.year, saturday.month, saturday.day);

    const recurrenceSearchStart = new Date(
      weekStart.getTime() - 2 * 86400000
    );
    const recurrenceSearchEnd = new Date(
      weekEnd.getTime() + 2 * 86400000
    );

    const header =
      `TYÖVIIKKO ${monday.day}.${monday.month}. – ${friday.day}.${friday.month}.`;

    // ---------------------------------------------------------
    // TAPAHTUMIEN APUFUNKTIOT
    // ---------------------------------------------------------
    function getStatus(event) {
      const busyStatus = String(
        event["x-microsoft-cdo-busystatus"] ||
        event["x-microsoft-busystatus"] ||
        event.busystatus || ""
      ).toUpperCase();

      if (String(event.transparency || "").toUpperCase() === "TRANSPARENT") {
        return "free";
      }
      if (busyStatus === "FREE") return "free";
      if (busyStatus === "OOF") return "oof";
      if (busyStatus === "TENTATIVE") return "tentative";
      return "busy";
    }

    function shouldHide(event) {
      return String(event.summary || "").includes("¤");
    }

    function isInWorkWeek(start, end) {
      return start < weekEnd && end > weekStart;
    }

    function makeEvent(event, start, end, status) {
      if (!(start instanceof Date) || !(end instanceof Date)) return null;
      if (end <= start || shouldHide(event)) return null;
      if (!isInWorkWeek(start, end)) return null;

      return {
        summary: String(event.summary || "(Ei otsikkoa)"),
        start: new Date(start.getTime()),
        end: new Date(end.getTime()),
        isAllDay: event.datetype === "date",
        status
      };
    }

    // ---------------------------------------------------------
    // EXDATE-POISTOJEN KÄSITTELY
    // ---------------------------------------------------------

    function getExdateKeys(event) {
      const keys = new Set();
      const timestamps = new Set();
      const dates = new Set();

      if (!event.exdate) return { keys, timestamps, dates };

      function addDate(value) {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          keys.add(dateTimeKey(value));
          timestamps.add(value.getTime());
          dates.add(dateKey(value));
          return;
        }

        if (typeof value === "string") {
          // Päivämääräavaimet, esim. 2026-10-02
          if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            dates.add(value);
            return;
          }

          // iCalendar-muoto YYYYMMDDTHHmmss tai UTC-pääte Z
          const match = value.match(
            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/
          );

          if (match) {
            const [, y, mo, d, h, mi, s, utc] = match;
            const date = utc
              ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
              : fromLocal(+y, +mo, +d, +h, +mi, +s);

            keys.add(dateTimeKey(date));
            timestamps.add(date.getTime());
            dates.add(`${y}-${mo}-${d}`);
            return;
          }

          const parsed = new Date(value);
          if (!Number.isNaN(parsed.getTime())) {
            keys.add(dateTimeKey(parsed));
            timestamps.add(parsed.getTime());
            dates.add(dateKey(parsed));
          }
          return;
        }

        if (value && typeof value === "object") {
          addDate(value.date);
          addDate(value.start);
          addDate(value.value);
        }
      }

      if (Array.isArray(event.exdate)) {
        // node-ical voi tallentaa EXDATE-päivämäärät
        // taulukon avaimiksi ja Date-arvot taulukon arvoiksi.
        for (const [key, value] of Object.entries(event.exdate)) {
          addDate(key);
          addDate(value);
        }
      } else if (event.exdate instanceof Date) {
        addDate(event.exdate);
      } else if (typeof event.exdate === "object") {
        for (const [key, value] of Object.entries(event.exdate)) {
          addDate(key);
          addDate(value);
        }
      } else {
        addDate(event.exdate);
      }

      return { keys, timestamps, dates };
    }

    function isExcluded(exdates, occurrence, occurrenceStart) {
      return (
        exdates.timestamps.has(occurrence.getTime()) ||
        exdates.timestamps.has(occurrenceStart.getTime()) ||
        exdates.keys.has(dateTimeKey(occurrence)) ||
        exdates.keys.has(dateTimeKey(occurrenceStart)) ||
        exdates.dates.has(dateKey(occurrence)) ||
        exdates.dates.has(dateKey(occurrenceStart))
      );
    }

    // ---------------------------------------------------------
    // RECURRENCE-ID-POIKKEUKSET
    // ---------------------------------------------------------
    const overrides = new Map();

    for (const event of Object.values(data)) {
      if (event.type !== "VEVENT" || !event.recurrenceid) continue;

      overrides.set(dateTimeKey(event.recurrenceid), event);
    }

    // ---------------------------------------------------------
    // TOISTUVIEN TAPAHTUMIEN LAAJENNUS
    // ---------------------------------------------------------
    function expandRecurring(event, status) {
      const results = [];

      if (
        !event.rrule ||
        !(event.start instanceof Date) ||
        !(event.end instanceof Date)
      ) {
        return results;
      }

      const startParts = localParts(event.start);
      const endParts = localParts(event.end);

      const startMinutes = startParts.hour * 60 + startParts.minute;
      const endMinutes = endParts.hour * 60 + endParts.minute;

      let durationMinutes = endMinutes - startMinutes;
      if (durationMinutes <= 0) durationMinutes += 1440;
      if (durationMinutes <= 0) return results;

      const exdates = getExdateKeys(event);
      if (String(event.summary || "").includes("ABR")) {
        console.log("[ABR EXDATE DEBUG]", {
          summary: event.summary,
          uid: event.uid,
          start: event.start?.toISOString?.(),
          rawExdate: event.exdate,
          parsedExdateKeys: [...exdates.keys],
          parsedExdateTimestamps: [...exdates.timestamps]
        });
      }
      let occurrences = [];

      try {
        occurrences = event.rrule.between(
          recurrenceSearchStart,
          recurrenceSearchEnd,
          true
        );
      } catch (error) {
        console.error("RRULE-laajennus epäonnistui:", event.summary, error);
        return results;
      }

      for (const occurrence of occurrences) {
        if (!(occurrence instanceof Date)) continue;

        // Säilytetään toistokerran paikallinen päivämäärä ja
        // alkuperäisen tapahtuman paikallinen kellonaika.
        const p = localParts(occurrence);

        const occurrenceStart = fromLocal(
          p.year,
          p.month,
          p.day,
          startParts.hour,
          startParts.minute,
          startParts.second
        );

        const occurrenceEnd = new Date(
          occurrenceStart.getTime() + durationMinutes * 60000
        );

        const occurrenceKey = dateTimeKey(occurrenceStart);

        if (String(event.summary || "").includes("ABR")) {
          console.log("[ABR OCCURRENCE DEBUG]", {
            summary: event.summary,
            occurrence: occurrence.toISOString(),
            occurrenceLocal: dateTimeKey(occurrence),
            occurrenceStart: occurrenceStart.toISOString(),
            occurrenceKey,
            excluded: isExcluded(exdates, occurrence, occurrenceStart)
          });
        }

        
        // Ohitetaan Outlookin EXDATE-kentässä poistetut kerrat.
        if (isExcluded(exdates, occurrence, occurrenceStart)) {
          continue;
        }

        // Käsitellään yksittäisen toistokerran muutokset.
        const override = overrides.get(occurrenceKey);

        if (override) {
          if (String(override.status || "").toUpperCase() === "CANCELLED") {
            continue;
          }

          const changed = makeEvent(
            override,
            override.start,
            override.end,
            getStatus(override)
          );

          if (changed) results.push(changed);
          continue;
        }

        const generated = makeEvent(
          event,
          occurrenceStart,
          occurrenceEnd,
          status
        );

        if (generated) results.push(generated);
      }

      return results;
    }

    // ---------------------------------------------------------
    // KAIKKIEN TAPAHTUMIEN KERÄYS
    // ---------------------------------------------------------
    const events = [];

    for (const event of Object.values(data)) {
      if (event.type !== "VEVENT" || event.recurrenceid) continue;
      if (!(event.start instanceof Date) || !(event.end instanceof Date)) continue;
      if (shouldHide(event)) continue;

      const status = getStatus(event);

      if (event.rrule) {
        events.push(...expandRecurring(event, status));
      } else {
        const single = makeEvent(event, event.start, event.end, status);
        if (single) events.push(single);
      }
    }

    // ---------------------------------------------------------
    // PÄIVÄKOHTAINEN JAKO
    // ---------------------------------------------------------
    const dayEvents = [[], [], [], [], []];

    for (const event of events) {
      for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
        const day = addDays(monday, dayIndex);
        const dayStart = fromLocal(day.year, day.month, day.day);
        const nextDay = addDays(day, 1);
        const dayEnd = fromLocal(nextDay.year, nextDay.month, nextDay.day);

        if (event.start < dayEnd && event.end > dayStart) {
          dayEvents[dayIndex].push({
            ...event,
            visibleStart: new Date(
              Math.max(event.start.getTime(), dayStart.getTime())
            ),
            visibleEnd: new Date(
              Math.min(event.end.getTime(), dayEnd.getTime())
            )
          });
        }
      }
    }

    // ---------------------------------------------------------
    // PÄÄLLEKKÄISTEN TAPAHTUMIEN SARAKKEET
    // ---------------------------------------------------------
    function layoutDayEvents(dayList) {
      const sorted = [...dayList].sort((a, b) =>
        a.visibleStart - b.visibleStart ||
        a.visibleEnd - b.visibleEnd
      );

      const active = [];

      for (const event of sorted) {
        for (let i = active.length - 1; i >= 0; i--) {
          if (active[i].visibleEnd <= event.visibleStart) {
            active.splice(i, 1);
          }
        }

        const usedLanes = new Set(active.map(item => item.lane));
        let lane = 0;

        while (usedLanes.has(lane)) lane++;

        event.lane = lane;
        active.push(event);
      }

      // Päällekkäiset tapahtumat ryhmitellään yhteisiin sarakkeisiin.
      let group = [];
      let groupEnd = null;

      function finalizeGroup() {
        if (!group.length) return;

        const columns = Math.max(
          1,
          ...group.map(event => event.lane + 1)
        );

        for (const event of group) {
          event.columns = columns;
        }

        group = [];
      }

      for (const event of sorted) {
        if (groupEnd === null || event.visibleStart >= groupEnd) {
          finalizeGroup();
          group = [event];
          groupEnd = event.visibleEnd;
        } else {
          group.push(event);
          if (event.visibleEnd > groupEnd) {
            groupEnd = event.visibleEnd;
          }
        }
      }

      finalizeGroup();
      return sorted;
    }

    for (let i = 0; i < dayEvents.length; i++) {
      dayEvents[i] = layoutDayEvents(dayEvents[i]);
    }

    // ---------------------------------------------------------
    // TAPAHTUMIEN HTML
    // ---------------------------------------------------------
    function renderEvent(event) {
      const start = event.visibleStart;
      const end = event.visibleEnd;

      const startMinutes =
        minutesFromDayStart(start) - START_HOUR * 60;
      const endMinutes =
        minutesFromDayStart(end) - START_HOUR * 60;

      const clippedStart = Math.max(0, startMinutes);
      const clippedEnd = Math.min(
        (END_HOUR - START_HOUR) * 60,
        endMinutes
      );

      if (clippedEnd <= clippedStart) return "";

      const top = (clippedStart / 60) * PIXELS_PER_HOUR;
      const height = Math.max(
        18,
        ((clippedEnd - clippedStart) / 60) * PIXELS_PER_HOUR
      );

      const columns = Math.max(1, event.columns || 1);
      const lane = event.lane || 0;
      const width = 100 / columns;
      const left = lane * width;

      const startTime = formatTime(start);
      const endTime = formatTime(end);
      const durationMinutes = (end.getTime() - start.getTime()) / 60000;
      const summary = escapeHtml(event.summary);

      const content = durationMinutes <= 30
        ? `<div class="short"><span class="time">${startTime}</span><span class="title">${summary}</span></div>`
        : `<div class="time">${startTime}–${endTime}</div><div class="title">${summary}</div>`;

      return `
        <div class="event ${event.status}"
          style="top:${top}px;height:${height}px;left:${left}%;width:${width}%;">
          ${content}
        </div>
      `;
    }

    // ---------------------------------------------------------
    // PÄIVÄOTSIKOT JA TUNTIMERKINNÄT
    // ---------------------------------------------------------
    const dayNames = ["MA", "TI", "KE", "TO", "PE"];

    const dayHeaders = dayNames.map((name, i) => {
      const date = addDays(monday, i);

      return `
        <div class="day-header">
          <div class="day-name">${name}</div>
          <div class="day-date">${date.day}.${date.month}.</div>
        </div>
      `;
    }).join("");

    const dayColumns = dayEvents.map(dayList => {
      const eventHtml = dayList.map(renderEvent).join("");

      return `
        <div class="day-column">
          <div class="day-grid"></div>
          ${eventHtml}
        </div>
      `;
    }).join("");

    const hoursHtml = Array.from(
      { length: END_HOUR - START_HOUR + 1 },
      (_, i) => {
        const hour = START_HOUR + i;
        return `
          <div class="hour-label" style="top:${i * PIXELS_PER_HOUR}px">
            ${hour}
          </div>
        `;
      }
    ).join("");

    // ---------------------------------------------------------
    // HTML JA CSS
    // ---------------------------------------------------------
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="fi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=${SCREEN_WIDTH}, initial-scale=1">
        <style>
          * { box-sizing: border-box; }

          html, body {
            margin: 0;
            padding: 0;
            width: ${SCREEN_WIDTH}px;
            height: ${SCREEN_HEIGHT}px;
            overflow: hidden;
            background: #FFFFFF;
            color: #000000;
            font-family: Arial, sans-serif;
          }

          body {
            display: flex;
            flex-direction: column;
          }

          .header {
            height: 48px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 25px;
            font-weight: bold;
            white-space: nowrap;
          }

          .calendar {
            display: flex;
            flex: 1;
            min-height: 0;
            flex-direction: column;
            padding: 0 8px 8px;
          }

          .day-header-row, .timeline-row {
            display: grid;
            grid-template-columns: 38px repeat(5, 1fr);
          }

          .day-header-row {
            height: 35px;
            flex-shrink: 0;
          }

          .day-header {
            border: 1px solid #000000;
            border-bottom: 2px solid #000000;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            font-size: 15px;
            font-weight: bold;
          }

          .day-name { font-weight: bold; }
          .day-date { font-weight: normal; }

          .timeline-row {
            flex: 1;
            min-height: 0;
          }

          .hour-column {
            position: relative;
            height: ${TIMELINE_HEIGHT}px;
          }

          .hour-label {
            position: absolute;
            right: 5px;
            transform: translateY(-7px);
            font-size: 13px;
            color: #444444;
          }

          .day-column {
            position: relative;
            min-width: 0;
            height: ${TIMELINE_HEIGHT}px;
            border-left: 1px solid #000000;
            border-right: 1px solid #000000;
            overflow: hidden;
          }

          .day-grid {
            position: absolute;
            inset: 0;
            pointer-events: none;
            background-image: repeating-linear-gradient(
              to bottom,
              #AAAAAA 0px,
              #AAAAAA 1px,
              transparent 1px,
              transparent ${PIXELS_PER_HOUR}px
            );
          }

          .event {
            position: absolute;
            z-index: 1;
            padding: 3px;
            border: 2px solid #000000;
            overflow: hidden;
            font-size: 12px;
            line-height: 1.15;
            overflow-wrap: anywhere;
          }

          .event.busy {
            background: #555555;
            color: #FFFFFF;
          }

          .event.free, .event.tentative {
            background: #FFFFFF;
            color: #000000;
            border: 2px dashed #555555;
          }

          .event.oof {
            background: #000000;
            color: #FFFFFF;
          }

          .time {
            font-size: 11px;
            line-height: 1.1;
            margin-bottom: 2px;
          }

          .title {
            overflow: hidden;
            overflow-wrap: anywhere;
          }

          .short {
            display: flex;
            align-items: flex-start;
            gap: 4px;
            min-width: 0;
          }

          .short .time {
            flex-shrink: 0;
            font-weight: bold;
            margin: 0;
          }

          .short .title {
            flex: 1;
            min-width: 0;
          }
        </style>
      </head>
      <body>
        <div class="header">${escapeHtml(header)}</div>
        <div class="calendar">
          <div class="day-header-row">
            <div></div>
            ${dayHeaders}
          </div>
          <div class="timeline-row">
            <div class="hour-column">${hoursHtml}</div>
            ${dayColumns}
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("TRMNL calendar error:", error);

    res.status(500).send(`
      <html>
        <body style="font-family:Arial,sans-serif;padding:20px;color:#000">
          <h2>Kalenterin lataus epäonnistui</h2>
          <p>${escapeHtml(error.message || error)}</p>
        </body>
      </html>
    `);
  }
};
