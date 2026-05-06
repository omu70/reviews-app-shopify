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
    author_name,
    rating,
    content,
    is_verified = true,
  } = body || {};

  if (!shop_domain || !product_id || !author_name || !rating || !content) {
    return respond({ error: "Missing required fields" }, { status: 400 });
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

  const { data, error } = await supabaseAdmin
    .from("reviews")
    .insert({
      shop_domain,
      product_id: String(product_id),
      author_name: String(author_name).slice(0, 80),
      author_initials: initials || "AN",
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
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "12", 10)));

  if (!shop || !productId) {
    return respond({ error: "shop and productId are required" }, { status: 400 });
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Paginated rows
  const rowsP = supabaseAdmin
    .from("reviews")
    .select(
      "id, author_name, author_initials, is_verified, rating, content, created_at",
      { count: "exact" }
    )
    .eq("shop_domain", shop)
    .eq("product_id", productId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .range(from, to);

  // Aggregate rating across ALL approved reviews for this product
  const aggP = supabaseAdmin
    .from("reviews")
    .select("rating")
    .eq("shop_domain", shop)
    .eq("product_id", productId)
    .eq("status", "approved");

  const [rowsRes, aggRes] = await Promise.all([rowsP, aggP]);

  if (rowsRes.error) {
    console.error("[api.reviews GET rows]", rowsRes.error);
    return respond({ error: "DB error" }, { status: 500 });
  }
  if (aggRes.error) {
    console.error("[api.reviews GET agg]", aggRes.error);
    return respond({ error: "DB error" }, { status: 500 });
  }

  const total = rowsRes.count ?? 0;
  const ratings = aggRes.data || [];
  const totalRatings = ratings.length;
  const average =
    totalRatings === 0
      ? 0
      : Number(
          (ratings.reduce((s, r) => s + r.rating, 0) / totalRatings).toFixed(1)
        );

  return respond({
    reviews: rowsRes.data || [],
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    average,
    totalRatings,
  });
};
