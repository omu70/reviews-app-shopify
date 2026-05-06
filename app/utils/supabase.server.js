// =============================================================
// Supabase server-side client (service-role)
// File location:  /app/utils/supabase.server.js
// =============================================================
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  // eslint-disable-next-line no-console
  console.warn("[supabase.server] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

export const supabaseAdmin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "x-client-info": "shopify-reviews-app" } },
});

/** Reusable CORS headers for the storefront (Theme App Extension calls this API). */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Shop-Domain",
  "Access-Control-Max-Age": "86400",
};
