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
  OrderDetail: { orderId: string; edit?: boolean };
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
