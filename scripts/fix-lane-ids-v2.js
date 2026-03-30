/**
 * Remove trailing expiry date from lane IDs.
 * AVRT-ATL-DAL-LTL-CZ-STD-20261231  →  AVRT-ATL-DAL-LTL-CZ-STD
 */

const SUPABASE_URL = "https://ljbeihotrmyqthxptcgp.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqYmVpaG90cm15cXRoeHB0Y2dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTg1ODIsImV4cCI6MjA4ODQ3NDU4Mn0.dc1WOPBdJuDKOOjJnl1roVFVI6e0DMrAD1zQf2iJqAE";

async function main() {
  const headers = {
    "Content-Type": "application/json",
    "apikey": ANON_KEY,
    "Authorization": `Bearer ${ANON_KEY}`,
  };

  console.log("Fetching rates...");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rates?select=id,lane&order=lane&limit=500`, { headers });
  const rates = await res.json();
  console.log(`Found ${rates.length} rates\n`);

  const renames = [];
  const seen = new Set();

  for (const r of rates) {
    // Strip trailing date patterns like -20261231 or -20261231-20261231
    let newLane = r.lane.replace(/(-\d{8})+$/, "");

    // Handle duplicates
    let finalLane = newLane;
    let counter = 2;
    while (seen.has(finalLane)) {
      finalLane = `${newLane}-${counter}`;
      counter++;
    }
    seen.add(finalLane);

    if (r.lane !== finalLane) {
      renames.push({ id: r.id, oldLane: r.lane, newLane: finalLane });
    }
  }

  if (!renames.length) { console.log("Nothing to fix!"); return; }

  console.log("OLD".padEnd(45) + "→  NEW");
  console.log("-".repeat(90));
  renames.forEach(r => console.log(`${r.oldLane.padEnd(45)}→  ${r.newLane}`));
  console.log(`\n${renames.length} to rename.\n`);

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => rl.question("Apply? (yes/no): ", resolve));
  rl.close();
  if (answer.toLowerCase() !== "yes") { console.log("Aborted."); return; }

  let ok = 0;
  for (const r of renames) {
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/rates?id=eq.${r.id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ lane: r.newLane }),
    });
    if (patchRes.ok) { ok++; console.log(`✅ ${r.newLane}`); }
    else { console.error(`❌ ${r.oldLane}: ${await patchRes.text()}`); }
  }
  console.log(`\nDone! ${ok} renamed.`);
}
main().catch(console.error);
