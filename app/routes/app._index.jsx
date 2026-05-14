// =============================================================
// Merchant Admin Dashboard (Shopify Polaris) — v2 with filters,
// search, bulk actions, and source badges.
// File location: /app/routes/app._index.jsx
// =============================================================
import { json } from "@remix-run/node";
import { useState, useMemo } from "react";
import { useLoaderData, useFetcher, useRevalidator, Link } from "@remix-run/react";
import {
  Page, Card, IndexTable, Text, Badge, Button, ButtonGroup, EmptyState,
  Layout, Banner, useIndexResourceState, Filters, ChoiceList, InlineStack, BlockStack, Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { supabaseAdmin } from "../utils/supabase.server";

// ---------------- Loader ----------------
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [reviewsRes, shopRes] = await Promise.all([
    supabaseAdmin
      .from("reviews")
      .select("id, product_id, author_name, author_location, rating, content, status, source, image_urls, created_at")
      .eq("shop_domain", shop)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin.from("shops").select("plan_type, installed_at").eq("shop_domain", shop).maybeSingle(),
  ]);

  return json({
    shop,
    plan: shopRes.data?.plan_type ?? "standard",
    reviews: reviewsRes.data ?? [],
    error: reviewsRes.error?.message ?? null,
  });
};

// ---------------- Action ----------------
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  const ids = JSON.parse(form.get("ids") || "[]");

  if (!ids.length) return json({ ok: false, error: "No rows selected" }, { status: 400 });

  if (intent === "delete") {
    const { error } = await supabaseAdmin.from("reviews").delete().in("id", ids).eq("shop_domain", shop);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true });
  }
  if (intent === "approve") {
    const { error } = await supabaseAdmin.from("reviews").update({ status: "approved" }).in("id", ids).eq("shop_domain", shop);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true });
  }
  if (intent === "hide") {
    const { error } = await supabaseAdmin.from("reviews").update({ status: "hidden" }).in("id", ids).eq("shop_domain", shop);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true });
  }
  if (intent === "single-toggle") {
    const id = ids[0];
    const next = String(form.get("next") || "approved");
    const { error } = await supabaseAdmin.from("reviews").update({ status: next }).eq("id", id).eq("shop_domain", shop);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true });
  }
  if (intent === "single-delete") {
    const { error } = await supabaseAdmin.from("reviews").delete().eq("id", ids[0]).eq("shop_domain", shop);
    if (error) return json({ ok: false, error: error.message }, { status: 500 });
    return json({ ok: true });
  }
  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

// ---------------- Component ----------------
export default function AdminIndex() {
  const { reviews, plan, error } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState([]);
  const [sourceFilter, setSourceFilter] = useState([]);
  const [ratingFilter, setRatingFilter] = useState([]);

  const filtered = useMemo(() => {
    return reviews.filter((r) => {
      if (statusFilter.length && !statusFilter.includes(r.status)) return false;
      if (sourceFilter.length && !sourceFilter.includes(r.source)) return false;
      if (ratingFilter.length && !ratingFilter.includes(String(r.rating))) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = (r.author_name + " " + r.content + " " + r.product_id).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reviews, query, statusFilter, sourceFilter, ratingFilter]);

  const resourceName = { singular: "review", plural: "reviews" };
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(filtered);

  const submitMutation = (form) => {
    fetcher.submit(form, { method: "post" });
    setTimeout(() => { revalidator.revalidate(); clearSelection(); }, 250);
  };

  const bulk = (intent) =>
    submitMutation({ intent, ids: JSON.stringify(selectedResources) });

  const onToggle = (id, current) =>
    submitMutation({ intent: "single-toggle", ids: JSON.stringify([id]), next: current === "approved" ? "hidden" : "approved" });
  const onDelete = (id) =>
    submitMutation({ intent: "single-delete", ids: JSON.stringify([id]) });

  const statusTone = (s) => s === "approved" ? "success" : s === "pending" ? "attention" : "critical";
  const sourceTone = (s) => s === "csv_import" ? "info" : s === "manual" ? "attention" : "success";

  const promotedBulkActions = [
    { content: "Approve", onAction: () => bulk("approve") },
    { content: "Hide", onAction: () => bulk("hide") },
    { content: "Delete", onAction: () => bulk("delete"), destructive: true },
  ];

  const filters = [
    {
      key: "status", label: "Status", filter: (
        <ChoiceList
          title="Status" titleHidden allowMultiple choices={[
            { label: "Approved", value: "approved" },
            { label: "Pending", value: "pending" },
            { label: "Hidden", value: "hidden" },
          ]} selected={statusFilter} onChange={setStatusFilter}
        />
      ),
    },
    {
      key: "source", label: "Source", filter: (
        <ChoiceList
          title="Source" titleHidden allowMultiple choices={[
            { label: "Storefront", value: "storefront" },
            { label: "CSV import", value: "csv_import" },
            { label: "Manual", value: "manual" },
          ]} selected={sourceFilter} onChange={setSourceFilter}
        />
      ),
    },
    {
      key: "rating", label: "Rating", filter: (
        <ChoiceList
          title="Rating" titleHidden allowMultiple choices={[5,4,3,2,1].map((n) => ({ label: `${n} ★`, value: String(n) }))}
          selected={ratingFilter} onChange={setRatingFilter}
        />
      ),
    },
  ];

  const rowMarkup = filtered.map((r, i) => (
    <IndexTable.Row id={r.id} key={r.id} position={i} selected={selectedResources.includes(r.id)}>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">{r.product_id}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" fontWeight="semibold">{r.author_name}</Text>
          {r.author_location ? <Text as="span" variant="bodySm" tone="subdued">{r.author_location}</Text> : null}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Box maxWidth="320px">
          <Text as="span" variant="bodySm">
            {r.content.length > 120 ? r.content.slice(0, 120) + "…" : r.content}
          </Text>
        </Box>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {r.image_urls?.length ? `${r.image_urls.length} 📷` : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">{new Date(r.created_at).toLocaleDateString()}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell><Badge tone={sourceTone(r.source)}>{r.source}</Badge></IndexTable.Cell>
      <IndexTable.Cell><Badge tone={statusTone(r.status)}>{r.status}</Badge></IndexTable.Cell>
      <IndexTable.Cell>
        <ButtonGroup>
          <Button size="slim" onClick={() => onToggle(r.id, r.status)}>
            {r.status === "approved" ? "Hide" : "Approve"}
          </Button>
          <Button size="slim" tone="critical" onClick={() => onDelete(r.id)}>Delete</Button>
        </ButtonGroup>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Reviews"
      primaryAction={{ content: "Import CSV", url: "/app/import" }}
    >
      <TitleBar title="Reviews" />
      <Layout>
        {plan === "early_adopter_free" ? (
          <Layout.Section>
            <Banner tone="success" title="You're on the Early Adopter (free) plan 🎉">
              <p>Thanks for being one of our first 50 stores. All features are included at no cost.</p>
            </Banner>
          </Layout.Section>
        ) : null}

        {error ? (
          <Layout.Section>
            <Banner tone="critical" title="Could not load reviews"><p>{error}</p></Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card padding="0">
            <Box padding="300">
              <Filters
                queryValue={query}
                queryPlaceholder="Search by author, product or content"
                onQueryChange={setQuery}
                onQueryClear={() => setQuery("")}
                filters={filters}
                onClearAll={() => {
                  setStatusFilter([]); setSourceFilter([]); setRatingFilter([]); setQuery("");
                }}
              />
            </Box>
            {filtered.length === 0 ? (
              <EmptyState
                heading={reviews.length === 0 ? "No reviews yet" : "No reviews match your filters"}
                action={reviews.length === 0 ? { content: "Import CSV", url: "/app/import" } : undefined}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>{reviews.length === 0
                  ? "Import reviews from a CSV (use a Trustoo export directly), or wait for customers to submit reviews from your storefront."
                  : "Try removing a filter to see more reviews."}</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={filtered.length}
                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                promotedBulkActions={promotedBulkActions}
                headings={[
                  { title: "Product ID" },{ title: "Author" },{ title: "Rating" },{ title: "Content" },
                  { title: "Images" },{ title: "Date" },{ title: "Source" },{ title: "Status" },{ title: "Actions" },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="200">
            <InlineStack gap="200">
              <Text as="span" variant="bodySm" tone="subdued">Plan: <strong>{plan}</strong></Text>
              <Text as="span" variant="bodySm" tone="subdued">Total reviews: <strong>{reviews.length}</strong></Text>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
