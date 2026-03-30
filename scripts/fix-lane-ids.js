/**
 * One-time migration script to standardize lane IDs in the rates table.
 *
 * New format: SCAC-ORIGIN_CODE-DEST_CODE-MODE-SVC-EXPIRY
 *   e.g.  SND-ATL-LAX-TL-STD-20261231
 *         AVRT-ATL-DAL-LTL-STD-20261231
 *         XPO-ATL-NYC-LTL-CZ-STD-20261231
 *
 * Usage:  node scripts/fix-lane-ids.js
 *         (Requires API server running on localhost:3001)
 */

const SUPABASE_URL = "https://ljbeihotrmyqthxptcgp.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqYmVpaG90cm15cXRoeHB0Y2dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTg1ODIsImV4cCI6MjA4ODQ3NDU4Mn0.dc1WOPBdJuDKOOjJnl1roVFVI6e0DMrAD1zQf2iJqAE";

// ── Carrier name → SCAC code ──
const CARRIER_SCAC = {
  "SCHNEIDER NATIONAL": "SND",
  "SCHNEIDER":          "SND",
  "SWIFT TRANSPORT":    "SWFT",
  "SWIFT TRANSPORTATION": "SWFT",
  "SWIFT":              "SWFT",
  "WERNER ENTERPRISES": "WERN",
  "WERNER":             "WERN",
  "J.B. HUNT TRANSPORT":"JBHT",
  "J.B. HUNT":          "JBHT",
  "JB HUNT":            "JBHT",
  "AVERITT EXPRESS":    "AVRT",
  "OLD DOMINION":       "ODFL",
  "OLD DOMINION FREIGHT": "ODFL",
  "XPO LOGISTICS":      "XPO",
  "XPO":                "XPO",
  "ESTES EXPRESS":      "EXLA",
  "ESTES EXPRESS LINES": "EXLA",
  "SAIA LTL FREIGHT":   "SAIA",
  "SAIA INC":           "SAIA",
  "SAIA":               "SAIA",
  "ABF FREIGHT":        "ABFS",
  "FEDEX FREIGHT":      "FXFE",
  "R+L CARRIERS":       "RLCA",
  "TFORCE FREIGHT":     "UPGF",
  "UPS FREIGHT":        "UPGF",
  "KLLM TRANSPORT":     "KLLM",
  "KLLM":               "KLLM",
};

// ── City → 3-letter code ──
const CITY_CODES = {
  "ATLANTA":       "ATL",
  "CHICAGO":       "CHI",
  "DALLAS":        "DAL",
  "HOUSTON":       "HOU",
  "NEW YORK":      "NYC",
  "LOS ANGELES":   "LAX",
  "SEATTLE":       "SEA",
  "DENVER":        "DEN",
  "PHOENIX":       "PHX",
  "COLUMBUS":      "CMH",
  "MEMPHIS":       "MEM",
  "MIAMI":         "MIA",
  "CHARLOTTE":     "CLT",
  "SAN JOSE":      "SJC",
  "SAN FRANCISCO": "SFO",
  "BOSTON":         "BOS",
  "NASHVILLE":     "BNA",
  "MOUNTAIN VIEW": "MTV",
  "COLLEGE PARK":  "CPK",
  "INDIANAPOLIS":  "IND",
  "MINNEAPOLIS":   "MSP",
  "DETROIT":       "DTW",
  "LOUISVILLE":    "SDF",
  "LAREDO":        "LRD",
  "EL PASO":       "ELP",
  "SAVANNAH":      "SAV",
};

function getScac(carrier) {
  const key = (carrier || "").toUpperCase().trim();
  return CARRIER_SCAC[key] || key.substring(0, 4).replace(/\s/g, "");
}

function getCityCode(addr) {
  const city = (addr || "").split(",")[0].trim().toUpperCase();
  return CITY_CODES[city] || city.substring(0, 3);
}

function getServiceLevel(rate) {
  const sl = (rate.service_level || rate.serviceLevel || "").toUpperCase();
  if (sl.includes("EXPRESS") || sl.includes("EXPEDIT")) return "EXP";
  return "STD";
}

function getExpiry(rate) {
  const exp = rate.exp || rate.expires || rate.expiry_date || rate.expiryDate || "";
  if (!exp) return "";
  return exp.replace(/-/g, "");
}

function buildLaneId(rate) {
  const scac = getScac(rate.carrier);
  const orig = getCityCode(rate.origin);
  const dest = getCityCode(rate.dest);
  const mode = (rate.mode || "TL").toUpperCase();
  const svc  = getServiceLevel(rate);
  const exp  = getExpiry(rate);
  const czPart = rate.czarlite ? "-CZ" : "";

  return `${scac}-${orig}-${dest}-${mode}${czPart}-${svc}${exp ? "-" + exp : ""}`;
}

async function main() {
  const headers = {
    "Content-Type": "application/json",
    "apikey": ANON_KEY,
    "Authorization": `Bearer ${ANON_KEY}`,
  };

  // Fetch all rates
  console.log("Fetching rates from Supabase...");
  const ratesRes = await fetch(`${SUPABASE_URL}/rest/v1/rates?select=*&order=lane&limit=500`, { headers });
  const rates = await ratesRes.json();
  console.log(`Found ${rates.length} rates\n`);

  // Build rename plan
  const renames = [];
  const seen = new Set();

  for (const rate of rates) {
    const oldLane = rate.lane;
    let newLane = buildLaneId(rate);

    // Handle duplicates by appending a number
    let finalLane = newLane;
    let counter = 2;
    while (seen.has(finalLane)) {
      finalLane = `${newLane}-${counter}`;
      counter++;
    }
    seen.add(finalLane);

    if (oldLane !== finalLane) {
      renames.push({ id: rate.id, oldLane, newLane: finalLane, carrier: rate.carrier });
    }
  }

  if (renames.length === 0) {
    console.log("All lane IDs are already standardized!");
    return;
  }

  // Print plan
  console.log("=== LANE ID RENAME PLAN ===\n");
  console.log("OLD LANE ID".padEnd(40) + " → " + "NEW LANE ID".padEnd(40) + "CARRIER");
  console.log("-".repeat(110));
  for (const r of renames) {
    console.log(`${r.oldLane.padEnd(40)} → ${r.newLane.padEnd(40)} ${r.carrier}`);
  }
  console.log(`\n${renames.length} rates to rename.\n`);

  // Ask for confirmation
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question("Apply these changes? (yes/no): ", resolve));
  rl.close();

  if (answer.toLowerCase() !== "yes") {
    console.log("Aborted.");
    return;
  }

  // Apply renames
  let success = 0;
  let failed = 0;
  for (const r of renames) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rates?id=eq.${r.id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ lane: r.newLane }),
      });
      if (res.ok) {
        success++;
        console.log(`✅ ${r.oldLane} → ${r.newLane}`);
      } else {
        failed++;
        const err = await res.text();
        console.error(`❌ ${r.oldLane}: ${err}`);
      }
    } catch (err) {
      failed++;
      console.error(`❌ ${r.oldLane}: ${err.message}`);
    }
  }

  console.log(`\nDone! ${success} renamed, ${failed} failed.`);
}

main().catch(console.error);
