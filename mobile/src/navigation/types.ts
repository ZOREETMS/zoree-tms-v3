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
  ExecutionTab: undefined;
  FinanceTab: undefined;
  DocumentsTab: undefined;
  IntegrationTab: undefined;
  InsightsTab: undefined;
  SystemTab: undefined;
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
  BulkPlan: undefined;
  BulkPlanResults: { results: any };
  MultiStopRoutes: undefined;
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
