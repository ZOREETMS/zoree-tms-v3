# Zoree TMS v3.11 — Demo Script

> **Total Duration:** ~5 minutes
> **Presenter Notes:** Each section includes talking points and on-screen actions.
> **Tip:** Keep the pace steady. Let each screen load fully before narrating.

---

## Scene 1: Login & Home Dashboard (0:00 – 0:30)

### On Screen
1. Open the Zoree TMS login page
2. Enter credentials and click **Sign In**
3. Land on the **Home** page

### Talking Points
- "Welcome to Zoree TMS — a modern, end-to-end Transportation Management System."
- "The home dashboard gives you an instant overview of your logistics operations."
- Highlight the **KPI cards**: Active Shipments, On-Time %, Total Spend, Exceptions
- Point out **Quick Actions** (New Order, Plan Shipment, Track, Generate BOL)
- Show the **Activity Feed** for recent system events
- Briefly show the **Module Directory** cards at the bottom

---

## Scene 2: Order Management (0:30 – 1:30)

### On Screen
1. Click **Orders** in the sidebar
2. Show the orders list with filters and status badges
3. Click **+ New Order** to open the order form
4. Fill in: Customer, Origin, Destination, Equipment Type, Weight
5. Add line items via the **Order Lines Editor**
6. Save the order — see it appear as "Unplanned"
7. Show the **Order Detail** modal with change log

### Talking Points
- "Orders are the foundation of TMS operations. Zoree supports the full lifecycle — from creation through delivery."
- "Each order tracks customer, origin/destination, weight, piece count, equipment type, and special handling."
- "Line items let you break down commodities with freight class, NMFC codes, and dimensions."
- "The status workflow: Unplanned → Planned → Consolidated → Tendered → In Transit → Delivered."
- "Every change is tracked in the order history audit trail."

---

## Scene 3: Shipment Planning & Bulk Plan (1:30 – 2:30)

### On Screen
1. Navigate to **Bulk Plan** page
2. Select multiple Unplanned orders using checkboxes
3. Click **Get Rates** — show rate shopping results (TL, LTL, Partial TL)
4. Review carrier options, rates, transit times
5. Select preferred rates and click **Execute Plan**
6. Show confirmation: shipments created, dock slots assigned, orders updated to Planned

### Talking Points
- "Bulk planning lets you plan multiple orders simultaneously with intelligent rate shopping."
- "Zoree integrates with SMC3, CzarLite, CarrierConnect, and PC*MILER for real-time rates and mileage."
- "The system automatically compares TL, LTL, and Partial TL options across all your contracted carriers."
- "Lane preferences ensure your preferred carriers get priority on specific lanes."
- "Dock slot assignment happens automatically during planning — no manual scheduling needed."

---

## Scene 4: Live Tracking (2:30 – 3:00)

### On Screen
1. Navigate to **Live Tracking**
2. Show the interactive map with shipment markers
3. Click on a shipment marker to see details (carrier, status, origin/destination)
4. Show the shipment list panel alongside the map

### Talking Points
- "Live tracking provides real-time visibility across your entire freight network."
- "Each shipment is plotted on the map with status-coded markers."
- "Click any marker to see carrier details, pickup/delivery dates, and current status."
- "The side panel lets you filter and search active shipments."

---

## Scene 5: Carrier Portal (3:00 – 3:30)

### On Screen
1. Navigate to **Carrier Portal**
2. Show tendered shipments with carrier details
3. Open a tender card — show load details, rate, pickup/delivery info
4. Demonstrate the **Accept / Decline** flow

### Talking Points
- "The Carrier Portal gives your carriers a dedicated interface to manage tenders."
- "Carriers see load details, rates, and can accept or decline with one click."
- "Tender emails are sent automatically with professional formatting including all load details."

---

## Scene 6: Dock Scheduling (3:30 – 4:00)

### On Screen
1. Navigate to **Dock Scheduling**
2. Show the dock grid view with time slots and door assignments
3. Show warehouse configuration (doors, hours, capacity)
4. Point out appointment status badges (Scheduled, Confirmed, In Progress, Completed)

### Talking Points
- "Dock scheduling eliminates warehouse bottlenecks."
- "Configure each warehouse with dock doors, operating hours, and capacity limits."
- "Appointments are auto-assigned during planning, or can be manually managed."
- "The visual grid shows door utilization at a glance."

---

## Scene 7: Documents & BOL (4:00 – 4:30)

### On Screen
1. Navigate to **Documents & BOL**
2. Show the document library (BOL, POD, Invoice, Hazmat)
3. Click **Generate BOL** for a shipment
4. Show the generated BOL preview with all shipment details
5. Demonstrate PDF export

### Talking Points
- "Zoree generates compliant shipping documents automatically."
- "Bill of Lading, Proof of Delivery, Hazmat docs, and invoices — all in one place."
- "Documents pull live data from orders and shipments — no manual entry."
- "Export to PDF with one click for printing or email."

---

## Scene 8: Analytics & Reports (4:30 – 5:00)

### On Screen
1. Navigate to **Analytics**
2. Show the analytics dashboard: Spend by Mode, Carrier Scorecards, KPI trends
3. Switch to **Reports** page
4. Show the report library (Carrier Performance, Freight Spend, On-Time Delivery, etc.)
5. Generate a sample report

### Talking Points
- "Analytics give you actionable insights into your transportation spend and performance."
- "Carrier scorecards track on-time delivery, claim ratios, and volume."
- "The report library includes pre-built templates for common logistics KPIs."
- "Schedule reports for automatic generation and export."

---

## Scene 9: Zoree AI Assistant (5:00 – 5:30)

### On Screen
1. Click the **Zoree AI** floating button (bottom right)
2. Type or speak: "Show me today's shipments"
3. AI responds with live shipment data
4. Ask: "Which carrier has the best on-time rate?"
5. AI responds with carrier performance data

### Talking Points
- "Zoree AI is your intelligent logistics assistant — built right into the platform."
- "Ask natural language questions about orders, shipments, carriers, and rates."
- "It has access to live TMS data and can surface insights instantly."
- "Voice input is supported for hands-free operation."

---

## Closing (5:30)

### Talking Points
- "That's Zoree TMS — planning, execution, finance, compliance, and analytics in one platform."
- "Built for modern logistics teams who need speed, visibility, and control."
- "Questions?"

---

## Demo Checklist (Pre-Recording)

- [ ] App running (API on :3001, Frontend on :5173)
- [ ] Logged in as Admin user
- [ ] Sufficient demo data: 10+ orders, 5+ shipments, 5+ carriers
- [ ] No console errors on any demo page
- [ ] Browser window at 1920x1080 or 1440x900
- [ ] Sensitive data (API keys, passwords) not visible
- [ ] ZoreeAI widget functional
- [ ] Map tiles loading correctly (HERE Maps API key valid)
