export default async function handler(req, res) {

  const ICS_URL = process.env.ICS_URL;

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

  const events = eventBlocks.map(block => {
    const summary = block[1].match(/SUMMARY:(.*)/)?.[1] ?? "";
    const dtStartRaw = block[1].match(/DTSTART.*:(.*)/)?.[1];
    const dtEndRaw = block[1].match(/DTEND.*:(.*)/)?.[1];

    const start = parseICSDate(dtStartRaw);
    const end = parseICSDate(dtEndRaw);

    const isAllDay = dtStartRaw && dtStartRaw.length === 8;

    return { summary, start, end, isAllDay };
  }).filter(e =>
    e.start &&
    e.start.getFullYear() === today.getFullYear() &&
    e.start.getMonth() === today.getMonth() &&
    e.start.getDate() === today.getDate()
  );

  const allDayEvents = events.filter(e => e.isAllDay);
  const timedEvents = events.filter(e => !e.isAllDay).sort((a,b) => a.start - b.start);

  const header = today.toLocaleDateString("fi-FI", {
    weekday: "long",
    day: "numeric",
    month: "numeric"
  });

  const startHour = 7;
  const endHour = 18;
  const totalHours = endHour - startHour;

  const pixelsPerHour = 40; // sopii TRMNL 6" korkeuteen
  const timelineHeight = totalHours * pixelsPerHour;

  // Nykyhetken viiva
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

  const eventsHtml = timedEvents.map(e => {

    const startMinutes =
      (e.start.getHours() - startHour) * 60 + e.start.getMinutes();

    const endMinutes =
      (e.end.getHours() - startHour) * 60 + e.end.getMinutes();

    const top = (startMinutes / 60) * pixelsPerHour;
    const height = Math.max(18, ((endMinutes - startMinutes) / 60) * pixelsPerHour);

    return `
      <div class="event" style="top:${top}px;height:${height}px;">
        <div class="time">
          ${e.start.toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"})}
        </div>
        ${e.summary}
      </div>
    `;
  }).join("");

  const hoursHtml = Array.from({length: totalHours + 1}, (_,i) => {
    const hour = startHour + i;
    return `
      <div class="hour" style="top:${i * pixelsPerHour}px;">
        ${hour.toString().padStart(2,"0")}
      </div>
    `;
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
      padding: 15px;
      font-family: sans-serif;
      background: #FFFFFF;
      color: #000000;
    }

    h1 {
      margin: 0 0 10px 0;
      font-size: 26px;
      text-transform: capitalize;
    }

    .allday {
      background: #AAAAAA;
      padding: 6px;
      margin-bottom: 8px;
      font-size: 13px;
    }

    .wrapper {
      display: flex;
    }

    .hours {
      width: 50px;
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
      height: ${timelineHeight}px;
      background: #FFFFFF;
    }

    .timeline::before {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
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
      left: 8px;
      right: 8px;
      background: #555555;
      color: #FFFFFF;
      padding: 4px;
      font-size: 12px;
      overflow: hidden;
    }

    .time {
      font-size: 10px;
      opacity: 0.9;
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

    <h1>${header}</h1>

    ${allDayEvents.map(e =>
      `<div class="allday">${e.summary}</div>`
    ).join("")}

    <div class="wrapper">
      <div class="hours">
        ${hoursHtml}
      </div>

      <div class="timeline">
        ${eventsHtml}
        ${nowLine}
      </div>
    </div>

  </body>
  </html>
  `);
}
