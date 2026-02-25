// Weather Overlay Plugin — fetches Open-Meteo data and broadcasts to clients
let timer = null;
let lastWeather = null;

export default {
  async activate(ctx) {
    ctx.log('Weather overlay activating...');
    const config = ctx.getConfig();
    const interval = (config.refreshInterval || 300) * 1000;

    // Create table for weather history
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS weather_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        temperature REAL, humidity REAL, wind_speed REAL, wind_direction REAL,
        pressure REAL, cloud_cover REAL, precipitation REAL,
        weather_code INTEGER, timestamp INTEGER
      )
    `);

    const fetchWeather = async () => {
      try {
        const locationService = ctx.getService('location');
        const obs = locationService ? locationService.getObserver() : { latitude: 51.5, longitude: -0.1 };

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${obs.latitude}&longitude=${obs.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,precipitation,weather_code&timezone=auto`;
        const resp = await fetch(url);
        if (!resp.ok) return;

        const data = await resp.json();
        const current = data.current;

        lastWeather = {
          temperature: current.temperature_2m,
          humidity: current.relative_humidity_2m,
          windSpeed: current.wind_speed_10m,
          windDirection: current.wind_direction_10m,
          pressure: current.surface_pressure,
          cloudCover: current.cloud_cover,
          precipitation: current.precipitation,
          weatherCode: current.weather_code,
          timestamp: Date.now(),
          location: { lat: obs.latitude, lon: obs.longitude },
        };

        // Store in history
        ctx.db.run(
          `INSERT INTO weather_history (temperature, humidity, wind_speed, wind_direction, pressure, cloud_cover, precipitation, weather_code, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          current.temperature_2m, current.relative_humidity_2m, current.wind_speed_10m,
          current.wind_direction_10m, current.surface_pressure, current.cloud_cover,
          current.precipitation, current.weather_code, Date.now()
        );

        ctx.broadcast({ type: 'weather_update', weather: lastWeather });
        ctx.log(`Weather: ${current.temperature_2m}°C, ${current.wind_speed_10m} km/h wind, ${current.cloud_cover}% cloud`);
      } catch (err) {
        ctx.log(`Weather fetch error: ${err.message}`);
      }
    };

    // Register routes
    ctx.registerRoute('get', '/current', (_req, res) => {
      res.json(lastWeather || { error: 'No weather data yet' });
    });

    ctx.registerRoute('get', '/history', (req, res) => {
      const limit = parseInt(req.query.limit) || 48;
      const rows = ctx.db.all(
        'SELECT * FROM weather_history ORDER BY timestamp DESC LIMIT ?', limit
      );
      res.json(rows);
    });

    // Initial fetch + timer
    await fetchWeather();
    timer = setInterval(fetchWeather, interval);
    ctx.log('Weather overlay active');
  },

  deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
  },
};
