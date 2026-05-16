// ================================================================
// AutoFlow v7 — sheets-export
// Exports all leads for a client to a Google Sheet.
// Uses the client's stored gmail_access token (needs spreadsheets scope).
// Creates a new sheet on first run, then updates it on subsequent runs.
// ================================================================
import { getAdminClient, CORS } from "../_shared/helpers.ts";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { client_id } = await req.json();
  if (!client_id) return new Response(JSON.stringify({ error: "client_id required" }), { status: 400, headers: CORS });

  const sb = getAdminClient();

  // ── Load client ───────────────────────────────────────────────
  const { data: client } = await sb.from("clients")
    .select("gmail_access, gmail_refresh, google_sheet_id, google_sheet_url, business_name")
    .eq("id", client_id)
    .single();

  if (!client?.gmail_access) {
    return new Response(JSON.stringify({ error: "Gmail not connected — connect Gmail first in Credentials" }), { status: 400, headers: CORS });
  }

  // ── Load all leads for this client ───────────────────────────
  const { data: leads } = await sb.from("leads")
    .select("business_name, owner_name, email, phone, website, city, niche, score, stage, demo_url, created_at")
    .eq("client_id", client_id)
    .order("score", { ascending: false });

  if (!leads?.length) {
    return new Response(JSON.stringify({ error: "No leads found for this client" }), { status: 400, headers: CORS });
  }

  const token = client.gmail_access;
  let sheetId  = client.google_sheet_id;
  let sheetUrl = client.google_sheet_url;

  // ── Create sheet if it doesn't exist yet ─────────────────────
  if (!sheetId) {
    const created = await createSheet(token, client.business_name || "AutoFlow Leads");
    if (!created) {
      return new Response(JSON.stringify({
        error: "Failed to create Google Sheet — reconnect Gmail with Sheets permission (click Reconnect in Credentials)"
      }), { status: 400, headers: CORS });
    }
    sheetId  = created.id;
    sheetUrl = created.url;
    await sb.from("clients").update({ google_sheet_id: sheetId, google_sheet_url: sheetUrl }).eq("id", client_id);
  }

  // ── Build rows ────────────────────────────────────────────────
  const headers = [
    "Business Name", "Owner", "Email", "Phone", "Website",
    "City", "Niche", "Score", "Stage", "Demo Site URL", "Found On"
  ];

  const rows = leads.map(l => [
    l.business_name || "",
    l.owner_name    || "",
    l.email         || "",
    l.phone         || "",
    l.website       || "",
    l.city          || "",
    l.niche         || "",
    l.score         ?? "",
    l.stage         || "",
    l.demo_url      || "",
    l.created_at ? new Date(l.created_at).toLocaleDateString() : ""
  ]);

  const values = [headers, ...rows];

  // ── Write to sheet ────────────────────────────────────────────
  const written = await writeToSheet(token, sheetId, values);

  if (!written) {
    return new Response(JSON.stringify({
      error: "Sheet write failed — your Gmail token may need Sheets scope. Click Reconnect in Credentials."
    }), { status: 400, headers: CORS });
  }

  // ── Apply formatting (bold headers, freeze row) ───────────────
  await formatSheet(token, sheetId);

  return new Response(JSON.stringify({
    ok: true,
    sheet_url: sheetUrl,
    rows_written: rows.length,
    sheet_id: sheetId
  }), { headers: { ...CORS, "Content-Type": "application/json" } });
});

// ── Create a new Google Sheet ─────────────────────────────────
async function createSheet(token: string, clientName: string): Promise<{ id: string; url: string } | null> {
  try {
    const res = await fetch(SHEETS_API, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: { title: `AutoFlow Leads — ${clientName}` },
        sheets: [{ properties: { title: "Leads", gridProperties: { frozenRowCount: 1 } } }]
      })
    });
    if (!res.ok) { console.error("[sheets-export] Create sheet error:", res.status, await res.text()); return null; }
    const data = await res.json();
    return { id: data.spreadsheetId, url: data.spreadsheetUrl };
  } catch (e) { console.error("[sheets-export] Create error:", e); return null; }
}

// ── Write values to the sheet ─────────────────────────────────
async function writeToSheet(token: string, sheetId: string, values: unknown[][]): Promise<boolean> {
  try {
    const res = await fetch(
      `${SHEETS_API}/${sheetId}/values/Leads!A1:K${values.length}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ range: `Leads!A1:K${values.length}`, majorDimension: "ROWS", values })
      }
    );
    if (!res.ok) { console.error("[sheets-export] Write error:", res.status, await res.text()); return false; }
    return true;
  } catch (e) { console.error("[sheets-export] Write error:", e); return false; }
}

// ── Bold header row + auto-resize columns ─────────────────────
async function formatSheet(token: string, sheetId: string): Promise<void> {
  try {
    await fetch(`${SHEETS_API}/${sheetId}:batchUpdate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          // Bold header row
          {
            repeatCell: {
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.24, green: 0.24, blue: 0.48 } } },
              fields: "userEnteredFormat(textFormat,backgroundColor)"
            }
          },
          // Auto-resize all columns
          { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 11 } } }
        ]
      })
    });
  } catch (_) { /* formatting is best-effort */ }
}
