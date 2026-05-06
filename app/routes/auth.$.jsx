// =============================================================
// Shopify OAuth callback / install handler
// File location:  /app/routes/auth.$.jsx
//
// Free-tier rule: the first 50 installed stores get
// plan_type = 'early_adopter_free'; subsequent stores = 'standard'.
// =============================================================
import { authenticate } from "../shopify.server";
import { supabaseAdmin } from "../utils/supabase.server";

export const loader = async ({ request }) => {
  // Shopify Remix template: this completes OAuth & writes the session.
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Has this shop already been recorded?
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("shops")
    .select("shop_domain, plan_type")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (lookupErr) {
    console.error("[auth] shop lookup failed", lookupErr);
  }

  if (!existing) {
    // Count current installs to decide the plan.
    const { count, error: countErr } = await supabaseAdmin
      .from("shops")
      .select("shop_domain", { count: "exact", head: true });

    if (countErr) {
      console.error("[auth] shop count failed", countErr);
    }

    const planType = (count ?? 0) < 50 ? "early_adopter_free" : "standard";

    const { error: insertErr } = await supabaseAdmin.from("shops").insert({
      shop_domain: shopDomain,
      plan_type: planType,
    });

    if (insertErr) {
      console.error("[auth] shop insert failed", insertErr);
    } else {
      console.log(
        `[auth] Registered ${shopDomain} as ${planType} (install #${(count ?? 0) + 1})`
      );
    }
  }

  // Hand control back to Shopify's auth flow (redirect to /app).
  return null;
};
