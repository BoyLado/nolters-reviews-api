// api/product-reviews.js
//
// Fetches Judge.me reviews aggregate for a SPECIFIC product.
// Returns { rating, review_count, product_id } for use in star-rating widgets.
//
// Usage:
//   GET /api/product-reviews?product_id=1234567890
//
// Response:
//   { "product_id": "1234567890", "rating": 4.6, "review_count": 27 }

const JUDGEME_API_BASE = 'https://judge.me/api/v1';
const API_TOKEN = process.env.JUDGEME_PRIVATE_API_TOKEN;
const SHOP_DOMAIN = process.env.JUDGEME_SHOP_DOMAIN;
const FETCH_TIMEOUT_MS = 8000;

// Comma-separated list in env, e.g. "https://store.myshopify.com,https://www.store.com"
// Falls back to "*" if not set (fine for public read-only rating data).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);

function resolveOrigin(req) {
  if (ALLOWED_ORIGINS.indexOf('*') !== -1) return '*';
  var origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
}

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  // ---- CORS ----
  applyCors(req, res);

  // ---- Preflight ----
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // ---- Method guard ----
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---- Input validation ----
  const { product_id } = req.query;
  if (!product_id) {
    return res.status(400).json({ error: 'Missing product_id' });
  }
  if (!/^\d+$/.test(String(product_id))) {
    return res.status(400).json({ error: 'Invalid product_id' });
  }

  // ---- Env guard ----
  if (!API_TOKEN || !SHOP_DOMAIN) {
    console.error('Missing JUDGEME_PRIVATE_API_TOKEN or JUDGEME_SHOP_DOMAIN env vars');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // ---- Build Judge.me request ----
  const url = new URL(`${JUDGEME_API_BASE}/products/-1`);
  url.searchParams.set('shop_domain', SHOP_DOMAIN);
  url.searchParams.set('api_token', API_TOKEN);
  url.searchParams.set('external_id', String(product_id));

  // ---- Fetch with timeout ----
  const controller = new AbortController();
  const timeoutId = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Judge.me product API error:', response.status, errorText);
      return res.status(response.status === 404 ? 404 : 502).json({
        error: 'Failed to fetch product rating from Judge.me',
        upstream_status: response.status,
      });
    }

    const data = await response.json();

    // Judge.me: { product: { rating: "4.6", reviews_count: 27, ... } }
    const product = data && data.product ? data.product : null;
    const rating = product ? Number(product.rating) || 0 : 0;
    const reviewCount = product ? Number(product.reviews_count) || 0 : 0;

    // ---- Cache at the edge ----
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');

    return res.status(200).json({
      product_id: String(product_id),
      rating: rating,
      review_count: reviewCount,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error && error.name === 'AbortError') {
      console.error('Judge.me request timed out for product', product_id);
      return res.status(504).json({ error: 'Upstream timeout' });
    }
    console.error('Judge.me product proxy error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}