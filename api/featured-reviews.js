// api/featured-reviews.js
//
// Nagbabalik ng reviews na 3 to 5 stars lang.
// Ginagamit ito para sa "featured" section sa site.

const JUDGEME_API_BASE = 'https://judge.me/api/v1';
const API_TOKEN = process.env.JUDGEME_PRIVATE_API_TOKEN;
const SHOP_DOMAIN = process.env.JUDGEME_SHOP_DOMAIN;

// Minimum na rating na gusto nating ipakita
const MIN_RATING = 3;

// Helper: resolve external product id -> internal Judge.me product id
async function resolveInternalProductId(externalId) {
  if (!externalId) return null;

  try {
    const lookupUrl = new URL(`${JUDGEME_API_BASE}/products/-1`);
    lookupUrl.searchParams.set('shop_domain', SHOP_DOMAIN);
    lookupUrl.searchParams.set('external_id', externalId);

    const res = await fetch(lookupUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Api-Token': API_TOKEN,
      },
    });

    if (!res.ok) {
      console.warn('Judge.me product lookup failed:', res.status);
      return null;
    }

    const data = await res.json();
    return data?.product?.id ?? data?.id ?? null;
  } catch (err) {
    console.warn('Judge.me product lookup error:', err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { per_page, page, product_external_id, include_total } = req.query;

  // I-resolve muna ang product id kung meron
  const internalProductId = await resolveInternalProductId(product_external_id);

  const url = new URL(`${JUDGEME_API_BASE}/reviews`);
  url.searchParams.set('shop_domain', SHOP_DOMAIN);

  if (per_page) url.searchParams.set('per_page', per_page);
  if (page) url.searchParams.set('page', page);
  if (internalProductId) url.searchParams.set('product_id', internalProductId);

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
      console.error('Judge.me API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Failed to fetch reviews from Judge.me',
        details: errorText,
      });
    }

    const data = await response.json();

    // ✅ Filter: 3 to 5 stars lang
    data.reviews = (data.reviews || []).filter(
      (r) => Number(r.rating) >= MIN_RATING
    );

    // Optional total count (kabuuang count, hindi filtered)
    if (include_total === 'true') {
      try {
        const countUrl = new URL(`${JUDGEME_API_BASE}/reviews/count`);
        countUrl.searchParams.set('shop_domain', SHOP_DOMAIN);
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

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}