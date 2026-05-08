/**
 * Navigation type definitions for the Zoree TMS mobile app.
 * Maps to all 32+ screens matching the web app routes.
 */

export type RootStackParamList = {
  Login: undefined;
  App: undefined;
};

export type DrawerParamList = {
  OverviewTab: undefined;
  PlanningTab: undefined;
  // Promoted from PlanningStack to top-level drawer entries so they're
  // discoverable without having to dig through the Orders screen
  // (mirrors the web sidebar where Planning, Bulk Plan and Multi-Stop
  // Routes are all first-class items).
  BulkPlanTab: undefined;
  MultiStopTab: undefined;
  ExecutionTab: undefined;
  FinanceTab: undefined;
  DocumentsTab: undefined;
  IntegrationTab: undefined;
  InsightsTab: undefined;
  SystemTab: undefined;
};

export type BulkPlanTabParamList = {
  /**
   * Optional `initialSelectedIds` is forwarded from OrdersScreen's
   * "Plan Selected" hand-off. The Bulk Plan screen pre-selects those
   * orders so the user lands on a fully primed lane summary instead
   * of an empty page. Web parity: the OrdersPage selection bar's
   * "Plan Selected" creates shipments inline, but mobile prefers a
   * confirm-step before the cascade fires.
   */
  BulkPlan: { initialSelectedIds?: string[] } | undefined;
  BulkPlanResults: { results: any };
};

export type MultiStopTabParamList = {
  /**
   * Route templates list. Optional `selectedOrderIds` arrives via the
   * Orders screen "Create Multi-Stop Route" action — when present the
   * screen either jumps into ExecuteRouteModal (if a matching template
   * exists) or RouteFormModal (to author a new template from those
   * orders). Mirrors the web `?orderIds=` query-param flow.
   */
  MultiStopRoutes: { selectedOrderIds?: string[] } | undefined;
};

export type OverviewTabParamList = {
  Home: undefined;
  Dashboard: undefined;
};

export type PlanningTabParamList = {
  Orders: undefined;
  OrderDetail: { orderId: string };
  // OrderForm handles both create and edit, mirroring ItemForm /
  // LocationForm. Pass `orderId` to edit an existing order; omit it
  // for the New Order flow used by Dashboard → Quick Actions.
  OrderForm: { orderId?: string };
  Shipments: undefined;
  ShipmentDetail: { shipmentId: string };
  ShipmentMap: { shipmentId: string };
  ItemMaster: undefined;
  ItemDetail: { itemId: string };
  ItemForm: { itemId?: string };
  LocationMaster: undefined;
  LocationDetail: { locationId: string };
  LocationForm: { locationId?: string };
  RouteOptimizer: undefined;
  // BulkPlan / BulkPlanResults / MultiStopRoutes have been promoted to
  // their own drawer-level stacks (see BulkPlanTabParamList /
  // MultiStopTabParamList above). They're no longer registered inside
  // PlanningTabs to avoid duplicate route names.
};

export type ExecutionTabParamList = {
  LiveTracking: undefined;
  DriverTracking: { driverId: string };
  Carriers: undefined;
  CarrierDetail: { carrierId: string };
  CarrierPortal: undefined;
  DockScheduling: undefined;
  FleetManagement: undefined;
  DriverDetail: { driverId: string };
  Compliance: undefined;
};

export type FinanceTabParamList = {
  FreightInvoices: undefined;
  InvoiceDetail: { invoiceId: string };
  RateManagement: undefined;
  // EditRate handles both create and edit. Pass mode:'create' (no id) for
  // a new rate, or mode:'edit' + rateId to edit an existing row. Mirrors
  // the web EditRateModal that's invoked from RateManagementPage.
  EditRate: { mode: 'create' | 'edit'; rateId?: string };
  LanePreferences: undefined;
  CarrierBids: undefined;
  FreightAudit: undefined;
};

export type DocumentsTabParamList = {
  Documents: undefined;
  CustomerPortal: undefined;
  TrackingPortal: { shipmentId: string };
};

export type IntegrationTabParamList = {
  MessagingHub: undefined;
  ConversationDetail: { messageId: string };
};

export type InsightsTabParamList = {
  NetworkModeling: undefined;
  Analytics: undefined;
  CarrierScorecard: { carrierId: string };
  Reports: undefined;
  Alerts: undefined;
  AlertDetail: { alertId: string };
  DbExplorer: undefined;
};

export type SystemTabParamList = {
  Settings: undefined;
  Profile: undefined;
  // Phase-3: Equipment master (trailer types) — admin surface for the
  // catalog that rates / shipments / planning all read from.
  EquipmentMaster: undefined;
  // Phase-3: Planning parameters — feature toggles + dock loading
  // duration defaults that drive the planner's behavior.
  PlanningParameters: undefined;
};

// Driver-specific screens (accessible from Execution tab)
export type DriverStackParamList = {
  RouteNavigation: { routeId: string };
  StopList: { routeId: string };
  BOLCapture: { shipmentId: string };
  Signature: { shipmentId: string };
  StatusUpdate: { shipmentId: string };
  DeliveryConfirmation: { shipmentId: string };
};
