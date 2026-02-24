export default async function handler(req, res) {

  const ICS_URL = process.env.ICS_URL;
  const WEATHER_KEY = process.env.WEATHER_KEY;
  const CITY = "Pori";

  // Fetch weather
  const weatherRes = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${CITY}&units=metric&appid=${WEATHER_KEY}`
  );
  const weather = await weatherRes.json();

  // Fetch calendar
  const icsRes = await fetch(ICS_URL);
  const icsText = await icsRes.text();

  const events = [...icsText.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)]
    .slice(0, 3)
    .map(block => {
      const summary = block[1].match(/SUMMARY:(.*)/)?.[1] ?? "Tapahtuma";
      const dt = block[1].match(/DTSTART:(.*)/)?.[1] ?? "";
      return { summary, dt };
    });

  res.setHeader("Content-Type", "text/html");

  res.send(`
  <html>
  <body style="font-family:sans-serif; padding:40px; display:flex; justify-content:space-between;">
    <div style="width:60%;">
      <h2>Seuraavat</h2>
      ${events.map(e => `
        <div style="margin-bottom:12px;">
          <strong>${e.summary}</strong><br/>
          ${e.dt}
        </div>
      `).join("")}
    </div>

    <div style="width:35%; text-align:right;">
      <h2>${weather.name}</h2>
      <div style="font-size:48px;">
        ${Math.round(weather.main.temp)}°C
      </div>
      <div>${weather.weather[0].description}</div>
    </div>
  </body>
  </html>
  `);
}
