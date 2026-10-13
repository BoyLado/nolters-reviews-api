// api/reviews.js

// Kunin ang mga credentials mula sa Vercel Environment Variables
const JUDGEME_API_BASE = 'https://judge.me/api/v1';
const API_TOKEN = process.env.JUDGEME_PRIVATE_API_TOKEN;
const SHOP_DOMAIN = process.env.JUDGEME_SHOP_DOMAIN;

export default async function handler(req, res) {
  // 1. Siguraduhing GET lang ang tinatanggap
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Kunin ang mga query parameters mula sa client
  const {
    rating,
    per_page,
    page,
    product_external_id,
    include_total,
  } = req.query;

  // 3. Kung may product_external_id, i-resolve muna sa internal Judge.me ID
  let internalProductId = null;

  if (product_external_id) {
    try {
      const lookupUrl = new URL(`${JUDGEME_API_BASE}/products/-1`);
      lookupUrl.searchParams.set('shop_domain', SHOP_DOMAIN);
      lookupUrl.searchParams.set('api_token', API_TOKEN);
      lookupUrl.searchParams.set('external_id', product_external_id);

      const lookupRes = await fetch(lookupUrl.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Api-Token': API_TOKEN,
        },
      });

      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        // Ang /products/-1 response ay naglalaman ng product object na may internal "id"
        if (lookupData && lookupData.product && lookupData.product.id) {
          internalProductId = lookupData.product.id;
        } else if (lookupData && lookupData.id) {
          internalProductId = lookupData.id;
        }
      } else {
        console.warn('Judge.me product lookup failed with status:', lookupRes.status);
      }
    } catch (lookupErr) {
      console.warn('Judge.me product lookup error:', lookupErr);
      // Hindi critical — ituloy pa rin at mag-fallback sa store reviews
    }
  }

  // 4. I-set up ang URL para sa Judge.me API /reviews
  const url = new URL(`${JUDGEME_API_BASE}/reviews`);

  // Required parameters
  url.searchParams.set('shop_domain', SHOP_DOMAIN);
  url.searchParams.set('api_token', API_TOKEN);

  // Optional parameters
  if (rating) url.searchParams.set('rating', rating);
  if (per_page) url.searchParams.set('per_page', per_page);
  if (page) url.searchParams.set('page', page);
  // Gamitin ang internal ID (hindi external) para sa /reviews
  if (internalProductId) url.searchParams.set('product_id', internalProductId);

  try {
    // 5. Tawagin ang Judge.me API /reviews
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Api-Token': API_TOKEN,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Judge.me API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Failed to fetch reviews from Judge.me',
        details: errorText,
      });
    }

    const data = await response.json();

    // 6. Optional: kunin ang total count para sa accurate pagination
    if (include_total === 'true') {
      try {
        const countUrl = new URL(`${JUDGEME_API_BASE}/reviews/count`);
        countUrl.searchParams.set('shop_domain', SHOP_DOMAIN);
        countUrl.searchParams.set('api_token', API_TOKEN);

        if (rating) countUrl.searchParams.set('rating', rating);
        if (internalProductId) countUrl.searchParams.set('product_id', internalProductId);

        const countRes = await fetch(countUrl.toString(), {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'X-Api-Token': API_TOKEN },
        });

        if (countRes.ok) {
          const countData = await countRes.json();
          if (typeof countData.count === 'number') {
            data.total_count = countData.count;
          }
        }
      } catch (countErr) {
        console.warn('Judge.me count fetch failed:', countErr);
      }
    }

    // 7. Ibalik ang data sa client
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}