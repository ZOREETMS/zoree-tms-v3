# Zoree TMS v3 — User Story Document

**Product:** Zoree Transportation Management System v3
**Date:** April 12, 2026
**Status:** In Development

---

## Table of Contents

1. [Authentication & Access](#1-authentication--access)
2. [Dashboard & Home](#2-dashboard--home)
3. [Order Management](#3-order-management)
4. [Shipment Management](#4-shipment-management)
5. [Bulk Planning & Consolidation](#5-bulk-planning--consolidation)
6. [Rate Management](#6-rate-management)
7. [Dock Scheduling](#7-dock-scheduling)
8. [Carrier Management](#8-carrier-management)
9. [Carrier Portal & Tendering](#9-carrier-portal--tendering)
10. [Carrier RFQ & Bidding](#10-carrier-rfq--bidding)
11. [Multi-Stop Routes](#11-multi-stop-routes)
12. [Compliance & Safety](#12-compliance--safety)
13. [Documents (BOL/POD/Invoice/Hazmat)](#13-documents)
14. [Freight Audit](#14-freight-audit)
15. [Freight Invoices](#15-freight-invoices)
16. [Fleet Management](#16-fleet-management)
17. [Analytics & Reporting](#17-analytics--reporting)
18. [Alerts & Exception Management](#18-alerts--exception-management)
19. [Messaging Hub](#19-messaging-hub)
20. [Master Data Management](#20-master-data-management)
21. [Integrations](#21-integrations)
22. [System Administration](#22-system-administration)

---

## 1. Authentication & Access

### US-1.1: User Login
**As a** TMS user,
**I want to** log in with my email and password,
**So that** I can securely access the system.

**Acceptance Criteria:**
- User enters email and password on the login page
- System authenticates via Supabase Auth (JWT)
- On success, token is stored and user is redirected to the dashboard
- On failure, an error message is displayed
- Token auto-refreshes on 401 responses to prevent session expiry

### US-1.2: Session Persistence
**As a** logged-in user,
**I want** my session to persist across browser refreshes,
**So that** I don't have to log in repeatedly.

**Acceptance Criteria:**
- Auth token and refresh token are stored in localStorage
- App checks token validity on load and refreshes if expired
- Unauthenticated users are redirected to the login page

### US-1.3: Trial Signup
**As a** prospective customer,
**I want to** sign up for a trial,
**So that** I can evaluate the platform before committing.

**Acceptance Criteria:**
- Public signup endpoint with rate limiting
- Captures user info and creates a trial record

---

## 2. Dashboard & Home

### US-2.1: KPI Overview
**As a** dispatcher or logistics manager,
**I want to** see key performance indicators on the home page,
**So that** I can quickly assess operational health.

**Acceptance Criteria:**
- Dashboard displays: active shipments, on-time delivery %, total freight spend, open exceptions
- KPI cards are populated from live data
- Quick action buttons provide shortcuts to common tasks (create order, plan shipments, etc.)

### US-2.2: Activity Feed
**As a** user,
**I want to** see recent activity and system insights,
**So that** I stay informed about what's happening.

**Acceptance Criteria:**
- Activity card shows recent events (orders created, shipments delivered, etc.)
- Insights section highlights trends and anomalies

### US-2.3: Module Navigation
**As a** user,
**I want to** navigate to any TMS module from the home page,
**So that** I can quickly access any feature.

**Acceptance Criteria:**
- Module cards for each major feature area (Orders, Shipments, Rates, Carriers, etc.)
- Each card links to the corresponding page

---

## 3. Order Management

### US-3.1: Create Order
**As a** dispatcher,
**I want to** create a new transportation order,
**So that** I can initiate the shipping process.

**Acceptance Criteria:**
- New Order modal captures: origin, destination, weight, pieces, equipment type, mode (TL/LTL), ready date, due date, commodity, customer, special instructions
- Equipment types include: Dry Van 53', Flatbed, Reefer, Step Deck, Lowboy, Tanker, LTL Truck, Intermodal
- LTL max weight enforced at 15,000 lbs; TL max at 44,000 lbs
- Order is created with status "Unplanned"
- User attribution tracks who created the order (Sridhar/Dispatcher, Tulasi/Admin, or System/Auto)

### US-3.2: View & Edit Orders
**As a** dispatcher,
**I want to** view order details and edit them,
**So that** I can update information as requirements change.

**Acceptance Criteria:**
- Order detail modal shows all order fields and line items
- Line item editor allows adding/removing/editing individual items
- Weight and pieces auto-aggregate from line items
- Order history tracks all changes (user, timestamp, field changed)

### US-3.3: Copy Order
**As a** dispatcher,
**I want to** copy an existing order,
**So that** I can quickly create similar orders without re-entering data.

**Acceptance Criteria:**
- Copy action creates a new order with the same details
- New order gets status "Unplanned" and a new ID

### US-3.4: Cancel Order
**As a** dispatcher,
**I want to** cancel an order,
**So that** I can remove orders that are no longer needed.

**Acceptance Criteria:**
- Cancel sets order status to "Cancelled"
- Cancelled orders remain visible but are clearly marked

### US-3.5: Order Status Tracking
**As a** dispatcher,
**I want to** track order status throughout its lifecycle,
**So that** I know where each order stands.

**Acceptance Criteria:**
- Statuses: Unplanned, Planned, Consolidated, Tendered, In Transit, Delivered, Exception, Planning Failed, Cancelled
- Each status has a distinct color badge for visual identification
- Status transitions are logged in order history

### US-3.6: Automatic Order Scheduling
**As a** logistics manager,
**I want** the system to automatically plan unplanned orders on a schedule,
**So that** orders are processed without manual intervention.

**Acceptance Criteria:**
- Bulk scheduler runs at configurable intervals
- Automatically picks up unplanned orders and runs the planning workflow
- Failed planning attempts set order status to "Planning Failed"

---

## 4. Shipment Management

### US-4.1: View Shipments
**As a** dispatcher,
**I want to** view all shipments with their current status,
**So that** I can monitor active transportation.

**Acceptance Criteria:**
- Shipment list shows: ID, origin, destination, carrier, mode, status, cost, pickup/delivery dates
- Filterable by status, carrier, mode
- Color-coded status badges

### US-4.2: Create Shipment from Order
**As a** dispatcher,
**I want to** create a shipment from a planned order,
**So that** the carrier can be dispatched.

**Acceptance Criteria:**
- Shipment is created with order details, selected carrier, and rate
- Shipment links back to rate matrix via rate_id
- Order status updates to reflect shipment creation
- Dock door and dock window are assigned based on warehouse configuration

### US-4.3: New Shipment Modal
**As a** dispatcher,
**I want to** create a shipment manually,
**So that** I can handle ad-hoc shipping needs.

**Acceptance Criteria:**
- Modal captures: origin, destination, carrier, weight, pieces, mode, dates
- Validates required fields before submission

---

## 5. Bulk Planning & Consolidation

### US-5.1: Bulk Rate Orders
**As a** logistics planner,
**I want to** rate multiple orders at once using CzarLite,
**So that** I can efficiently price a batch of shipments.

**Acceptance Criteria:**
- Select multiple unplanned orders for bulk rating
- System calls SMC3 CzarLite for LTL rates or uses contract rates for TL
- Results show rate, transit time, and carrier for each order
- Plan summary modal displays total cost and order count

### US-5.2: Lane Consolidation
**As a** logistics planner,
**I want** the system to consolidate orders on the same lane,
**So that** I can reduce costs through shipment consolidation.

**Acceptance Criteria:**
- Orders with matching origin/destination are grouped into lanes
- System evaluates consolidated vs individual shipping cost
- Consolidation savings are displayed in the plan summary
- User can choose cost-optimized or speed-optimized planning

### US-5.3: Execute Bulk Plan
**As a** logistics planner,
**I want to** execute a bulk plan to create shipments,
**So that** planned orders become active shipments.

**Acceptance Criteria:**
- Atomic execution: creates all shipments and updates all order statuses in one operation
- Each shipment gets a dock assignment based on warehouse dock configuration
- Rate ID is tracked on each shipment for audit trail
- Failure in any part rolls back the entire batch

### US-5.4: Bulk Order Import
**As a** dispatcher,
**I want to** import orders from a CSV file,
**So that** I can bulk-create orders from external systems.

**Acceptance Criteria:**
- CSV upload endpoint accepts bulk order data
- Orders are created with "Unplanned" status
- Validation errors are returned for invalid rows

---

## 6. Rate Management

### US-6.1: View Rate Matrix
**As a** rate analyst,
**I want to** view all contract rates by lane and carrier,
**So that** I can manage our rate agreements.

**Acceptance Criteria:**
- Rate table shows: lane (origin-dest), carrier, mode (TL/LTL), rate, unit, transit days, expiration date
- Filterable by mode (TL/LTL) and CzarLite flag
- CzarLite-enabled rates are visually distinguished

### US-6.2: Edit Rates
**As a** rate analyst,
**I want to** update rates for specific lanes,
**So that** our pricing stays current.

**Acceptance Criteria:**
- Inline editing of rate, transit days, and expiration
- Updates are persisted via lane-based PATCH endpoint
- Rate validation prevents invalid entries

### US-6.3: CzarLite LTL Rating
**As a** rate analyst,
**I want to** get live LTL rates from SMC3 CzarLite,
**So that** I have accurate market pricing.

**Acceptance Criteria:**
- CzarLite integration provides class-based LTL rates
- Rates are based on origin/destination ZIP, weight, and freight class
- Min/max weight boundaries are respected
- CzarLite rates are flagged separately from contract rates

### US-6.4: Freight Class Lookup
**As a** dispatcher,
**I want to** look up the NMFC freight class for a commodity,
**So that** I can correctly classify LTL shipments.

**Acceptance Criteria:**
- SMC3 classification API returns freight class for given commodity
- Class is used in LTL rate calculations

### US-6.5: Rate Export/Import
**As a** rate analyst,
**I want to** export rates to CSV and import rate updates,
**So that** I can manage rates in bulk via spreadsheets.

**Acceptance Criteria:**
- CSV export includes all rate fields
- Template download provides the correct column format
- CSV import validates and upserts rates

---

## 7. Dock Scheduling

### US-7.1: View Dock Schedule
**As a** warehouse coordinator,
**I want to** see all dock appointments on a visual grid,
**So that** I can manage dock utilization.

**Acceptance Criteria:**
- Grid displays 6 dock doors across time slots (06:00–20:00)
- Appointments are color-coded by type (Outbound, Inbound, Cross-Dock)
- Conflicts are visually highlighted

### US-7.2: Book Dock Appointment
**As a** warehouse coordinator,
**I want to** schedule a dock appointment for a shipment,
**So that** loading/unloading is organized.

**Acceptance Criteria:**
- Select dock door, date, time, duration, and appointment type
- Loading duration defaults by mode: TL 120min, LTL 90min, Air 60min
- Duration options: 30min, 1hr, 90min, 2hr, 150min, 3hr
- System checks for conflicts before booking
- Appointment statuses: Scheduled, Confirmed, In Progress, Completed, Cancelled

### US-7.3: Per-Warehouse Dock Configuration
**As an** admin,
**I want to** configure dock settings per warehouse,
**So that** each facility has the right number of doors and hours.

**Acceptance Criteria:**
- Configure: number of doors, max appointments per door, max hours per door, start/end operating hours
- Configuration is stored per warehouse in the database
- Default: 6 doors, 4 appointments/door, 14 hrs/door, 06:00–20:00

### US-7.4: Edit Dock Appointment
**As a** warehouse coordinator,
**I want to** modify or cancel a dock appointment,
**So that** I can adjust the schedule when plans change.

**Acceptance Criteria:**
- Edit appointment details (time, door, duration)
- Cancel appointment with status update
- Conflict re-validation on edit

---

## 8. Carrier Management

### US-8.1: View Carrier Directory
**As a** carrier manager,
**I want to** view all carriers with their details,
**So that** I can manage our carrier relationships.

**Acceptance Criteria:**
- Carrier list shows: name, DOT number, safety rating, CzarLite enabled status
- Search and filter capabilities

### US-8.2: Manage Carriers
**As a** carrier manager,
**I want to** add, edit, and remove carriers,
**So that** our carrier database stays current.

**Acceptance Criteria:**
- CRUD operations for carrier records
- Track carrier compliance data (insurance, DOT, certifications)

---

## 9. Carrier Portal & Tendering

### US-9.1: Send Tender Offer
**As a** dispatcher,
**I want to** send a tender offer to a carrier,
**So that** I can secure capacity for a shipment.

**Acceptance Criteria:**
- Tender offer is created with shipment details, rate, and deadline
- Email sent to carrier via SMTP integration
- Tender status is tracked (Pending, Accepted, Rejected, Expired)

### US-9.2: Carrier Tender View
**As a** carrier,
**I want to** view tender offers on the carrier portal,
**So that** I can evaluate and respond to load opportunities.

**Acceptance Criteria:**
- Tender cards display shipment details, rate, and deadline
- Tender detail modal shows full information
- Carrier can view all active tenders assigned to them

### US-9.3: Respond to Tender
**As a** carrier,
**I want to** accept or reject a tender offer,
**So that** I can confirm capacity commitment.

**Acceptance Criteria:**
- Response modal allows accept/reject with optional notes
- Acceptance triggers OMS push (shipment details sent to external system)
- Rejection updates tender status and notifies dispatcher

---

## 10. Carrier RFQ & Bidding

### US-10.1: Create RFQ
**As a** procurement manager,
**I want to** create a Request for Quote for a lane,
**So that** I can solicit competitive bids from carriers.

**Acceptance Criteria:**
- RFQ captures: lane, mode, volume, weight, equipment, deadline
- RFQ is distributed to selected carriers

### US-10.2: Compare Bids
**As a** procurement manager,
**I want to** compare carrier bids side-by-side,
**So that** I can select the best rate and service.

**Acceptance Criteria:**
- Bid comparison table shows: carrier, rate, transit time, capacity, terms
- Status badges indicate bid state (Submitted, Under Review, Awarded, Rejected)

### US-10.3: Award Bid
**As a** procurement manager,
**I want to** award a bid to the selected carrier,
**So that** the rate agreement is established.

**Acceptance Criteria:**
- Award action updates bid status and notifies carrier
- Awarded rate can be added to the rate matrix

---

## 11. Multi-Stop Routes

### US-11.1: Build Multi-Stop Route
**As a** route planner,
**I want to** create a route with multiple pickup and delivery stops,
**So that** I can optimize truckload utilization.

**Acceptance Criteria:**
- Route builder allows adding multiple stops with sequence order
- Each stop has: location, type (pickup/delivery), load sequence
- Mileage calculated between stops (PC*MILER or Haversine)

### US-11.2: Save Route Template
**As a** route planner,
**I want to** save a route as a reusable template,
**So that** recurring routes don't need to be rebuilt.

**Acceptance Criteria:**
- Route templates store stop sequence and details
- Templates can be loaded and modified for new executions

### US-11.3: Execute Multi-Stop Route
**As a** route planner,
**I want to** execute a multi-stop route,
**So that** it creates the necessary shipping documents.

**Acceptance Criteria:**
- Execution creates a Master BOL (MBOL) and individual Commodity BOLs (CBOLs) per stop
- Total cost is calculated across all stops
- Route status tracks: Active, Completed, Cancelled

### US-11.4: Auto-Match Orders to Route
**As a** route planner,
**I want** the system to automatically match unplanned orders to existing routes,
**So that** route fill rates are maximized.

**Acceptance Criteria:**
- System matches orders by origin/destination to available route stops
- Suggested matches can be reviewed and confirmed by the planner

---

## 12. Compliance & Safety

### US-12.1: HOS Compliance Tracking
**As a** compliance officer,
**I want to** monitor Hours of Service compliance for drivers,
**So that** we avoid regulatory violations.

**Acceptance Criteria:**
- Dashboard shows HOS status for active drivers
- Alerts for drivers approaching limits
- Violation tracking and reporting

### US-12.2: Weight Limit Validation
**As a** dispatcher,
**I want** the system to validate shipment weight against equipment limits,
**So that** overweight shipments are flagged before dispatch.

**Acceptance Criteria:**
- Weight validation runs during order planning
- Equipment-specific weight limits are enforced
- Overweight alerts are generated with suggested actions

### US-12.3: Hazmat Shipment Tracking
**As a** compliance officer,
**I want to** flag and track hazardous material shipments,
**So that** proper handling and documentation are ensured.

**Acceptance Criteria:**
- Hazmat flag on orders/shipments
- Hazmat-certified carrier requirement enforcement
- Hazmat document generation (placards, safety sheets)

### US-12.4: Carrier Certification Tracking
**As a** carrier manager,
**I want to** track carrier certifications and their expiration,
**So that** we only use compliant carriers.

**Acceptance Criteria:**
- Track: insurance certificates, DOT authority, hazmat endorsements
- Expiration alerts before cert lapses
- Non-compliant carriers are flagged

---

## 13. Documents

### US-13.1: Generate BOL
**As a** dispatcher,
**I want to** generate a Bill of Lading for a shipment,
**So that** the carrier has the required shipping document.

**Acceptance Criteria:**
- BOL includes: shipper/consignee info, order lines, weight, pieces, freight class, special instructions
- BOL type: Standard or Master BOL
- Document is persisted to the database with status tracking (Draft, Pending, Sent, Signed, Received, Filed)

### US-13.2: Generate POD
**As a** dispatcher,
**I want to** generate a Proof of Delivery document,
**So that** delivery completion is formally recorded.

**Acceptance Criteria:**
- POD captures: delivery date/time, receiver name, signature block, condition notes
- Linked to the originating shipment

### US-13.3: Generate Commercial Invoice
**As a** billing coordinator,
**I want to** generate a freight invoice document,
**So that** the customer can be billed.

**Acceptance Criteria:**
- Invoice includes: shipment details, line items, rates, total charges, payment terms

### US-13.4: Generate Hazmat Documents
**As a** compliance officer,
**I want to** generate hazmat certification documents,
**So that** hazardous shipments have required safety paperwork.

**Acceptance Criteria:**
- Hazmat doc includes: UN number, proper shipping name, hazard class, packing group
- Emergency contact information included

### US-13.5: View & Manage Documents
**As a** user,
**I want to** view, search, and manage all generated documents,
**So that** I can find any document quickly.

**Acceptance Criteria:**
- Document library with search by type, shipment, carrier, date
- Document viewer/renderer modal
- Status tracking for each document

---

## 14. Freight Audit

### US-14.1: Audit Carrier Invoices
**As a** freight auditor,
**I want to** compare carrier invoices against contract rates,
**So that** billing discrepancies are identified.

**Acceptance Criteria:**
- Invoice matching compares carrier charges to expected rates
- Discrepancies are flagged with variance amount
- Auto-audit flags deviations from contract rate automatically

### US-14.2: Approve/Dispute Invoices
**As a** freight auditor,
**I want to** approve, dispute, or hold invoices,
**So that** only accurate invoices are paid.

**Acceptance Criteria:**
- Workflow supports: Approve, Dispute, Hold actions
- Dispute triggers communication with carrier for resolution
- Approved invoices move to payment queue

---

## 15. Freight Invoices

### US-15.1: Create Invoice
**As a** billing coordinator,
**I want to** create freight invoices,
**So that** carriers are billed for services rendered.

**Acceptance Criteria:**
- Auto-generated invoice number
- Linked to shipment for traceability
- Captures: carrier, amount, payment terms, due date
- Due date auto-calculated based on payment terms

### US-15.2: Track Invoice Status
**As a** billing coordinator,
**I want to** track invoice payment status,
**So that** I can manage accounts receivable.

**Acceptance Criteria:**
- Statuses: Draft, Sent, Paid, Overdue, Disputed
- Filter and sort by status, carrier, amount, due date
- Stats grid shows totals by status

---

## 16. Fleet Management

### US-16.1: Manage Drivers
**As a** fleet manager,
**I want to** manage driver records,
**So that** I know who is available for assignments.

**Acceptance Criteria:**
- Driver CRUD with: name, license, HOS status, availability
- Status badges for driver availability

### US-16.2: Manage Vehicles
**As a** fleet manager,
**I want to** manage vehicle records,
**So that** I can track fleet assets.

**Acceptance Criteria:**
- Vehicle CRUD with: type, capacity, status, maintenance schedule
- Link vehicles to equipment types

---

## 17. Analytics & Reporting

### US-17.1: Spend by Mode Analysis
**As a** logistics manager,
**I want to** see freight spend broken down by mode (TL vs LTL),
**So that** I can identify cost optimization opportunities.

**Acceptance Criteria:**
- Chart shows spend distribution across TL and LTL
- Drill-down by time period, carrier, lane

### US-17.2: Carrier Scorecard
**As a** logistics manager,
**I want to** view carrier performance metrics,
**So that** I can evaluate and compare carrier performance.

**Acceptance Criteria:**
- Scorecard shows: average cost, on-time delivery %, volume, claims ratio
- Comparison across carriers

### US-17.3: Pre-Built Reports
**As a** logistics manager,
**I want to** run standardized reports,
**So that** I can analyze operations without building custom queries.

**Acceptance Criteria:**
- Available reports:
  - **Freight Spend Report** — cost breakdown by lane, carrier, mode
  - **Carrier Performance Report** — detailed carrier scorecards
  - **Lane Cost Report** — per-lane profitability analysis
  - **On-Time Delivery Report** — SLA tracking and trends
  - **Consolidation Savings Report** — impact of shipment consolidation
  - **Sustainability Report** — CO2 reduction metrics
- Reports exportable to PDF

---

## 18. Alerts & Exception Management

### US-18.1: View Alerts
**As a** dispatcher,
**I want to** see real-time alerts for exceptions and issues,
**So that** I can respond to problems quickly.

**Acceptance Criteria:**
- Alert list with severity levels: Critical, High, Medium, Low
- Categories: Delivery, Rate, Compliance, Dock
- Filter by severity, category, status
- Alert stats show counts by severity

### US-18.2: Acknowledge & Resolve Alerts
**As a** dispatcher,
**I want to** acknowledge and resolve alerts,
**So that** issues are tracked to completion.

**Acceptance Criteria:**
- Acknowledge marks the alert as seen
- Resolve closes the alert with resolution notes
- Alert history is maintained

---

## 19. Messaging Hub

### US-19.1: View Messages
**As a** system admin,
**I want to** view inbound and outbound system messages,
**So that** I can monitor integration activity.

**Acceptance Criteria:**
- Message list shows: direction (in/out), type, status, timestamp
- Message types: tender offers, WMS sync, event notifications
- JSON viewer for message payload inspection
- Filter by direction and status

### US-19.2: Compose & Send Messages
**As a** system admin,
**I want to** compose and send outbound messages,
**So that** I can manually trigger integrations.

**Acceptance Criteria:**
- Compose modal with message type and payload
- Message retry for failed deliveries
- Status tracking: Sent, Delivered, Failed

---

## 20. Master Data Management

### US-20.1: Location Master
**As an** admin,
**I want to** manage warehouse and facility locations,
**So that** the system has accurate location data.

**Acceptance Criteria:**
- CRUD for locations with: name, address, city, state, ZIP, type
- Locations available as origin/destination in orders

### US-20.2: Item Master
**As an** admin,
**I want to** manage product/SKU records,
**So that** order line items reference accurate product data.

**Acceptance Criteria:**
- CRUD for items with: SKU, description, weight, dimensions, freight class, hazmat flag

### US-20.3: Equipment Master
**As an** admin,
**I want to** manage equipment type definitions,
**So that** the correct vehicle types are available for orders.

**Acceptance Criteria:**
- CRUD for equipment types: Dry Van 53', Flatbed, Reefer, Step Deck, Lowboy, Tanker, LTL Truck, Intermodal
- Weight limits and dimensions per equipment type

### US-20.4: Lane Preferences
**As a** logistics manager,
**I want to** set preferred carriers and modes for specific lanes,
**So that** planning defaults reflect our routing strategy.

**Acceptance Criteria:**
- Define preferred/excluded carriers per lane
- Set default mode (TL/LTL) per lane
- Preferences used during automated planning

### US-20.5: Planning Parameters
**As an** admin,
**I want to** toggle system feature flags,
**So that** I can enable/disable capabilities like consolidation, dock scheduling, and CzarLite.

**Acceptance Criteria:**
- Feature flags: consolidation_enabled, dock_scheduling_enabled, czarlite_enabled
- Changes take effect immediately without restart

---

## 21. Integrations

### US-21.1: SMC3 CzarLite LTL Rating
**As a** system,
**I want to** fetch live LTL rates from SMC3 CzarLite,
**So that** LTL shipments are priced accurately.

**Acceptance Criteria:**
- API integration with SMC3 for class-based LTL rating
- Support for origin/dest ZIP, weight, freight class, and tariff
- Status endpoint to verify connectivity
- Test endpoint (ATL to DAL, 1000 lbs) for validation

### US-21.2: SMC3 CarrierConnect XL
**As a** system,
**I want to** look up carrier transit times via CarrierConnect XL,
**So that** delivery estimates are accurate.

**Acceptance Criteria:**
- Transit time lookup by origin/destination and carrier
- Licensed carrier list available via API

### US-21.3: OMS Integration
**As a** system,
**I want to** push shipment data to the external OMS on tender acceptance,
**So that** downstream systems are updated.

**Acceptance Criteria:**
- POST to OMS with shipment details on tender acceptance
- WebSocket listener for real-time updates from OMS/Middleware
- Webhook endpoint to receive notifications from Middleware

### US-21.4: PC*MILER Mileage
**As a** system,
**I want to** calculate accurate mileage between locations,
**So that** distance-based costs are correct.

**Acceptance Criteria:**
- PC*MILER integration for route mileage
- Haversine fallback when PC*MILER is unavailable
- Bulk mileage lookup for batch processing
- City-level geocoding via Nominatim

### US-21.5: SMTP Email
**As a** system,
**I want to** send emails via SMTP,
**So that** tender offers reach carriers electronically.

**Acceptance Criteria:**
- Configurable SMTP settings (host, port, credentials)
- SMTP verification on server startup
- Health check reports SMTP status

---

## 22. System Administration

### US-22.1: Tenant Settings
**As an** admin,
**I want to** configure tenant-level settings,
**So that** the system is customized for our organization.

**Acceptance Criteria:**
- Tenant configuration for branding, defaults, and preferences
- Service tier information available

### US-22.2: DB Explorer
**As an** admin,
**I want to** run SQL queries against the database,
**So that** I can inspect and troubleshoot data directly.

**Acceptance Criteria:**
- SQL editor with syntax highlighting
- Table sidebar for browsing available tables
- Results panel with formatted output
- Security whitelist limits accessible tables

### US-22.3: Customer Portal
**As a** customer,
**I want to** view my shipment status through a portal,
**So that** I have visibility into my freight.

**Acceptance Criteria:**
- Customer-facing shipment visibility table
- Access management (invite customers, manage access list)
- Filtered view showing only the customer's shipments

---

## Summary Statistics

| Category | Count |
|---|---|
| Pages / Routes | 33 |
| API Endpoints | 50+ |
| Frontend Services | 24 |
| Component Modules | 20+ |
| Database Tables | 14+ (core) + OMS + system |
| External Integrations | 5 (SMC3, OMS, SMTP, PC*MILER, Nominatim) |
| User Stories | 55 |

---

*Document generated April 12, 2026 — Zoree TMS v3*
