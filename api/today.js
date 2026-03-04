const ical = require("node-ical");

module.exports = async function handler(req, res) {

  const ICS_URL = process.env.ICS_URL;
  const WEATHER_KEY = process.env.WEATHER_KEY;
  const RSS_URL = process.env.RSS_URL;
  const CITY = "Pori";

  /* ================= WEATHER ================= */

  const weatherRes = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${CITY}&units=metric&appid=${WEATHER_KEY}`
  );
  const weather = await weatherRes.json();

  const iconCode = weather.weather[0].icon;
  const iconUrl = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;

  const main = weather.weather[0].main;
  const desc = weather.weather[0].description.toLowerCase();

  let weatherDescription = "";

  switch (main) {

    case "Clear":
      weatherDescription = "Selkeää";
      break;

    case "Clouds":
      if (desc.includes("few"))
        weatherDescription = "Vähän pilvistä";
      else if (desc.includes("scattered"))
        weatherDescription = "Puolipilvistä";
      else if (desc.includes("broken"))
        weatherDescription = "Pilvistä";
      else if (desc.includes("overcast"))
        weatherDescription = "Pilvistä";
      else
        weatherDescription = "Pilvistä";
      break;

    case "Rain":
      if (desc.includes("light"))
        weatherDescription = "Heikkoa sadetta";
      else if (desc.includes("heavy"))
        weatherDescription = "Voimakasta sadetta";
      else
        weatherDescription = "Sadetta";
      break;

    case "Drizzle":
      weatherDescription = "Tihkusadetta";
      break;

    case "Thunderstorm":
      weatherDescription = "Ukkosta";
      break;
  
    case "Snow":
      if (desc.includes("light"))
        weatherDescription = "Heikkoa lumisadetta";
      else
        weatherDescription = "Lumisadetta";
      break;

    case "Mist":
    case "Fog":
    case "Haze":
      weatherDescription = "Sumua";
      break;

    default:
      weatherDescription = desc; // fallback
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

const helsinkiTZ = "Europe/Helsinki";

const now = new Date();
const today = new Date(
  now.toLocaleString("en-US", { timeZone: helsinkiTZ })
);

const startHour = 8;
const endHour = 17;

const todayStart = new Date(today);
todayStart.setHours(0,0,0,0);

const todayEnd = new Date(today);
todayEnd.setHours(23,59,59,999);

const weekdays = [
  "sunnuntai","maanantai","tiistai",
  "keskiviikko","torstai","perjantai","lauantai"
];

const header =
  weekdays[today.getDay()] +
  " " +
  today.getDate() +
  "." +
  (today.getMonth()+1) +
  ".";
  
let events = [];

for (const k in data) {

  const e = data[k];
  if (e.type !== "VEVENT") continue;

  console.log(
    "EVENT:",
    e.summary,
    "STATUS:", e.status,
    "TRANSP:", e.transparency,
    "BUSYSTATUS:", e["x-microsoft-cdo-busystatus"]
  );
  
  let status = "free";
 
  if (e["x-microsoft-cdo-busystatus"] === "TENTATIVE") {
    status = "tentative";
  }

  if (
    e.status === "BUSY") {
    status = "busy";
  }

  if (
    e["x-microsoft-cdo-busystatus"] === "OOF"
  ) {
    status = "oof";
  }
  
  if (e.transparency === "OPAQUE") {
  status = "busy";
  }

  // recurring events
  if (e.rrule) {

    e.rrule.options.tzid = helsinkiTZ;
    const occurrences = e.rrule.between(todayStart, todayEnd, true);

    for (const occ of occurrences) {

      const duration = e.end - e.start;

      const start = new Date(
        occ.toLocaleString("en-US", { timeZone: helsinkiTZ })
      );

      const end = new Date(
        new Date(occ.getTime() + duration)
          .toLocaleString("en-US", { timeZone: helsinkiTZ })
      );

      events.push({
        summary: e.summary,
        start,
        end,
        isAllDay: e.datetype === "date",
        status
      });

    }

  } else {

    if (e.start >= todayStart && e.start <= todayEnd) {

      events.push({
        summary: e.summary,
        start: e.start,
        end: e.end,
        isAllDay: e.datetype === "date",
        status
      });

    }

  }

}

events.sort((a,b) => a.start - b.start);

const allDayEvents = events.filter(e => e.isAllDay);
const timedEvents = events.filter(e => !e.isAllDay);

/* ===== render timed events ===== */

const pixelsPerHour = 40;
const timelineHeight = (endHour - startHour) * pixelsPerHour;

/* ===== overlap layout ===== */

timedEvents.forEach(e => {
  e.column = 0;
  e.columns = 1;
});

for (let i = 0; i < timedEvents.length; i++) {

  const overlaps = [];

  for (let j = 0; j < timedEvents.length; j++) {

    const a = timedEvents[i];
    const b = timedEvents[j];

    if (a.start < b.end && b.start < a.end) {
      overlaps.push(b);
    }

  }

  overlaps.forEach((ev, index) => {
    ev.column = index;
    ev.columns = overlaps.length;
  });

}
  
const eventsHtml = timedEvents.map(e => {

  const startLocal = new Date(
    e.start.toLocaleString("en-US",{timeZone: helsinkiTZ})
  );

  const endLocal = new Date(
    e.end.toLocaleString("en-US",{timeZone: helsinkiTZ})
  );

  const startMinutes =
    (startLocal.getHours() - startHour) * 60 +
    startLocal.getMinutes();

  const endMinutes =
    (endLocal.getHours() - startHour) * 60 +
    endLocal.getMinutes();

  const top = (startMinutes / 60) * pixelsPerHour;
  const height = Math.max(
    18,
    ((endMinutes - startMinutes) / 60) * pixelsPerHour
  );

  const startTime = startLocal.toLocaleTimeString("fi-FI",{
    hour:"2-digit",
    minute:"2-digit"
  });

  const endTime = endLocal.toLocaleTimeString("fi-FI",{
    hour:"2-digit",
    minute:"2-digit"
  });

  const width = 100 / e.columns;
  const left = e.column * width;
  
  return `
    <div class="event ${e.status}"
         style="
         top:${top}px;
         height:${height}px;
         left:${left}%;
         width:${width}%;
         ">
         <div class="time">${startTime}–${endTime}</div>
         ${e.summary}
    </div>
  `;

}).join("");

/* ===== hour labels ===== */

const hoursHtml = Array.from(
  {length:(endHour-startHour)+1},
  (_,i) => {

    const hour = startHour+i;

    return `<div class="hour" style="top:${i*pixelsPerHour}px;">${hour}</div>`;

}).join("");

  
  /* ================= RENDER ================= */

  res.setHeader("Content-Type", "text/html");

  res.send(`
  <html>
  <head>
  <style>
    body {
      width: 800px;
      height: 480px;
      margin: 0;
      font-family: sans-serif;
      background: #FFFFFF;
      color: #000000;
      display: flex;
    }

    .left {
      width: 35%;
      border-right: 3px solid #000000;
      display: flex;
      flex-direction: column;
    }

    .weather {
      background: #AAAAAA;
      padding: 8px;
      height: 120px;
      border-bottom: 2px solid #555555;
    }

    .city { font-size: 14px; }
    .weather-row { display: flex; align-items: center; justify-content: center; }
    .weather img { width: 70px; }
    .temp { font-size: 35px; font-weight: bold; }
    .desc { font-size: 18px; text-align: center; }

    .rss {
      padding: 10px;
      flex: 1;
      font-size: 13px;
      white-space: pre-line;
      overflow: hidden;
    }

    .rss h2 { margin: 0 0 6px 0; font-size: 15px; }

    .right { flex: 1; padding: 15px; }

    h1 { margin: 0 0 8px 0; font-size: 27px; text-align: center;}

    .allday {
      margin-left: 40px;
      background: #AAAAAA;
      padding: 4px;
      margin-bottom: 6px;
      font-size: 14px;
      border-left: 3px solid #000000;
      border-right: 3px solid #000000;
    }

    .wrapper { display: flex; }

    .hours {
      width: 40px;
      position: relative;
      height: ${timelineHeight}px;
    }

    .hour {
      position: absolute;
      right: 5px;
      font-size: 14px;
      color: #555555;
      transform: translateY(-6px);
    }

    .timeline {
      flex: 1;
      position: relative;
      border-left: 3px solid #000000;
      border-right: 3px solid #000000;
      height: ${timelineHeight}px;
    }

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
          transparent ${pixelsPerHour}px
        );
    }


    .event {
      position: absolute;
      border: 2px solid #000000;
      padding: 4px;
      font-size: 13px;
      overflow: hidden;
      box-sizing: border-box;
    }

    .event.busy { background: #555555; color: #FFFFFF; }
    .event.free { background: #FFFFFF; color: #000000; border: 2px dashed #555555; }
    .event.tentative { background: #FFFFFF; color: #000000; border: 2px dashed #555555; }
    .event.oof { background: #000000; color: #FFFFFF; }

    .time { font-size: 12px; }

  </style>
  </head>
  <body>

    <div class="left">
      <div class="weather">
        <div class="city">${weather.name}</div>
        <div class="weather-row">
          <img src="${iconUrl}" />
          <div class="temp">${Math.round(weather.main.temp)}°C</div>
        </div>
        <div class="desc">${weatherDescription}</div>
      </div>

      <div class="rss">
        <h2>Ruokalista</h2>
        ${rssItems.join("")}
      </div>
    </div>

    <div class="right">
      <h1>${header}</h1>

      ${allDayEvents.map(e =>
        `<div class="allday">${e.summary}</div>`
      ).join("")}

      <div class="wrapper">
        <div class="hours">${hoursHtml}</div>
        <div class="timeline">
          ${eventsHtml}
        </div>
      </div>
    </div>

  </body>
  </html>
  `);
}


