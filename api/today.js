const ical = require("node-ical");

module.exports = async function handler(req, res) {

  /* ================= CONFIG ================= */

  const ICS_URL = process.env.ICS_URL;
  const WEATHER_KEY = process.env.WEATHER_KEY;
  const RSS_URL = process.env.RSS_URL;
  const CITY = "Pori";

  const helsinkiTZ = "Europe/Helsinki";

  const startHour = 8;
  const endHour = 17;
  const pixelsPerHour = 40;

  const timelineHeight = (endHour - startHour) * pixelsPerHour;

  /* ================= WEATHER ================= */

  const weatherRes = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${CITY}&units=metric&appid=${WEATHER_KEY}`
  );
  const weather = await weatherRes.json();

  const iconUrl = `https://openweathermap.org/img/wn/${weather.weather[0].icon}@2x.png`;

  const main = weather.weather[0].main;
  const desc = weather.weather[0].description.toLowerCase();

  let weatherDescription = "";

  switch (main) {
    case "Clear": weatherDescription = "Selkeää"; break;
    case "Clouds":
      if (desc.includes("few")) weatherDescription = "Vähän pilvistä";
      else if (desc.includes("scattered")) weatherDescription = "Puolipilvistä";
      else weatherDescription = "Pilvistä";
      break;
    case "Rain":
      if (desc.includes("light")) weatherDescription = "Heikkoa sadetta";
      else if (desc.includes("heavy")) weatherDescription = "Voimakasta sadetta";
      else weatherDescription = "Sadetta";
      break;
    case "Drizzle": weatherDescription = "Tihkusadetta"; break;
    case "Thunderstorm": weatherDescription = "Ukkosta"; break;
    case "Snow": weatherDescription = "Lumisadetta"; break;
    default: weatherDescription = desc;
  }

  /* ================= RSS ================= */

  const feedRes = await fetch(RSS_URL);
  const xml = await feedRes.text();

  const rssItems = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0,1)
    .map(block => {
      let desc = block[1].match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "";
      desc = desc.replace(/<!\[CDATA\[|\]\]>/g, "");
      desc = desc.replace(/<br\s*\/?>/gi, "\n");
      desc = desc.replace(/<[^>]+>/g, "");
      return desc;
    });

  /* ================= CALENDAR ================= */

  const icsRes = await fetch(ICS_URL);
  const icsText = await icsRes.text();
  const data = ical.sync.parseICS(icsText);

  /* --- helperit --- */

  const toLocal = d =>
    new Date(new Date(d).toLocaleString("en-US",{timeZone: helsinkiTZ}));

  const dateKey = d => toLocal(d).toISOString().slice(0,10);

  const today = toLocal(new Date());

  const todayStart = new Date(today); todayStart.setHours(0,0,0,0);
  const todayEnd = new Date(today); todayEnd.setHours(23,59,59,999);

  /* --- override-eventit (RECURRENCE-ID) --- */

  const overrides = {};

  for (const k in data) {
    const e = data[k];
    if (e.type !== "VEVENT") continue;

    if (e.recurrenceid) {
      overrides[dateKey(e.recurrenceid)] = e;
    }
  }

  /* --- parsinta --- */

  let events = [];

  for (const k in data) {

    const e = data[k];
    if (e.type !== "VEVENT") continue;
    if (e.recurrenceid) continue;

    /* status (Outlook-yhteensopiva) */
    let status = "busy";

    const busyStatus =
      (e["x-microsoft-cdo-busystatus"] ||
       e["x-microsoft-busystatus"] ||
       "").toUpperCase();

    if (busyStatus === "FREE") status = "free";
    if (busyStatus === "OOF") status = "oof";
    if (e.transparency === "TRANSPARENT") status = "free";

    /* --- recurring --- */

    if (e.rrule) {

      try {

        e.rrule.options.tzid = helsinkiTZ;
        let occurrences = [];
    
        try {

          e.rrule.options.tzid = helsinkiTZ;

          occurrences = e.rrule.between(todayStart, todayEnd, true);

        } catch (err) {
          console.log("RRULE FAIL", e.summary);
        }

        /* ===== FALLBACK (tärkein osa) ===== */

        if (!occurrences || occurrences.length === 0) {

          // tarkistetaan käsin osuuko event tähän päivään

          const startLocal = toLocal(e.start);

          /* ===== OIKEA FALLBACK ===== */

          const startLocal = toLocal(e.start);

          /* haetaan RRULE weekdayt */
          const byweekday = e.rrule?.options?.byweekday;

          /* jos ei ole määritelty → käytä start-päivää */
          let matchesWeekday = false;

          if (byweekday && byweekday.length > 0) {

            matchesWeekday = byweekday.some(d => {

              // node-ical weekday voi olla numero tai objekti
              const weekday =
                typeof d === "number"
                  ? d
                  : d.weekday;

              return weekday === today.getDay();
            });

          } else {

            // fallback: sama weekday kuin alkuperäinen event
            matchesWeekday = startLocal.getDay() === today.getDay();
          }

          if (matchesWeekday) {

            const occ = new Date(today);

            occ.setHours(
              startLocal.getHours(),
              startLocal.getMinutes(),
              0, 0
            );

            occurrences = [occ];
          }
  
        }

        for (const occ of occurrences) {

          const key = dateKey(occ);

          /* EXDATE */
          if (e.exdate && Object.values(e.exdate).some(d => dateKey(d) === key)) continue;

          /* override */
          if (overrides[key]) {

            const o = overrides[key];
            if (o.summary?.includes("¤")) continue;

            events.push({
              summary: o.summary,
              start: toLocal(o.start),
              end: toLocal(o.end),
              isAllDay: o.datetype === "date",
              status
            });

            continue;
          }

          const duration = e.end - e.start;

          const start = toLocal(occ);
          const end = toLocal(new Date(occ.getTime() + duration));

          if (e.summary?.includes("¤")) continue;

          events.push({
            summary: e.summary,
            start,
            end,
            isAllDay: e.datetype === "date",
            status
          });

        }

      } catch(err) {
        console.log("RRULE FAIL", e.summary);
      }

    }

    /* --- single event --- */

    else {

      const start = toLocal(e.start);

      if (start >= todayStart && start <= todayEnd) {

        if (e.summary?.includes("¤")) continue;

        events.push({
          summary: e.summary,
          start,
          end: toLocal(e.end),
          isAllDay: e.datetype === "date",
          status
        });

      }
    }
  }

  /* --- järjestys --- */

  events.sort((a,b)=>a.start-b.start);

  const allDayEvents = events.filter(e => e.isAllDay);
  const timedEvents = events.filter(e => !e.isAllDay);

  /* ================= OVERLAP ================= */

  timedEvents.forEach(e => { e.column=0; e.columns=1; });

  for (let i=0;i<timedEvents.length;i++) {

    const overlaps = timedEvents.filter(a =>
      timedEvents[i].start < a.end &&
      a.start < timedEvents[i].end
    );

    overlaps.forEach((ev, idx) => {
      ev.columns = Math.max(ev.columns, overlaps.length);
      ev.column = idx;
    });
  }

  /* ================= RENDER ================= */

  const eventsHtml = timedEvents.map(e => {

    const startMinutes =
      (e.start.getHours()-startHour)*60 + e.start.getMinutes();

    const endMinutes =
      (e.end.getHours()-startHour)*60 + e.end.getMinutes();

    if (endMinutes <= 0) return "";

    const top = (startMinutes/60)*pixelsPerHour;
    const height = Math.max(18, ((endMinutes-startMinutes)/60)*pixelsPerHour);

    const width = 100/e.columns;
    const left = e.column*width;

    const startTime = e.start.toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"});
    const endTime = e.end.toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"});

    const duration = endMinutes-startMinutes;

    const content = duration <= 30
      ? `<div class="short"><span class="time">${startTime}</span><span>${e.summary}</span></div>`
      : `<div class="time">${startTime}–${endTime}</div><div>${e.summary}</div>`;

    return `
      <div class="event ${e.status}"
        style="top:${top}px;height:${height}px;left:${left}%;width:${width}%;">
        ${content}
      </div>
    `;
  }).join("");

  const hoursHtml = Array.from({length:(endHour-startHour)+1},(_,i)=>
    `<div class="hour" style="top:${i*pixelsPerHour}px;">${startHour+i}</div>`
  ).join("");

  const weekdays = ["sunnuntai","maanantai","tiistai","keskiviikko","torstai","perjantai","lauantai"];

  const header = `${weekdays[today.getDay()]} ${today.getDate()}.${today.getMonth()+1}.`;

  /* ================= HTML ================= */

  res.setHeader("Content-Type","text/html");

  res.send(`
  <html>
  <head>
  <style>
    body { width:800px;height:480px;margin:0;font-family:sans-serif;display:flex;}
    .left { width:35%;border-right:3px solid #000;display:flex;flex-direction:column;}
    .weather { background:#AAA;padding:8px;height:120px;border-bottom:2px solid #555;}
    .rss { padding:10px;flex:1;font-size:13px;white-space:pre-line;}
    .right { flex:1;padding:15px;}
    h1 { text-align:center;font-size:27px;}

    .wrapper { display:flex;}
    .hours { width:40px;position:relative;height:${timelineHeight}px;}
    .hour { position:absolute;right:5px;font-size:14px;color:#555;}
    .timeline { flex:1;position:relative;border-left:3px solid #000;border-right:3px solid #000;height:${timelineHeight}px;}
    .timeline::before {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      height: 100%;
      background-image:
        repeating-linear-gradient(
          to bottom,
          #AAAAAA 0px,
          #AAAAAA 1px,
          transparent 1px,
          transparent 40px
        );
    }

    .event { position:absolute;border:2px solid #000;padding:4px;font-size:12px;box-sizing:border-box;}
    .event.busy { background:#555;color:#fff;}
    .event.free { border:2px dashed #555;}
    .event.oof { background:#000;color:#fff;}

    .short { display:flex;gap:6px;align-items:center;}
    .time { font-size:12px;}
  </style>
  </head>

  <body>

    <div class="left">
      <div class="weather">
        <div>${weather.name}</div>
        <img src="${iconUrl}" width="70"/>
        <div>${Math.round(weather.main.temp)}°C</div>
        <div>${weatherDescription}</div>
      </div>

      <div class="rss">
        <h2>Ruokalista</h2>
        ${rssItems.join("")}
      </div>
    </div>

    <div class="right">
      <h1>${header}</h1>

      ${allDayEvents.map(e=>`<div class="allday">${e.summary}</div>`).join("")}

      <div class="wrapper">
        <div class="hours">${hoursHtml}</div>
        <div class="timeline">${eventsHtml}</div>
      </div>
    </div>

  </body>
  </html>
  `);
};
