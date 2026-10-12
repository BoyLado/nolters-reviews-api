// api/product-reviews.js
//
// Fetches Judge.me reviews for a SPECIFIC product.
// Returns the aggregate rating (average) and total review count.
//
// Usage from storefront:
//   GET /api/product-reviews?product_id=1234567890
//
// Response:
//   { "rating": 4.6, "review_count": 27, "product_id": "1234567890" }

const JUDGEME_API_BASE = 'https://judge.me/api/v1';
const API_TOKEN = process.env.JUDGEME_PRIVATE_API_TOKEN;
const SHOP_DOMAIN = process.env.JUDGEME_SHOP_DOMAIN;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { product_id } = req.query;

  if (!product_id) {
    return res.status(400).json({ error: 'Missing product_id' });
  }

  // Judge.me has a dedicated "product" endpoint that returns the aggregate:
  //   GET /api/v1/products/-1?shop_domain=...&api_token=...&external_id=<shopify_product_id>
  const url = new URL(`${JUDGEME_API_BASE}/products/-1`);
  url.searchParams.set('shop_domain', SHOP_DOMAIN);
  url.searchParams.set('api_token', API_TOKEN);
  url.searchParams.set('external_id', String(product_id));

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Api-Token': API_TOKEN,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Judge.me product API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Failed to fetch product rating from Judge.me',
        details: errorText,
      });
    }

    const data = await response.json();

    // Judge.me returns: { product: { ..., rating: 4.6, reviews_count: 27 } }
    // Rating can come back as a string, so cast to Number.
    const rating = data && data.product ? Number(data.product.rating) || 0 : 0;
    const reviewCount = data && data.product ? Number(data.product.reviews_count) || 0 : 0;

    // Cache for 5 minutes at the edge; allow stale while revalidating
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    return res.status(200).json({
      product_id: String(product_id),
      rating: rating,
      review_count: reviewCount,
    });
  } catch (error) {
    console.error('Judge.me product proxy error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}