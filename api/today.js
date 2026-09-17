
const ical = require("node-ical");

module.exports = async function handler(req, res) {
  try {
    /* =========================================================
       1. ASETUKSET
       ========================================================= */

    const ICS_URL = process.env.ICS_URL;

    // Kaikki kalenterin päivämäärät tulkitaan Suomen ajassa.
    const TZ = "Europe/Helsinki";

    // Näytettävä aikaväli.
    const START_HOUR = 8;
    const END_HOUR = 17;

    // Näytön mitat ja kalenterin mittakaava.
    const SCREEN_WIDTH = 800;
    const SCREEN_HEIGHT = 480;

    const PIXELS_PER_HOUR = 40;
    const TIMELINE_HEIGHT =
      (END_HOUR - START_HOUR) * PIXELS_PER_HOUR;

    if (!ICS_URL) {
      throw new Error("ICS_URL puuttuu ympäristömuuttujista");
    }

    /* =========================================================
       2. AIKAVYÖHYKE- JA PÄIVÄMÄÄRÄAPURIT

       Tärkeää:
       Date-oliota ei muuteta toLocaleString()-muunnoksella
       toiseksi Date-olioksi, koska se voi siirtää kellonaikaa.
       ========================================================= */

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

// Palauttaa päivämäärän ja kellonajan Suomen ajassa.
function localParts(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error(
      `localParts sai virheellisen päivämäärän: ${date}`
    );
  }

  const parts = formatter.formatToParts(date);
  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = Number(part.value);
    }
  }

  return {
    year: result.year,
    month: result.month,
    day: result.day,
    hour: result.hour,
    minute: result.minute,
    second: result.second
  };
}

    // Muodostaa Suomen paikallisen päivämäärän avaimen.
    function dateKey(date) {
      const p = localParts(date);

      return [
        p.year,
        String(p.month).padStart(2, "0"),
        String(p.day).padStart(2, "0")
      ].join("-");
    }

    // Muodostaa paikallisen päivämäärän ja kellonajan avaimen.
    // Tätä tarvitaan RECURRENCE-ID- ja EXDATE-tunnisteisiin.
    function dateTimeKey(date) {
      const p = localParts(date);

      return (
        dateKey(date) +
        "T" +
        String(p.hour).padStart(2, "0") +
        ":" +
        String(p.minute).padStart(2, "0") +
        ":" +
        String(p.second).padStart(2, "0")
      );
    }

    // Muuntaa Suomen paikallisen ajan oikeaksi Date-olioksi.
    // Aikavyöhykkeen kesä- ja talviaika huomioidaan.
    function fromLocal(year, month, day, hour = 0, minute = 0) {
      const target = Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        0
      );

      let guess = target;

      // Iteroidaan aikavyöhykkeen offset oikeaksi.
      for (let i = 0; i < 4; i++) {
        const p = localParts(new Date(guess));

        const represented = Date.UTC(
          p.year,
          p.month - 1,
          p.day,
          p.hour,
          p.minute,
          p.second
        );

        const difference = target - represented;

        if (difference === 0) break;

        guess += difference;
      }

      return new Date(guess);
    }

// Lisää päiviä kalenteripäivinä, ei 24 tunnin jaksoina.
// Hyväksyy sekä Date-olion että { year, month, day } -objektin.
function addDays(date, days) {
  let p;

  if (date instanceof Date) {
    p = localParts(date);
  } else if (
    date &&
    Number.isInteger(date.year) &&
    Number.isInteger(date.month) &&
    Number.isInteger(date.day)
  ) {
    p = date;
  } else {
    throw new Error(
      `addDays sai virheellisen päivämäärän: ${JSON.stringify(date)}`
    );
  }

  const temp = new Date(
    Date.UTC(p.year, p.month - 1, p.day + days)
  );

  return {
    year: temp.getUTCFullYear(),
    month: temp.getUTCMonth() + 1,
    day: temp.getUTCDate()
  };
}
    // Viikonpäivä Suomen paikallisesta päivämäärästä.
    // 0 = sunnuntai, 1 = maanantai, ... 6 = lauantai.
    function weekday(date) {
      const p = localParts(date);

      return new Date(
        Date.UTC(p.year, p.month - 1, p.day)
      ).getUTCDay();
    }

    // Suojaa HTML:n otsikot ja muut tekstikentät.
    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    /* =========================================================
       3. HAETAAN JA PARSITAAN ICALENDAR
       ========================================================= */

    const icsResponse = await fetch(ICS_URL);

    if (!icsResponse.ok) {
      throw new Error(
        `Kalenterin haku epäonnistui: HTTP ${icsResponse.status}`
      );
    }

    const icsText = await icsResponse.text();

    const data = ical.sync.parseICS(icsText);

    /* =========================================================
       4. KULUVAN TYÖVIIKON RAJAT

       Viikko on aina maanantai–perjantai.
       Käytetään Suomen paikallista päivämäärää.
       ========================================================= */

    const now = new Date();
    const nowParts = localParts(now);

    const todayLocal = fromLocal(
      nowParts.year,
      nowParts.month,
      nowParts.day
    );

    const todayWeekday = weekday(todayLocal);

    // Maanantai = viikon alku.
    const daysSinceMonday =
      todayWeekday === 0 ? 6 : todayWeekday - 1;

    const monday = addDays(todayLocal, -daysSinceMonday);

    const friday = addDays(monday, 4);
    const saturday = addDays(monday, 5);

    const weekStart = fromLocal(
      monday.year,
      monday.month,
      monday.day
    );

    const weekEnd = fromLocal(
      saturday.year,
      saturday.month,
      saturday.day
    );

    // Laajennetaan hakualuetta hieman molemmista päistä.
    // Tämä auttaa löytämään myös aikavyöhykerajojen lähellä
    // olevat toistot, jotka osuvat Suomen päivämäärään.
    const recurrenceSearchStart =
      new Date(weekStart.getTime() - 2 * 86400000);

    const recurrenceSearchEnd =
      new Date(weekEnd.getTime() + 2 * 86400000);

    /* =========================================================
       5. VIIKON PÄIVÄT JA OTSIKKO
       ========================================================= */

    const weekdaysFi = [
      "sunnuntai",
      "maanantai",
      "tiistai",
      "keskiviikko",
      "torstai",
      "perjantai",
      "lauantai"
    ];

    const monthsFi = [
      "tammikuu",
      "helmikuu",
      "maaliskuu",
      "huhtikuu",
      "toukokuu",
      "kesäkuu",
      "heinäkuu",
      "elokuu",
      "syyskuu",
      "lokakuu",
      "marraskuu",
      "joulukuu"
    ];

    const mondayLabel =
      `${monday.day}.${monday.month}.`;

    const fridayLabel =
      `${friday.day}.${friday.month}.`;

    const header =
      `TYÖVIIKKO ${mondayLabel} – ${fridayLabel}`;

    /* =========================================================
       6. TAPAHTUMIEN APUFUNKTIOT
       ========================================================= */

    // Palauttaa tapahtuman varausstatuksen.
    function getStatus(event) {
      const busyStatus = String(
        event["x-microsoft-cdo-busystatus"] ||
        event["x-microsoft-busystatus"] ||
        event.busystatus ||
        ""
      ).toUpperCase();

      if (event.transparency === "TRANSPARENT") {
        return "free";
      }

      if (busyStatus === "FREE") {
        return "free";
      }

      if (busyStatus === "OOF") {
        return "oof";
      }

      if (busyStatus === "TENTATIVE") {
        return "tentative";
      }

      return "busy";
    }

    // Tarkistaa, onko otsikko tarkoitus piilottaa.
    function shouldHide(event) {
      return String(event.summary || "").includes("¤");
    }

    // Palauttaa tapahtuman keston millisekunteina.
    function getDuration(event) {
      if (
        !(event.start instanceof Date) ||
        !(event.end instanceof Date)
      ) {
        return 0;
      }

      return Math.max(
        0,
        event.end.getTime() - event.start.getTime()
      );
    }

    // Tarkistaa, osuuko tapahtuma työviikon maanantai–perjantaihin.
    function isInWorkWeek(start, end) {
      return (
        start < weekEnd &&
        end > weekStart
      );
    }

    // Muodostaa tapahtumaolion yhden esiintymän perusteella.
    function makeEvent(event, start, end, status) {
      if (!(start instanceof Date) || !(end instanceof Date)) {
        return null;
      }

      if (end <= start) {
        return null;
      }

      if (shouldHide(event)) {
        return null;
      }

      if (!isInWorkWeek(start, end)) {
        return null;
      }

      return {
        summary: String(event.summary || "(Ei otsikkoa)"),
        start: new Date(start.getTime()),
        end: new Date(end.getTime()),
        isAllDay: event.datetype === "date",
        status
      };
    }

    /* =========================================================
       7. RECURRENCE-ID-POIKKEUKSET

       Toistuvan tapahtuman yksittäinen esiintymä voi olla:
       - poistettu
       - siirretty
       - otsikoltaan muutettu
       - kestoltaan muutettu

       Poikkeus kohdistetaan alkuperäiseen esiintymään.
       Käytetään päivämäärän lisäksi kellonaikaa.
       ========================================================= */

    const overrides = new Map();

    for (const key of Object.keys(data)) {
      const event = data[key];

      if (event.type !== "VEVENT") continue;
      if (!event.recurrenceid) continue;

      const recurrenceKey = dateTimeKey(
        event.recurrenceid
      );

      overrides.set(recurrenceKey, event);
    }

    /* =========================================================
       8. EXDATE-POISTOT
       ========================================================= */

    function getExdateKeys(event) {
      const keys = new Set();

      if (!event.exdate) {
        return keys;
      }

      const values = Array.isArray(event.exdate)
        ? event.exdate
        : Object.values(event.exdate);

      for (const value of values) {
        if (value instanceof Date) {
          keys.add(dateTimeKey(value));
        }
      }

      return keys;
    }

    /* =========================================================
       9. TOISTUVAN TAPAHTUMAN ESIINTYMÄT

       RRULE laajennetaan koko työviikon hakuvälille.

       Ei käytetä vanhaa fallbackia, joka tarkisti vain
       alkuperäisen tapahtuman päivämäärän tai viikonpäivän.
       ========================================================= */

    function expandRecurring(event, status) {
      const results = [];

      if (
        !event.rrule ||
        !(event.start instanceof Date) ||
        !(event.end instanceof Date)
      ) {
        return results;
      }

      const duration = getDuration(event);

      if (duration <= 0) {
        return results;
      }

      const exdateKeys = getExdateKeys(event);

      let occurrences = [];

      try {
        // node-ical käyttää rrule-oliota esiintymien hakuun.
        // Älä muuta alkuperäistä DTSTART-oliota.
        occurrences = event.rrule.between(
          recurrenceSearchStart,
          recurrenceSearchEnd,
          true
        );
      } catch (error) {
        console.error(
          "RRULE-laajennus epäonnistui:",
          event.summary,
          error
        );

        return results;
      }

      for (const occurrence of occurrences) {
        if (!(occurrence instanceof Date)) continue;

        const occurrenceKey = dateTimeKey(occurrence);

        // Jos toistokerta on poistettu EXDATE-listasta,
        // sitä ei lisätä kalenteriin.
        if (exdateKeys.has(occurrenceKey)) {
          continue;
        }

        // Jos yksittäinen esiintymä on muutettu,
        // käytetään poikkeustapahtumaa.
        const override = overrides.get(occurrenceKey);

        if (override) {
          // CANCELLED-poikkeus tarkoittaa poistettua esiintymää.
          if (
            String(override.status || "").toUpperCase() ===
            "CANCELLED"
          ) {
            continue;
          }

          const overrideStatus = getStatus(override);

          const overrideEvent = makeEvent(
            override,
            override.start,
            override.end,
            overrideStatus
          );

          if (overrideEvent) {
            results.push(overrideEvent);
          }

          continue;
        }

        // Tavallinen toistuva esiintymä.
        const occurrenceEnd = new Date(
          occurrence.getTime() + duration
        );

        const generated = makeEvent(
          event,
          occurrence,
          occurrenceEnd,
          status
        );

        if (generated) {
          results.push(generated);
        }
      }

      return results;
    }

    /* =========================================================
       10. KOKO KALENTERIN PARSINTA
       ========================================================= */

    const events = [];

    for (const key of Object.keys(data)) {
      const event = data[key];

      if (event.type !== "VEVENT") continue;

      // Poikkeustapahtumat käsitellään alkuperäisen RRULE:n
      // yhteydessä. Niitä ei lisätä toiseen kertaan.
      if (event.recurrenceid) continue;

      if (
        !(event.start instanceof Date) ||
        !(event.end instanceof Date)
      ) {
        continue;
      }

      const status = getStatus(event);

      // Piilotetaan ¤-merkillä merkityt tapahtumat.
      if (shouldHide(event)) continue;

      // Toistuvat tapahtumat.
      if (event.rrule) {
        const expanded = expandRecurring(event, status);

        events.push(...expanded);

        continue;
      }

      // Tavalliset yksittäiset tapahtumat.
      const single = makeEvent(
        event,
        event.start,
        event.end,
        status
      );

      if (single) {
        events.push(single);
      }
    }

    /* =========================================================
       11. PÄIVÄKOHTAINEN JAKO

       Yön yli jatkuva tapahtuma leikataan näkyvään päivään.
       Tapahtuma voi näkyä useammassa työviikon päivässä.
       ========================================================= */

    const dayEvents = [[], [], [], [], []];

    for (const event of events) {
      for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
        const day = addDays(monday, dayIndex);

        const dayStart = fromLocal(
          day.year,
          day.month,
          day.day
        );

        const nextDay = addDays(day, 1);

        const dayEnd = fromLocal(
          nextDay.year,
          nextDay.month,
          nextDay.day
        );

        if (
          event.start < dayEnd &&
          event.end > dayStart
        ) {
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

    /* =========================================================
       12. PÄIVÄKOHTAINEN PÄÄLLEKKÄISASETTELU

       Jokaiselle päivälle muodostetaan tapahtumien sarakkeet.
       Päällekkäiset tapahtumat saavat eri sarakkeen.

       Tämä on päiväkohtainen greedy-lane-algoritmi.
       ========================================================= */

    function layoutDayEvents(dayList) {
      const sorted = [...dayList].sort((a, b) =>
        a.visibleStart - b.visibleStart ||
        a.visibleEnd - b.visibleEnd
      );

      const active = [];
      const lanes = [];

      for (const event of sorted) {
        // Poistetaan jo päättyneet tapahtumat aktiivisista.
        for (let i = active.length - 1; i >= 0; i--) {
          if (
            active[i].visibleEnd <= event.visibleStart
          ) {
            active.splice(i, 1);
          }
        }

        const usedLanes = new Set(
          active.map(item => item.lane)
        );

        let lane = 0;

        while (usedLanes.has(lane)) {
          lane++;
        }

        event.lane = lane;

        active.push(event);

        lanes[lane] = true;

        // Päällekkäisyysmäärä selvitetään myöhemmin.
      }

      // Tapahtumien väliset yhteydet ja komponentit.
      // Jokainen päällekkäisten tapahtumien ryhmä saa
      // yhteisen sarakemäärän.
      let group = [];

      function finalizeGroup() {
        if (group.length === 0) return;

        const columns = Math.max(
          1,
          ...group.map(event => event.lane + 1)
        );

        for (const event of group) {
          event.columns = columns;
        }

        group = [];
      }

      let groupEnd = null;

      for (const event of sorted) {
        if (
          groupEnd === null ||
          event.visibleStart >= groupEnd
        ) {
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

    /* =========================================================
       13. KELLONAJAN MUOTOILU
       ========================================================= */

    function formatTime(date) {
      const p = localParts(date);

      return (
        String(p.hour).padStart(2, "0") +
        "." +
        String(p.minute).padStart(2, "0")
      );
    }

    // Muuntaa päivän alusta kuluneen ajan pikseleiksi.
    function minutesFromDayStart(date) {
      const p = localParts(date);

      return p.hour * 60 + p.minute;
    }

    /* =========================================================
       14. TAPAHTUMIEN HTML
       ========================================================= */

    function renderEvent(event) {
      const start = event.visibleStart;
      const end = event.visibleEnd;

      const startMinutes =
        minutesFromDayStart(start) -
        START_HOUR * 60;

      const endMinutes =
        minutesFromDayStart(end) -
        START_HOUR * 60;

      // Piirretään vain näkyvän aikavälin kanssa leikkaavat.
      const clippedStart = Math.max(
        0,
        startMinutes
      );

      const clippedEnd = Math.min(
        (END_HOUR - START_HOUR) * 60,
        endMinutes
      );

      if (clippedEnd <= clippedStart) {
        return "";
      }

      const top =
        (clippedStart / 60) * PIXELS_PER_HOUR;

      const height = Math.max(
        18,
        ((clippedEnd - clippedStart) / 60) *
          PIXELS_PER_HOUR
      );

      const columns = Math.max(
        1,
        event.columns || 1
      );

      const lane = event.lane || 0;

      const width = 100 / columns;
      const left = lane * width;

      const startTime = formatTime(start);
      const endTime = formatTime(end);

      const durationMinutes =
        (end.getTime() - start.getTime()) / 60000;

      const summary = escapeHtml(event.summary);

      let content = "";

      // Lyhyet tapahtumat: aika ja otsikko samalle riville.
      if (durationMinutes <= 30) {
        content = `
          <div class="short">
            <span class="time">${startTime}</span>
            <span class="title">${summary}</span>
          </div>
        `;
      } else {
        content = `
          <div class="time">
            ${startTime}–${endTime}
          </div>
          <div class="title">
            ${summary}
          </div>
        `;
      }

      return `
        <div
          class="event ${event.status}"
          style="
            top:${top}px;
            height:${height}px;
            left:${left}%;
            width:${width}%;
          "
        >
          ${content}
        </div>
      `;
    }

    /* =========================================================
       15. PÄIVÄPALSTAT
       ========================================================= */

    const dayNames = [
      "MA",
      "TI",
      "KE",
      "TO",
      "PE"
    ];

    const dayHeaders = dayNames.map((name, i) => {
      const date = addDays(monday, i);

      return `
        <div class="day-header">
          <div class="day-name">${name}</div>
          <div class="day-date">
            ${date.day}.${date.month}.
          </div>
        </div>
      `;
    }).join("");

    const dayColumns = dayEvents.map(dayList => {
      const eventHtml = dayList
        .map(renderEvent)
        .join("");

      return `
        <div class="day-column">
          <div class="day-grid"></div>
          ${eventHtml}
        </div>
      `;
    }).join("");

    /* =========================================================
       16. TUNTIMERKINNÄT
       ========================================================= */

    const hoursHtml = Array.from(
      { length: END_HOUR - START_HOUR + 1 },
      (_, i) => {
        const hour = START_HOUR + i;

        return `
          <div class="hour-label"
            style="top:${i * PIXELS_PER_HOUR}px">
            ${hour}
          </div>
        `;
      }
    ).join("");

    /* =========================================================
       17. HTML JA CSS
       ========================================================= */

    res.setHeader(
      "Content-Type",
      "text/html; charset=utf-8"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="fi">
      <head>
        <meta charset="UTF-8">

        <meta
          name="viewport"
          content="width=${SCREEN_WIDTH}, initial-scale=1"
        >

        <style>
          * {
            box-sizing: border-box;
          }

          html,
          body {
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

          /* ---------- Otsikko ---------- */

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

          /* ---------- Päiväotsikot ---------- */

          .calendar {
            display: flex;
            flex: 1;
            min-height: 0;
            flex-direction: column;
            padding: 0 8px 8px 8px;
          }

          .day-header-row {
            display: grid;
            grid-template-columns: 38px repeat(5, 1fr);
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

          .day-name {
            font-weight: bold;
          }

          .day-date {
            font-weight: normal;
          }

          /* ---------- Aikajana ---------- */

          .timeline-row {
            display: grid;
            grid-template-columns: 38px repeat(5, 1fr);
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

          /* ---------- Päivän tapahtumapalsta ---------- */

          .day-column {
            position: relative;
            min-width: 0;
            height: ${TIMELINE_HEIGHT}px;
            border-left: 1px solid #000000;
            border-right: 1px solid #000000;
            overflow: hidden;
          }

          /* Vaakaviivat koko päivän leveydeltä. */
          .day-grid {
            position: absolute;
            inset: 0;
            pointer-events: none;
            background-image:
              repeating-linear-gradient(
                to bottom,
                #AAAAAA 0px,
                #AAAAAA 1px,
                transparent 1px,
                transparent ${PIXELS_PER_HOUR}px
              );
          }

          /* ---------- Tapahtumalaatikot ---------- */

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

          .event.free,
          .event.tentative {
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

          /* ---------- Lyhyet tapahtumat ---------- */

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
        <div class="header">
          ${header}
        </div>

        <div class="calendar">

          <div class="day-header-row">
            <div></div>
            ${dayHeaders}
          </div>

          <div class="timeline-row">

            <div class="hour-column">
              ${hoursHtml}
            </div>

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
        <body style="
          font-family:Arial,sans-serif;
          padding:20px;
          color:#000;
        ">
          <h2>Kalenterin lataus epäonnistui</h2>
          <p>${String(error.message || error)}</p>
        </body>
      </html>
    `);
  }
};
