// api/product-reviews.js
//
// Kinukuha ang Judge.me reviews aggregate para sa ISANG SPECIFIC product.
// Nagbabalik ng { product_id, rating, review_count } para sa star-rating widgets.
//
// Usage:
//   GET /api/product-reviews?product_id=1234567890
//
// Response:
//   { "product_id": "1234567890", "rating": 4.6, "review_count": 27 }

// Kunin ang mga credentials mula sa Vercel Environment Variables
const JUDGEME_API_BASE = 'https://judge.me/api/v1';
const API_TOKEN = process.env.JUDGEME_PRIVATE_API_TOKEN;
const SHOP_DOMAIN = process.env.JUDGEME_SHOP_DOMAIN;
const FETCH_TIMEOUT_MS = 8000;

// Comma-separated list sa env, halimbawa: "https://store.myshopify.com,https://www.store.com"
// Fallback sa "*" kung hindi naka-set (okay lang para sa public read-only rating data).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);

// Isasauli ang tamang origin para sa CORS header
function resolveOrigin(req) {
  if (ALLOWED_ORIGINS.indexOf('*') !== -1) return '*';
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
}

// I-set up ang CORS headers
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  // 1. I-set up ang CORS at harangin ang preflight
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // 2. Siguraduhing GET lang ang tinatanggap
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 3. Kunin ang mga query parameters mula sa client
  const { product_id, rating, per_page, page } = req.query;

  // 4. I-validate ang product_id (required para sa endpoint na ito)
  if (!product_id) {
    return res.status(400).json({ error: 'Missing product_id' });
  }
  if (!/^\d+$/.test(String(product_id))) {
    return res.status(400).json({ error: 'Invalid product_id' });
  }

  // 5. Siguraduhing naka-configure ang environment variables
  if (!API_TOKEN || !SHOP_DOMAIN) {
    console.error('Missing JUDGEME_PRIVATE_API_TOKEN or JUDGEME_SHOP_DOMAIN env vars');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // 6. I-set up ang URL para sa Judge.me API
  const url = new URL(`${JUDGEME_API_BASE}/products/-1`);

  // Required parameters
  url.searchParams.set('shop_domain', SHOP_DOMAIN);
  url.searchParams.set('api_token', API_TOKEN);
  url.searchParams.set('external_id', String(product_id));

  // Optional parameters (kung ipinasa ng client)
  if (rating) url.searchParams.set('rating', rating);
  if (per_page) url.searchParams.set('per_page', per_page);
  if (page) url.searchParams.set('page', page);

  // 7. Tawagin ang Judge.me API na may timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Api-Token': API_TOKEN, // Inirerekomenda ng Judge.me
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 8. Kunin ang data at i-check ang status
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Judge.me product API error:', response.status, errorText);
      return res.status(response.status === 404 ? 404 : 502).json({
        error: 'Failed to fetch product rating from Judge.me',
        upstream_status: response.status,
      });
    }

    const data = await response.json();

    // Judge.me response shape: { product: { rating: "4.6", reviews_count: 27, ... } }
    const product = data && data.product ? data.product : null;
    const ratingValue = product ? Number(product.rating) || 0 : 0;
    const reviewCount = product ? Number(product.reviews_count) || 0 : 0;

    // 9. Ibalik ang data sa client na may cache headers
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return res.status(200).json({
      product_id: String(product_id),
      rating: ratingValue,
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