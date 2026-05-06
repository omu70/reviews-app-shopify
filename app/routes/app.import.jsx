// =============================================================
// CSV Import for Reviews (merchant admin)
// File location: /app/routes/app.import.jsx
//
// Accepts CSVs with the columns:
//   product_id, author_name, rating, content, is_verified (optional), image_urls (optional, comma-separated)
// =============================================================
import { json } from "@remix-run/node";
import { useState } from "react";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, Button, Banner, DropZone, List, Box, InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { supabaseAdmin } from "../utils/supabase.server";

// ------------------- Action -------------------
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const csvText = form.get("csv");
  if (!csvText || typeof csvText !== "string") {
    return json({ ok: false, error: "No CSV provided" }, { status: 400 });
  }

  // ---- naïve CSV parser (handles quoted strings) ----
  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    return json({ ok: false, error: "CSV is empty" }, { status: 400 });
  }
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const required = ["product_id", "author_name", "rating", "content"];
  for (const r of required) {
    if (!headers.includes(r)) {
      return json({ ok: false, error: `Missing column: ${r}` }, { status: 400 });
    }
  }

  const idx = (k) => headers.indexOf(k);
  const records = [];
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => !c)) continue; // skip empty
    const author_name = (r[idx("author_name")] || "").trim();
    const rating = parseInt(r[idx("rating")], 10);
    const content = (r[idx("content")] || "").trim();
    const product_id = (r[idx("product_id")] || "").trim();

    if (!author_name || !content || !product_id) {
      errors.push(`Row ${i + 1}: missing required field`);
      continue;
    }
    if (Number.isNaN(rating) || rating < 1 || rating > 5) {
      errors.push(`Row ${i + 1}: rating must be 1-5`);
      continue;
    }

    const initials = author_name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
    const verifiedRaw = idx("is_verified") >= 0 ? (r[idx("is_verified")] || "").trim().toLowerCase() : "true";
    const is_verified = ["1", "true", "yes", "y"].includes(verifiedRaw);
    const image_urls = idx("image_urls") >= 0
      ? (r[idx("image_urls")] || "").split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    records.push({
      shop_domain: shop,
      product_id,
      author_name: author_name.slice(0, 80),
      author_initials: initials || "AN",
      is_verified,
      rating,
      content: content.slice(0, 4000),
      image_urls,
      status: "approved",
      source: "csv_import",
    });
  }

  if (records.length === 0) {
    return json({ ok: false, error: "No valid rows", errors }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("reviews").insert(records);
  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  return json({ ok: true, inserted: records.length, errors });
};

function parseCSV(text) {
  const out = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

// ------------------- Component -------------------
export default function ImportPage() {
  const action = useActionData();
  const nav = useNavigation();
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");

  const handleDrop = (_d, accepted) => {
    const f = accepted[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(reader.result);
    reader.readAsText(f);
  };

  const downloadTemplate = () => {
    const tmpl = "product_id,author_name,rating,content,is_verified,image_urls\n" +
      "REPLACE_WITH_PRODUCT_ID,Your Name,5,\"Write your review here.\",true,\n";
    const blob = new Blob([tmpl], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reviews-template-blank.csv";
    a.click();
  };

  const downloadSamples = () => {
    const samples = [
      ["REPLACE_WITH_PRODUCT_ID", "Navya R.",   5, "So elegant and rustic. The craftsmanship is amazing. Bada premium feel hai aur budget me bhi. Top-notch bhai.", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Rishabh D.", 5, "Ek number decor piece hai. Bohot hi elegant look deta hai. Ekdum perfect center-piece. Macha diya!", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Jahnvi J.",  5, "Totally an aesthetic piece. The craftsmanship is amazing. Bada premium feel hai aur budget me bhi. Superb!", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Megha K.",   5, "Yaar, this product is fab! Value for money deal hai. Bina soche le lo, the premium design is unmatchable. A1 quality.", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Myra B.",    5, "Such a classy look. Bohot hi elegant look deta hai. Ekdum perfect center-piece. Top-notch bhai.", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Shaurya M.", 5, "Totally loved the aesthetic vibe. Perfect size, na zyada bada na chota. Plus gorgeous aesthetics. Jhakaas!", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Neha C.",    5, "Bohot badiya laga mujhe. Value for money deal hai. Bina soche le lo, the premium design is unmatchable. Chha gaye!", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Aarav P.",   4, "Quality is solid, packaging was neat. Slightly smaller than I expected from photos but still looks great in my room.", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Diya K.",    5, "Kamaal ki finish hai. Sturdy hai aur material bohot premium lagta hai. Best purchase. Ekdum kadak.", true, ""],
      ["REPLACE_WITH_PRODUCT_ID", "Ishaan T.",  4, "Looks really nice in person. Delivery was quick. Would have given 5 stars if assembly instructions were clearer.", true, ""],
    ];
    const head = "product_id,author_name,rating,content,is_verified,image_urls\n";
    const rows = samples.map((r) => {
      const safe = r.map((v) => {
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      });
      return safe.join(",");
    }).join("\n");
    const blob = new Blob([head + rows + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reviews-sample-10.csv";
    a.click();
  };

  return (
    <Page>
      <TitleBar title="Import reviews from CSV" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">How it works</Text>
            <Text as="p" tone="subdued">
              Upload a CSV with one review per row. Required columns: <strong>product_id</strong>,
              {" "}<strong>author_name</strong>, <strong>rating</strong> (1–5), <strong>content</strong>.
              Optional: <strong>is_verified</strong>, <strong>image_urls</strong> (comma-separated).
            </Text>
            <InlineStack gap="200">
              <Button onClick={downloadTemplate}>Download blank template</Button>
              <Button onClick={downloadSamples} variant="primary">Download 10 sample reviews</Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              The sample file has 10 ready-to-use reviews. Open it in Excel or Numbers, replace
              <code> REPLACE_WITH_PRODUCT_ID </code> with the actual product ID from your store
              (find it in the product URL: <code>/admin/products/<strong>1234567890</strong></code>),
              save, and upload it below.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <DropZone accept=".csv,text/csv" allowMultiple={false} onDrop={handleDrop}>
                {fileName
                  ? <Box padding="400"><Text as="p">{fileName}</Text></Box>
                  : <DropZone.FileUpload actionTitle="Upload CSV" actionHint="Accepts .csv files" />}
              </DropZone>
              <input type="hidden" name="csv" value={csvText} />
              <Button variant="primary" submit disabled={!csvText || nav.state === "submitting"}>
                {nav.state === "submitting" ? "Importing..." : "Import reviews"}
              </Button>
            </BlockStack>
          </Form>
        </Card>

        {action?.ok ? (
          <Banner tone="success" title={`Imported ${action.inserted} reviews`}>
            {action.errors?.length ? (
              <BlockStack gap="100">
                <Text as="p">Skipped rows:</Text>
                <List type="bullet">
                  {action.errors.slice(0, 10).map((e, i) => <List.Item key={i}>{e}</List.Item>)}
                </List>
              </BlockStack>
            ) : null}
          </Banner>
        ) : null}

        {action?.ok === false ? (
          <Banner tone="critical" title="Import failed">
            <p>{action.error}</p>
            {action.errors?.length ? (
              <List type="bullet">
                {action.errors.slice(0, 10).map((e, i) => <List.Item key={i}>{e}</List.Item>)}
              </List>
            ) : null}
          </Banner>
        ) : null}
      </BlockStack>
    </Page>
  );
}
