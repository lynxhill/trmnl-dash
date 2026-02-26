export default async function handler(req, res) {

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

  const rawDescription = weather.weather[0].description.toLowerCase();

  const wordMap = {
    light: "heikkoa",
    moderate: "kohtalaista",
    heavy: "voimakasta",
    very: "erittäin",
    clear: "selkeää",
    clouds: "pilvistä",
    cloud: "pilveä",
    rain: "sadetta",
    drizzle: "tihkusadetta",
    thunderstorm: "ukkosta",
    snow: "lumisadetta",
    mist: "sumua",
    fog: "sumua",
    haze: "utua",
    smoke: "savua",
    dust: "pölyä",
    sand: "hiekkaa",
    ash: "tuhkaa",
    squall: "puuskatuulta",
    tornado: "tornado",
    broken: "ajoittaista",
    scattered: "hajanaista",
    few: "vähän",
    overcast: "pilvistä",
    and: "ja"
  };

  function translateWeather(desc) {
    return desc
      .split(/[\s,]+/)
      .map(word => wordMap[word] || word)
      .join(" ");
  }

  const weatherDescription = translateWeather(rawDescription);

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
  const eventBlocks = [...icsText.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)];

  function parseICSDate(raw) {
    if (!raw) return null;
    const year = raw.substring(0,4);
    const month = raw.substring(4,6);
    const day = raw.substring(6,8);
    const hour = raw.length > 8 ? raw.substring(9,11) : "00";
    const min = raw.length > 8 ? raw.substring(11,13) : "00";
    return new Date(`${year}-${month}-${day}T${hour}:${min}:00`);
  }

  const today = new Date();

  const weekdays = ["sunnuntai","maanantai","tiistai","keskiviikko","torstai","perjantai","lauantai"];
  const weekdayName = weekdays[today.getDay()];
  const header = `${weekdayName} ${today.getDate()}.${today.getMonth()+1}.`;

  const events = eventBlocks.map(block => {
    const summary = block[1].match(/SUMMARY:(.*)/)?.[1] ?? "";
    const dtStartRaw = block[1].match(/DTSTART.*:(.*)/)?.[1];
    const dtEndRaw = block[1].match(/DTEND.*:(.*)/)?.[1];
    const start = parseICSDate(dtStartRaw);
    const end = parseICSDate(dtEndRaw);
    return { summary, start, end };
  }).filter(e =>
    e.start &&
    e.start.toDateString() === today.toDateString()
  ).sort((a,b) => a.start - b.start);

  const startHour = 7;
  const endHour = 18;
  const pixelsPerHour = 35;
  const timelineHeight = (endHour - startHour) * pixelsPerHour;

  let nowLine = "";
  const now = new Date();
  if (
    now.getHours() >= startHour &&
    now.getHours() < endHour &&
    now.toDateString() === today.toDateString()
  ) {
    const minutesFromStart =
      (now.getHours() - startHour) * 60 + now.getMinutes();
    const top = (minutesFromStart / 60) * pixelsPerHour;
    nowLine = `<div class="now" style="top:${top}px;"></div>`;
  }

  const eventsHtml = events.map(e => {
    const startMinutes =
      (e.start.getHours() - startHour) * 60 + e.start.getMinutes();
    const endMinutes =
      (e.end.getHours() - startHour) * 60 + e.end.getMinutes();
    const top = (startMinutes / 60) * pixelsPerHour;
    const height = Math.max(18, ((endMinutes - startMinutes) / 60) * pixelsPerHour);
    const startTime = e.start.toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"});
    const endTime = e.end.toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"});

    return `
      <div class="event" style="top:${top}px;height:${height}px;">
        <div class="time">${startTime}–${endTime}</div>
        ${e.summary}
      </div>
    `;
  }).join("");

  const hoursHtml = Array.from({length: (endHour-startHour)+1}, (_,i) => {
    const hour = startHour + i;
    return `<div class="hour" style="top:${i * pixelsPerHour}px;">${hour}</div>`;
  }).join("");

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

    /* LEFT SIDE */

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

    .city {
      font-size: 14px;
      text-align: left;
    }

    .weather-row {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .weather img {
      width: 70px;
      margin-right: 10px;
    }

    .temp {
      font-size: 37px;
      font-weight: bold;
    }

    .desc {
      font-size: 18px;
      text-align: center;
    }

    .rss {
      padding: 10px;
      flex: 1;
      font-size: 14px;
      white-space: pre-line;
      overflow: hidden;
    }

    .rss h2 {
      margin: 0 0 6px 0;
      font-size: 15px;
    }

    /* RIGHT SIDE */

    .right {
      flex: 1;
      padding: 15px;
    }

    h1 {
      margin: 0 0 10px 0;
      font-size: 27px;
      text-transform: capitalize;
    }

    .wrapper {
      display: flex;
    }

    .hours {
      width: 40px;
      position: relative;
      height: ${timelineHeight}px;
    }

    .hour {
      position: absolute;
      right: 5px;
      font-size: 12px;
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
      left: 6px;
      right: 6px;
      background: #555555;
      color: #FFFFFF;
      border: 2px solid #000000;
      padding: 4px;
      font-size: 14px;
      overflow: hidden;
    }

    .time {
      font-size: 11px;
    }

    .now {
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: #000000;
    }

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
      <div class="wrapper">
        <div class="hours">${hoursHtml}</div>
        <div class="timeline">
          ${eventsHtml}
          ${nowLine}
        </div>
      </div>
    </div>

  </body>
  </html>
  `);
}
