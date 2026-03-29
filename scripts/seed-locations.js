/**
 * Seed script: Insert 20 rich sample locations via Supabase REST API.
 *
 * STEP 1: Run the migration first in Supabase SQL Editor:
 *   supabase/migrations/20260329_locations_add_columns.sql
 *
 * STEP 2: Then run this: node scripts/seed-locations.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'api', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ljbeihotrmyqthxptcgp.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqYmVpaG90cm15cXRoeHB0Y2dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTg1ODIsImV4cCI6MjA4ODQ3NDU4Mn0.dc1WOPBdJuDKOOjJnl1roVFVI6e0DMrAD1zQf2iJqAE';

const locations = [
  // ── SHIPPERS (7) ─────────────────────────────
  {
    id: "LOC-CHI-001", name: "CISCO CHICAGO SHIPPING HUB", type: "Shipper", customer: "CISCO SYSTEMS",
    address: "1000 INDUSTRIAL PKWY", city: "CHICAGO", state: "IL", zip: "60638", country: "US",
    lat: 41.8781, lng: -87.6298, contact_name: "MARK TORRES", contact_phone: "(312) 555-0101", contact_email: "mark.torres@cisco.com",
    ahphone: "(312) 555-0199", hours: "MON-FRI 06:00-20:00", dock_doors: 12, trailer: 53, liftgate: "No",
    appt: true, hazmat: true, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-SJC-001", name: "CISCO SAN JOSE HQ DOCK", type: "Shipper", customer: "CISCO SYSTEMS",
    address: "170 W TASMAN DR", city: "SAN JOSE", state: "CA", zip: "95134", country: "US",
    lat: 37.4089, lng: -121.9550, contact_name: "LINDA CHOW", contact_phone: "(408) 555-0200", contact_email: "linda.chow@cisco.com",
    ahphone: "(408) 555-0299", hours: "MON-FRI 07:00-18:00", dock_doors: 6, trailer: 53, liftgate: "No",
    appt: true, hazmat: false, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-ATL-001", name: "AT&T ATLANTA SHIPPING", type: "Shipper", customer: "AT&T",
    address: "675 WEST PEACHTREE ST NW", city: "ATLANTA", state: "GA", zip: "30308", country: "US",
    lat: 33.7709, lng: -84.3880, contact_name: "JAMES REED", contact_phone: "(404) 555-0300", contact_email: "james.reed@att.com",
    ahphone: "(404) 555-0399", hours: "MON-SAT 05:00-22:00", dock_doors: 8, trailer: 53, liftgate: "No",
    appt: false, hazmat: false, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-DAL-001", name: "AT&T DALLAS NETWORK CENTER", type: "Shipper", customer: "AT&T",
    address: "208 S AKARD ST", city: "DALLAS", state: "TX", zip: "75202", country: "US",
    lat: 32.7811, lng: -96.7988, contact_name: "PATRICIA KIM", contact_phone: "(214) 555-0400", contact_email: "patricia.kim@att.com",
    ahphone: "(214) 555-0499", hours: "24/7", dock_doors: 4, trailer: 53, liftgate: "No",
    appt: true, hazmat: false, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-MTV-001", name: "META MENLO PARK CAMPUS", type: "Shipper", customer: "META",
    address: "1 HACKER WAY", city: "MENLO PARK", state: "CA", zip: "94025", country: "US",
    lat: 37.4845, lng: -122.1477, contact_name: "CHRIS PARK", contact_phone: "(650) 555-0500", contact_email: "chris.park@meta.com",
    ahphone: "(650) 555-0599", hours: "MON-FRI 08:00-17:00", dock_doors: 10, trailer: 53, liftgate: "No",
    appt: true, hazmat: true, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-SEA-001", name: "GOOGLE SEATTLE OFFICE", type: "Shipper", customer: "GOOGLE",
    address: "601 N 34TH ST", city: "SEATTLE", state: "WA", zip: "98103", country: "US",
    lat: 47.6493, lng: -122.3501, contact_name: "AMY JOHNSON", contact_phone: "(206) 555-0600", contact_email: "amy.johnson@google.com",
    ahphone: "(206) 555-0699", hours: "MON-FRI 07:00-19:00", dock_doors: 5, trailer: 53, liftgate: "No",
    appt: true, hazmat: false, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-FRE-001", name: "SEAGATE FREMONT FACTORY", type: "Shipper", customer: "SEAGATE",
    address: "47488 KATO RD", city: "FREMONT", state: "CA", zip: "94538", country: "US",
    lat: 37.5170, lng: -121.9299, contact_name: "DAVID NGUYEN", contact_phone: "(510) 555-0700", contact_email: "david.nguyen@seagate.com",
    ahphone: "(510) 555-0799", hours: "MON-FRI 06:00-22:00; SAT 08:00-14:00", dock_doors: 16, trailer: 53, liftgate: "No",
    appt: true, hazmat: false, resi: false, inside_delivery: false, sort_segregate: true, twic: false, notes: "", status: "Active"
  },

  // ── CONSIGNEES (4) ───────────────────────────
  {
    id: "LOC-PHX-001", name: "AMAZON PHOENIX FULFILLMENT", type: "Consignee", customer: "AMAZON",
    address: "5050 W MOHAVE ST", city: "PHOENIX", state: "AZ", zip: "85043", country: "US",
    lat: 33.4344, lng: -112.1560, contact_name: "SARAH BROWN", contact_phone: "(602) 555-0800", contact_email: "sarah.brown@amazon.com",
    ahphone: "(602) 555-0899", hours: "24/7", dock_doors: 20, trailer: 53, liftgate: "No",
    appt: true, hazmat: false, resi: false, inside_delivery: false, sort_segregate: true, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-NAS-001", name: "FEDEX NASHVILLE SORT CENTER", type: "Consignee", customer: "FEDEX",
    address: "3350 HARDING PL", city: "NASHVILLE", state: "TN", zip: "37211", country: "US",
    lat: 36.1045, lng: -86.7477, contact_name: "MIKE DAVIS", contact_phone: "(615) 555-0900", contact_email: "mike.davis@fedex.com",
    ahphone: "(615) 555-0999", hours: "MON-SAT 04:00-23:00", dock_doors: 14, trailer: 53, liftgate: "No",
    appt: false, hazmat: true, resi: false, inside_delivery: false, sort_segregate: true, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-DEN-001", name: "TARGET DENVER DC", type: "Consignee", customer: "TARGET",
    address: "19201 E 40TH AVE", city: "DENVER", state: "CO", zip: "80249", country: "US",
    lat: 39.7715, lng: -104.7832, contact_name: "JENNIFER WOLF", contact_phone: "(303) 555-1000", contact_email: "jennifer.wolf@target.com",
    ahphone: "(303) 555-1099", hours: "MON-FRI 06:00-18:00", dock_doors: 18, trailer: 53, liftgate: "No",
    appt: true, hazmat: false, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-MIN-001", name: "BEST BUY MINNEAPOLIS HQ", type: "Consignee", customer: "BEST BUY",
    address: "7601 PENN AVE S", city: "MINNEAPOLIS", state: "MN", zip: "55423", country: "US",
    lat: 44.8641, lng: -93.3364, contact_name: "ROBERT CHEN", contact_phone: "(612) 555-1100", contact_email: "robert.chen@bestbuy.com",
    ahphone: "(612) 555-1199", hours: "MON-FRI 07:00-17:00", dock_doors: 6, trailer: 53, liftgate: "No",
    appt: true, hazmat: false, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },

  // ── WAREHOUSES (3) ────────────────────────────
  {
    id: "LOC-MEM-001", name: "MEMPHIS CENTRAL WAREHOUSE", type: "Warehouse", customer: "",
    address: "3000 AIRWAYS BLVD", city: "MEMPHIS", state: "TN", zip: "38116", country: "US",
    lat: 35.0697, lng: -89.9785, contact_name: "KEVIN WHITE", contact_phone: "(901) 555-1200", contact_email: "kevin.white@zoree.com",
    ahphone: "(901) 555-1299", hours: "24/7", dock_doors: 24, trailer: 53, liftgate: "No",
    appt: false, hazmat: true, resi: false, inside_delivery: false, sort_segregate: true, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-ONT-001", name: "ONTARIO CA MEGA WAREHOUSE", type: "Warehouse", customer: "",
    address: "2500 E INLAND EMPIRE BLVD", city: "ONTARIO", state: "CA", zip: "91764", country: "US",
    lat: 34.0633, lng: -117.6509, contact_name: "LISA GARCIA", contact_phone: "(909) 555-1300", contact_email: "lisa.garcia@zoree.com",
    ahphone: "(909) 555-1399", hours: "MON-SAT 05:00-23:00", dock_doors: 30, trailer: 53, liftgate: "No",
    appt: true, hazmat: true, resi: false, inside_delivery: false, sort_segregate: true, twic: false, notes: "", status: "Active"
  },

  // ── DISTRIBUTION CENTERS (2) ──────────────────
  {
    id: "LOC-KCM-001", name: "KC METRO DISTRIBUTION CENTER", type: "Distribution Center", customer: "",
    address: "1200 NW COMMERCE DR", city: "KANSAS CITY", state: "MO", zip: "64116", country: "US",
    lat: 39.1545, lng: -94.5859, contact_name: "TOM HARRIS", contact_phone: "(816) 555-1400", contact_email: "tom.harris@zoree.com",
    ahphone: "(816) 555-1499", hours: "MON-FRI 06:00-20:00", dock_doors: 16, trailer: 53, liftgate: "No",
    appt: true, hazmat: false, resi: false, inside_delivery: false, sort_segregate: true, twic: false, notes: "", status: "Active"
  },
  {
    id: "LOC-CLT-001", name: "CHARLOTTE EAST DC", type: "Distribution Center", customer: "",
    address: "8500 RESEARCH DR", city: "CHARLOTTE", state: "NC", zip: "28262", country: "US",
    lat: 35.3106, lng: -80.7437, contact_name: "NANCY PATEL", contact_phone: "(704) 555-1500", contact_email: "nancy.patel@zoree.com",
    ahphone: "(704) 555-1599", hours: "MON-FRI 07:00-19:00", dock_doors: 12, trailer: 53, liftgate: "No",
    appt: false, hazmat: false, resi: false, inside_delivery: false, sort_segregate: false, twic: false, notes: "", status: "Active"
  },

  // ── PORT (1) ──────────────────────────────────
  {
    id: "LOC-LGB-001", name: "PORT OF LONG BEACH TERMINAL", type: "Port", customer: "",
    address: "415 W OCEAN BLVD", city: "LONG BEACH", state: "CA", zip: "90802", country: "US",
    lat: 33.7528, lng: -118.1885, contact_name: "GEORGE MARTINEZ", contact_phone: "(562) 555-1600", contact_email: "george.martinez@polb.com",
    ahphone: "(562) 555-1699", hours: "24/7", dock_doors: 0, trailer: 53, liftgate: "No",
    appt: true, hazmat: true, resi: false, inside_delivery: false, sort_segregate: false, twic: true, notes: "TWIC card required for all drivers", status: "Active"
  },

  // ── RAIL YARD (1) ──────────────────────────────
  {
    id: "LOC-JOL-001", name: "BNSF JOLIET INTERMODAL", type: "Rail Yard", customer: "BNSF",
    address: "2000 CENTERLINE DR", city: "JOLIET", state: "IL", zip: "60436", country: "US",
    lat: 41.4947, lng: -88.1387, contact_name: "FRANK LEE", contact_phone: "(815) 555-1700", contact_email: "frank.lee@bnsf.com",
    ahphone: "(815) 555-1799", hours: "24/7", dock_doors: 0, trailer: 53, liftgate: "No",
    appt: true, hazmat: true, resi: false, inside_delivery: false, sort_segregate: false, twic: true, notes: "Intermodal facility - chassis pool available", status: "Active"
  },

  // ── CROSS-DOCK (1) ─────────────────────────────
  {
    id: "LOC-IND-001", name: "INDIANAPOLIS CROSS-DOCK", type: "Cross-Dock", customer: "",
    address: "4500 W RAYMOND ST", city: "INDIANAPOLIS", state: "IN", zip: "46241", country: "US",
    lat: 39.7312, lng: -86.2172, contact_name: "STEVE ADAMS", contact_phone: "(317) 555-1800", contact_email: "steve.adams@zoree.com",
    ahphone: "(317) 555-1899", hours: "MON-SAT 04:00-22:00", dock_doors: 20, trailer: 53, liftgate: "No",
    appt: false, hazmat: false, resi: false, inside_delivery: false, sort_segregate: true, twic: false, notes: "", status: "Active"
  },

  // ── CUSTOMER (1) ───────────────────────────────
  {
    id: "LOC-BOS-001", name: "WAYFAIR BOSTON RECEIVING", type: "Customer", customer: "WAYFAIR",
    address: "4 COPLEY PL", city: "BOSTON", state: "MA", zip: "02116", country: "US",
    lat: 42.3478, lng: -71.0773, contact_name: "EMILY CLARK", contact_phone: "(617) 555-1900", contact_email: "emily.clark@wayfair.com",
    ahphone: "(617) 555-1999", hours: "MON-FRI 08:00-16:00", dock_doors: 3, trailer: 48, liftgate: "Yes",
    appt: true, hazmat: false, resi: false, inside_delivery: true, sort_segregate: false, twic: false, notes: "Liftgate required, inside delivery", status: "Active"
  },
];

async function seed() {
  console.log(`Seeding ${locations.length} locations into Supabase...`);

  // First delete all existing locations
  const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/locations?select=id`, {
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
  });
  if (existingRes.ok) {
    const existing = await existingRes.json();
    for (const loc of existing) {
      await fetch(`${SUPABASE_URL}/rest/v1/locations?id=eq.${encodeURIComponent(loc.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
      });
      console.log(`  Deleted existing: ${loc.id}`);
    }
  }

  // Insert new locations
  let success = 0, fail = 0;
  for (const loc of locations) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(loc),
    });
    if (res.ok) {
      console.log(`  + ${loc.id} — ${loc.name}`);
      success++;
    } else {
      const err = await res.text();
      // If column doesn't exist, try with only base columns
      if (err.includes('Could not find the')) {
        const baseLoc = { id: loc.id, name: loc.name, type: loc.type, address: loc.address, city: loc.city, state: loc.state, zip: loc.zip, country: loc.country, contact_name: loc.contact_name, contact_phone: loc.contact_phone, contact_email: loc.contact_email, dock_doors: loc.dock_doors, status: loc.status };
        const res2 = await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Prefer': 'return=representation' },
          body: JSON.stringify(baseLoc),
        });
        if (res2.ok) {
          console.log(`  + ${loc.id} — ${loc.name} (base columns only — run migration for full data)`);
          success++;
        } else {
          console.error(`  x ${loc.id} — ${await res2.text()}`);
          fail++;
        }
      } else {
        console.error(`  x ${loc.id} — ${err}`);
        fail++;
      }
    }
  }

  console.log(`\nDone! ${success} inserted, ${fail} failed.`);
  if (fail === 0) console.log('Refresh the Location Master page to see the data.');
  else console.log('Some inserts failed. Run the migration SQL first, then re-run this script.');
}

seed().catch(console.error);
