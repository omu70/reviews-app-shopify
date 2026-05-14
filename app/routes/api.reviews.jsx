// =============================================================
// Public storefront API for reviews
// File location:  /app/routes/api.reviews.jsx
//
// GET  /api/reviews?shop=<domain>&productId=<id>&page=1&limit=12
// POST /api/reviews   (JSON body)
// OPTIONS — CORS preflight
// =============================================================
import { json } from "@remix-run/node";
import { supabaseAdmin, corsHeaders } from "../utils/supabase.server";

const respond = (body, init = {}) =>
  json(body, {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers || {}) },
  });

// ---------- CORS preflight ----------
export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    shop_domain,
    product_id,
    product_handle,
    author_name,
    author_location,
    rating,
    content,
    is_verified = true,
  } = body || {};

  if (!shop_domain || !author_name || !rating || !content) {
    return respond({ error: "Missing required fields" }, { status: 400 });
  }
  if (!product_id && !product_handle) {
    return respond({ error: "Missing product_id or product_handle" }, { status: 400 });
  }

  const ratingInt = parseInt(rating, 10);
  if (Number.isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    return respond({ error: "rating must be 1–5" }, { status: 400 });
  }

  const initials = author_name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Defensive: ensure shop row exists (in case install hook didn't run)
  await supabaseAdmin
    .from("shops")
    .upsert({ shop_domain }, { onConflict: "shop_domain", ignoreDuplicates: true });

  const { data, error } = await supabaseAdmin
    .from("reviews")
    .insert({
      shop_domain,
      product_id: product_id ? String(product_id) : (product_handle ? String(product_handle) : null),
      product_handle: product_handle ? String(product_handle) : null,
      author_name: String(author_name).slice(0, 80),
      author_initials: initials || "AN",
      author_location: author_location ? String(author_location).slice(0, 80) : null,
      is_verified: Boolean(is_verified),
      rating: ratingInt,
      content: String(content).slice(0, 4000),
      status: "pending", // merchant approves in admin
    })
    .select()
    .single();

  if (error) {
    console.error("[api.reviews POST]", error);
    return respond({ error: "Could not save review" }, { status: 500 });
  }

  return respond({ ok: true, review: data }, { status: 201 });
};

// ---------- GET (list + aggregates) ----------
export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const shop = url.searchParams.get("shop");
  const productId = url.searchParams.get("productId");
  const productHandle = url.searchParams.get("productHandle");
  const storeOnly = url.searchParams.get("store") === "true";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "12", 10)));

  if (!shop) {
    return respond({ error: "shop is required" }, { status: 400 });
  }
  if (!storeOnly && !productId && !productHandle) {
    return respond({ error: "Provide productId, productHandle, or store=true" }, { status: 400 });
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Helper that builds the base filter for either product- or store-scoped queries
  const SELECT_COLS = "id, title, author_name, author_initials, author_location, author_country, is_verified, is_featured, rating, content, image_urls, video_url, reply, reply_at, created_at";

  // Store-only mode: just store-wide reviews
  if (storeOnly) {
    const rowsRes = await supabaseAdmin
      .from("reviews")
      .select(SELECT_COLS, { count: "exact" })
      .eq("shop_domain", shop)
      .eq("status", "approved")
      .is("product_id", null)
      .is("product_handle", null)
      .order("is_featured", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    const aggRes = await supabaseAdmin
      .from("reviews")
      .select("rating")
      .eq("shop_domain", shop)
      .eq("status", "approved")
      .is("product_id", null)
      .is("product_handle", null);

    if (rowsRes.error || aggRes.error) {
      return respond({ error: "DB error" }, { status: 500 });
    }
    const total = rowsRes.count ?? 0;
    const ratings = aggRes.data || [];
    const totalRatings = ratings.length;
    const average = totalRatings === 0 ? 0
      : Number((ratings.reduce((s, r) => s + r.rating, 0) / totalRatings).toFixed(1));
    return respond({
      reviews: rowsRes.data || [],
      page, limit, total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      average, totalRatings,
    });
  }

  // Product page mode: merge product-specific FIRST, then store-wide
  const productKey = productHandle || productId;

  // Fetch ALL product-specific reviews + ALL store-wide (we'll merge + paginate)
  const productPromise = supabaseAdmin
    .from("reviews")
    .select(SELECT_COLS)
    .eq("shop_domain", shop)
    .eq("status", "approved")
    .or(`product_handle.eq.${productKey},product_id.eq.${productKey}`)
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false });

  const storePromise = supabaseAdmin
    .from("reviews")
    .select(SELECT_COLS)
    .eq("shop_domain", shop)
    .eq("status", "approved")
    .is("product_id", null)
    .is("product_handle", null)
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false });

  const [prodRes, storeRes] = await Promise.all([productPromise, storePromise]);
  if (prodRes.error || storeRes.error) {
    console.error("[api.reviews]", prodRes.error || storeRes.error);
    return respond({ error: "DB error" }, { status: 500 });
  }

  const productRows = prodRes.data || [];
  const storeRows = storeRes.data || [];
  // Combined: product-specific reviews first (top of feed), then store-wide
  const combined = productRows.concat(storeRows);

  const total = combined.length;
  const totalRatings = total;
  const average = total === 0 ? 0
    : Number((combined.reduce((s, r) => s + r.rating, 0) / total).toFixed(1));

  const paginated = combined.slice(from, to + 1);

  return respond({
    reviews: paginated,
    page, limit, total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    average, totalRatings,
  });
};
