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
const SUPABASE_KEY = process.env['SUPABASE_KEY']
  || process.env['SUPABASE_SERVICE_KEY']
  || 'sb_publishable_u6NT6jO2LEmdE2KqU7wA2Q_43nF_WXj';

let supabase = null;
try { supabase = createClient(SUPABASE_URL, SUPABASE_KEY); }
catch (e) { console.error('Supabase init error:', e.message); }
if (!supabase) console.warn('Supabase client failed to initialize');

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
    return res.status(503).json({ error: 'Server not configured — Supabase client failed' });
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

    if (host.includes('open.spotify.com')) {
      return res.json(await fetchSpotifyMeta(url));
    }

    const matchKey = Object.keys(OEMBED_ENDPOINTS).find(k => host.includes(k));
    if (!matchKey) return res.json({ title: null, artist: null });

    const oembedUrl = OEMBED_ENDPOINTS[matchKey](url);
    const resp = await fetch(oembedUrl);
    if (!resp.ok) return res.json({ title: null, artist: null });

    const data = await resp.json();
    let title = data.title || null;
    let artist = data.author_name || null;
    let thumbnail = data.thumbnail_url || null;

    if (title && title.includes(' - ')) {
      const parts = title.split(' - ');
      if (parts.length >= 2) { artist = parts[0].trim(); title = parts.slice(1).join(' - ').trim(); }
    }

    res.json({ title, artist, thumbnail });
  } catch (e) {
    console.error('oEmbed error:', e.message);
    res.json({ title: null, artist: null });
  }
});

async function fetchSpotifyMeta(url) {
  try {
    const [pageResp, oembedResp] = await Promise.all([
      fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' }),
      fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`),
    ]);

    let title = null, artist = null, thumbnail = null;

    if (oembedResp.ok) {
      const oe = await oembedResp.json();
      title = oe.title || null;
      thumbnail = oe.thumbnail_url || null;
    }

    if (pageResp.ok) {
      const html = await pageResp.text();
      const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
      if (descMatch) {
        const desc = descMatch[1];
        const byMatch = desc.match(/(?:Song|Track)\s*[·•]\s*(.+?)(?:\s*[·•]|$)/);
        if (byMatch) artist = byMatch[1].trim();
      }
      if (!artist) {
        const titleMatch = html.match(/<title>(.+?)<\/title>/);
        if (titleMatch) {
          const m = titleMatch[1].match(/by\s+(.+?)\s*\|/);
          if (m) artist = m[1].trim();
        }
      }
    }

    return { title, artist, thumbnail };
  } catch (e) {
    console.error('Spotify meta error:', e.message);
    return { title: null, artist: null };
  }
}

// ── Health check ────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  ok: true,
  supabase: supabase ? 'connected' : 'not configured',
  keyPrefix: SUPABASE_KEY.slice(0, 16) + '…',
  keyLength: SUPABASE_KEY.length,
}));

// ── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Lyd server listening on 0.0.0.0:${PORT}`));
