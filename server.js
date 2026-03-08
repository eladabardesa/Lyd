const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ── Supabase ────────────────────────────────────────────
// Replace these with your actual Supabase project values.
const SUPABASE_URL = 'https://ibojpbedaxyekuevyxvj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_KEY'] || '';

let supabase = null;
if (SUPABASE_SERVICE_KEY) {
  try { supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY); }
  catch (e) { console.error('Supabase init error:', e.message); }
}
if (!supabase) console.warn('Supabase not configured — pin submissions disabled');

// ── Copenhagen district bounding boxes ──────────────────
const DISTRICTS = [
  { name: 'Indre By',        latMin: 55.670, latMax: 55.685, lngMin: 12.555, lngMax: 12.590 },
  { name: 'Vesterbro',       latMin: 55.662, latMax: 55.676, lngMin: 12.530, lngMax: 12.560 },
  { name: 'Nørrebro',        latMin: 55.685, latMax: 55.710, lngMin: 12.530, lngMax: 12.565 },
  { name: 'Østerbro',        latMin: 55.690, latMax: 55.720, lngMin: 12.560, lngMax: 12.600 },
  { name: 'Frederiksberg',   latMin: 55.668, latMax: 55.688, lngMin: 12.500, lngMax: 12.535 },
  { name: 'Christianshavn',  latMin: 55.665, latMax: 55.678, lngMin: 12.580, lngMax: 12.605 },
  { name: 'Amager',          latMin: 55.630, latMax: 55.665, lngMin: 12.570, lngMax: 12.630 },
  { name: 'Valby',           latMin: 55.650, latMax: 55.668, lngMin: 12.495, lngMax: 12.535 },
  { name: 'Brønshøj',        latMin: 55.700, latMax: 55.730, lngMin: 12.490, lngMax: 12.530 },
  { name: 'Vanløse',         latMin: 55.670, latMax: 55.695, lngMin: 12.480, lngMax: 12.510 },
  { name: 'Sydhavn',         latMin: 55.645, latMax: 55.668, lngMin: 12.535, lngMax: 12.575 },
];

function assignNeighborhood(lat, lng) {
  for (const d of DISTRICTS) {
    if (lat >= d.latMin && lat <= d.latMax && lng >= d.lngMin && lng <= d.lngMax) {
      return d.name;
    }
  }
  return 'Copenhagen';
}

// ── POST /api/pins — create a new pin ───────────────────
app.post('/api/pins', async (req, res) => {
  console.log('POST /api/pins', JSON.stringify(req.body).slice(0, 200));

  if (!supabase) {
    console.error('supabase client is null — SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'set' : 'NOT SET');
    return res.status(503).json({ error: 'Server not configured — missing database key' });
  }

  const { lat, lng, song, artist, source, url, note, genre, privacy_radius } = req.body;

  if (!lat || !lng || !song) {
    return res.status(400).json({ error: 'lat, lng, and song are required' });
  }

  const neighborhood = assignNeighborhood(lat, lng);

  const row = {
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    song,
    artist: artist || null,
    source: source || null,
    url: url || null,
    note: note || null,
    genre: genre || null,
    neighborhood,
    privacy_radius: privacy_radius != null ? parseInt(privacy_radius) : 300,
  };

  const { data, error } = await supabase.from('pins').insert([row]).select();

  if (error) {
    console.error('Supabase insert error:', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data[0]);
});

// ── oEmbed metadata proxy ────────────────────────────────
const OEMBED_ENDPOINTS = {
  'open.spotify.com':  url => `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
  'youtube.com':       url => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  'youtu.be':          url => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  'soundcloud.com':    url => `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`,
};

app.get('/api/oembed', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url param required' });

  try {
    const host = new URL(url).hostname.replace('www.', '');
    const matchKey = Object.keys(OEMBED_ENDPOINTS).find(k => host.includes(k));
    if (!matchKey) return res.json({ title: null, artist: null });

    const oembedUrl = OEMBED_ENDPOINTS[matchKey](url);
    const resp = await fetch(oembedUrl);
    if (!resp.ok) return res.json({ title: null, artist: null });

    const data = await resp.json();
    let title = data.title || null;
    let artist = data.author_name || null;
    let thumbnail = data.thumbnail_url || null;

    if (title && artist && title.includes(' - ')) {
      const parts = title.split(' - ');
      if (parts.length === 2) { artist = parts[0].trim(); title = parts[1].trim(); }
    }
    if (title && title.includes(' by ')) {
      const parts = title.split(' by ');
      if (parts.length === 2) { title = parts[0].trim(); artist = artist || parts[1].trim(); }
    }

    res.json({ title, artist, thumbnail });
  } catch (e) {
    console.error('oEmbed error:', e.message);
    res.json({ title: null, artist: null });
  }
});

// ── Health check ────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  ok: true,
  supabase: supabase ? 'connected' : 'not configured',
  keySet: !!SUPABASE_SERVICE_KEY,
  keyLength: SUPABASE_SERVICE_KEY.length,
}));

// ── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Lyd server listening on 0.0.0.0:${PORT}`));
