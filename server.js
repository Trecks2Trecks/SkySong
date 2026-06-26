const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

// london bounding box (defaults)
const DEFAULT_BBOX = { lamin: 51.28, lamax: 51.72, lomin: -0.55, lomax: 0.35 };

// derive adsb.lol centre + radius from bbox
function bboxToCircle(lamin, lamax, lomin, lomax) {
  const lat = (lamin + lamax) / 2;
  const lon = (lomin + lomax) / 2;
  // rough km radius from bbox
  const dLat = (lamax - lamin) / 2 * 111;
  const dLon = (lomax - lomin) / 2 * 111 * Math.cos(lat * Math.PI / 180);
  const dist = Math.max(10, Math.ceil(Math.sqrt(dLat * dLat + dLon * dLon)));
  return { lat, lon, dist };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/flights', async (req, res) => {
  const lamin = !isNaN(parseFloat(req.query.lamin)) ? parseFloat(req.query.lamin) : DEFAULT_BBOX.lamin;
  const lamax = !isNaN(parseFloat(req.query.lamax)) ? parseFloat(req.query.lamax) : DEFAULT_BBOX.lamax;
  const lomin = !isNaN(parseFloat(req.query.lomin)) ? parseFloat(req.query.lomin) : DEFAULT_BBOX.lomin;
  const lomax = !isNaN(parseFloat(req.query.lomax)) ? parseFloat(req.query.lomax) : DEFAULT_BBOX.lomax;

  console.log(`Fetching bbox: lamin=${lamin} lamax=${lamax} lomin=${lomin} lomax=${lomax}`);

  const BBOX = { lamin, lamax, lomin, lomax };
  const { lat, lon, dist } = bboxToCircle(lamin, lamax, lomin, lomax);
  const ADSBLOL_URL = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`;

  console.log(`adsb.lol URL: ${ADSBLOL_URL}`);
  try {
    const response = await fetch(ADSBLOL_URL, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`adsb.lol returned HTTP ${response.status}: ${body}`);
    }

    const data = await response.json();
    const aircraft = data.ac || [];

    // filter to bounding box and convert to states array
    const states = aircraft
      .filter(a =>
        a.lat != null && a.lon != null &&
        a.lat >= BBOX.lamin && a.lat <= BBOX.lamax &&
        a.lon >= BBOX.lomin && a.lon <= BBOX.lomax
      )
      .map(a => [
        a.hex,                          // 1 ICAO hex
        (a.flight ?? 'Unknown').trim(), // 2 callsign
        null,                            // 3
        null,                            // 4
        null,                            // 5
        a.lon,                          // 6 longitude
        a.lat,                          // 7 latitude
        (a.alt_geom ?? a.alt_baro ?? 0) * 0.3048, // 8 altitude to metres (adsb.lol gives feet)
        null,                           // 9
        (a.gs ?? 0) * 0.5144,          // 10 ground speed to m/s (adsb.lol gives knots)
        a.track ?? 0,                   // 11 heading degrees
        (a.baro_rate ?? 0) * 0.00508,  // 12 vertical rate to m/s (adsb.lol gives ft/min)
        null,                           // 13
        null,                           // 14
        a.t                             // 15 aircraft type
      ]);

    res.json({ states });

  } catch (err) {
    console.error('adsb.lol fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});