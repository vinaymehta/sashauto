export type Role = "admin" | "warehouse_manager";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  must_change_password: boolean; // created or reset by an admin: must choose a password before using the app
  last_login_at: string | null;
  created_at: string;
}

// Response of creating a user or resetting a password. When the email could not be sent, the password is
// returned once so the admin can share it.
export interface UserCredentialsResponse {
  data: User;
  email_sent: boolean;
  password?: string;
  email_error?: string;
}

export type UploadStatus = "pending" | "processing" | "completed" | "failed";

export interface UploadSummary {
  id: number;
  version: number | null;
  status: UploadStatus;
  original_filename: string;
  byte_size: number;
  uploaded_by: string | null;
  uploaded_at: string;
  completed_at: string | null;
  failed_at: string | null;
  row_count: number | null;
  change_count: number | null;
  error_message: string | null;
}

export interface ValidationError {
  rows: number[];
  column: string | null;
  message: string;
}

export interface UploadWarning {
  code: string;
  count: number;
  message: string;
}

export interface UploadStats {
  source_row_count: number | null;
  row_count: number | null;
  duplicate_rows_merged: number | null;
  unknown_quantity_count: number | null;
  compared_count: number | null;
  increase_count: number | null;
  decrease_count: number | null;
  unchanged_count: number | null;
  new_row_count: number | null;
  missing_row_count: number | null;
  rescheduled_count?: number | null;
  address_change_count?: number | null;
  moq_alert_count?: number | null;
}

// One email sent for an upload; each kind has its own template.
export type EmailKind = "quantity_changes" | "address_changes" | "moq_alerts" | "ship_to_alerts" | "ageing";

export interface EmailInfo {
  id: number;
  kind: EmailKind;
  count: number;
  status: "pending" | "sent" | "failed";
  recipients: string[];
  subject: string;
  attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
}

export interface UploadDetail extends UploadSummary {
  file_sha256: string;
  storage_key: string | null;
  previous_version: number | null;
  error_code: string | null;
  problem_count: number;
  problem_columns: Record<string, number>;
  warnings: UploadWarning[];
  stats: UploadStats;
  emails: EmailInfo[];
}

// Per PO + PO Line + Part + Ship Date. added: only in this upload (old Qty 0); removed: only in the previous one (new Qty 0);
// rescheduled: the same Qty moved from previous_ship_date to ship_date on the same PO line (difference 0).
export type Direction = "increase" | "decrease" | "added" | "removed" | "rescheduled";
export type OrderType = "Order" | "Forecast" | "Firm";

export interface QuantityChange {
  id: number;
  po_number: string;
  po_line_number: string;
  part_number: string;
  commodity_type: string | null;
  order_type: OrderType;
  ship_date: string;
  ship_to_location: string;
  direction: Direction;
  previous_ship_date: string | null;
  old_qty: string;
  new_qty: string;
  difference: string;
  firm_date?: string | null; // the order's Firm Date (age colour)
}

export interface ProductConflict {
  id: number;
  product_id: number;
  existing_commodity_type: string | null;
  incoming_commodity_type: string;
  status: "open" | "resolved";
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  version: number | null;
  uploaded_at?: string | null;
}

// One change of a part's customer or vendor price (price history), newest first.
export interface PriceChange {
  id: number;
  kind: "customer" | "vendor";
  vendor_name: string | null;
  currency: string | null;
  source: "upload" | "manual" | "import";
  created_at: string;
  old_amount: string | null;
  new_amount: string | null;
  old_set_amount: string | null;
  new_set_amount: string | null;
  changed_by: string | null;
  upload: string | null;
}

export interface Product {
  id: number;
  part_number: string;
  commodity_type: string | null;
  sash_part: string | null;
  vendor_part: string | null;
  description: string | null;
  pack_size: number; // pieces in one set (1 = sold singly)
  moq: string | null; // MOQ in pieces
  moq_sets: string | null; // MOQ in sets — what order Qty is compared with
  moq_text: string | null; // MOQ as written in the vendor file
  customer_price: string | null; // customer's (Deere) Unit Price per 100 pcs, from the order file or edited
  weight_kg: string | null;
  source: "upload" | "manual";
  created_at: string;
  updated_at: string;
  open_conflicts: ProductConflict[];
}

export interface PageMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  from: number;
  to: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface Dashboard {
  latest_upload: UploadDetail | null;
  uploads_in_progress: number;
  open_product_conflicts: number;
  // Detections from manual order creates/edits since the latest upload.
  manual_detections: { quantity_changes: number; address_changes: number; moq_alerts: number };
}

export type ActivityKind = "changes" | "no_changes" | "baseline" | "upload_failed" | "email_failed" | "conflicts" | "delivered";

// Inbound (received at SASH US) / outbound (delivered to Deere) mark on an order, set by the Warehouse Manager.
// Order status steps: received / dispatched (SASH Faridabad, admin) → inbound / outbound (SASH US, Warehouse Manager).
export type DeliveryKind = "received" | "dispatched" | "inbound" | "outbound";
export interface OrderDeliveryInfo {
  id: number;
  kind: DeliveryKind;
  label: string;
  delivered_on: string;
  note: string | null;
  invoice_number: string | null; // SASH India invoice number (dispatched)
  marked_by: string | null;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  description: string;
  at: string;
  href: string;
  unread: boolean; // newer than the user's last "Mark as read"
}

export interface ActivityFeed {
  items: ActivityItem[];
  unread_count: number;
}

export type QuantitySource = "qty" | "previous_qty" | "unknown";

export interface SnapshotRow {
  id: number;
  ship_to_location: string;
  order_type: OrderType;
  po_number: string;
  po_line_number: string;
  part_number: string;
  ship_date: string;
  commodity_type: string | null;
  quantity_source: QuantitySource;
  current_release_number: string | null;
  source_row_numbers: number[];
  qty: string | null;
  previous_qty: string | null;
  effective_qty: string | null;
  firm_date?: string | null; // the order's Firm Date (age colour)
}

export interface SnapshotRowsPage extends Paginated<SnapshotRow> {
  ship_to_locations: string[];
}

export interface TrendPoint {
  version: number;
  completed_at: string;
  increases: number;
  decreases: number;
  compared: number | null;
  baseline: boolean;
}

export interface Stats {
  latest: (UploadSummary & { previous_version: number | null; increase_count: number | null; decrease_count: number | null;
                             compared_count: number | null; unknown_quantity_count: number | null }) | null;
  totals: {
    versions: number; failed_uploads: number; in_progress: number; products: number; open_conflicts: number;
    emails_sent: number; emails_failed: number; emails_pending: number;
  };
  last_30_days: { versions: number; increases: number; decreases: number };
  trend: TrendPoint[];
  composition: {
    by_type: Record<string, number>;
    by_quantity_source: Record<string, number>;
    by_ship_to: Record<string, number>;
    ship_dates: { first: string | null; last: string | null };
  } | null;
  top_changes: { version: number | null; upload_id?: number; completed_at?: string; changes: QuantityChange[] };
  recent_uploads: UploadSummary[];
  // Executive figures (amounts as decimal strings). Sale values are Qty × Unit Price ÷ 100 in USD; supplier values are
  // per currency (no exchange rate). without_price: orders left out because they have no price.
  // by_date: value per ship date (the graphs group it by week or month); by_vendor: open supplier value per vendor
  // and currency; series_from: first date of the spend series.
  money: {
    open_sale: MoneyTotal & { by_date: DateAmount[] };
    open_supplier: { by_currency: { currency: string; amount: string }[]; orders: number; without_price: number;
                     by_vendor: { vendor: string; currency: string; amount: string }[] };
    ytd_customer_spend: MoneyTotal & { from: string; to: string; series_from: string; by_date: DateAmount[] };
  };
  overview: DashboardOverview;
}

export interface MoneyTotal { amount: string; orders: number; without_price: number; currency: string }

// Dashboard operations figures (Dashboard::Overview), from the current order data. A bucket is a number of orders and
// their value (USD, Qty × Unit Price ÷ 100).
export interface OrderBucket { count: number; value: string }
export type PipelineStatus = "none" | "received" | "dispatched" | "inbound";
export interface DashboardOverview {
  kpis: { open: OrderBucket; due_30: OrderBucket; overdue: OrderBucket;
          po_coverage: { percent: number; covered: OrderBucket; without_po: OrderBucket } };
  pipeline: (OrderBucket & { status: PipelineStatus })[];
  ageing: (OrderBucket & { band: "red" | "yellow" | "green" | "none" })[];
  outlook: { date: string; firm: string; forecast: string }[];
  top_parts: { part_number: string; description: string | null; orders: number; qty: string; value: string }[];
  upcoming: { id: number; manual: boolean; po_number: string; po_line_number: string; part_number: string; order_type: OrderType;
              ship_date: string; qty: string; value: string; status: PipelineStatus; po: boolean; overdue: boolean }[];
}
export interface DateAmount { date: string; amount: string }

export interface OrderRow {
  id: number;
  order_type: OrderType;
  due_date: string | null;
  ship_date: string;
  unit: string | null;
  plant_code: string | null;
  po_number: string;
  po_line_number: string;
  part_number: string;
  commodity_type: string | null;
  qty: string | null;
  previous_qty: string | null;
  last_asn_qty: string | null;
  last_asn_date: string | null;
  last_receipt_qty: string | null;
  last_receipt_date: string | null;
  last_packing_list_number: string | null;
  crossdock_location: string | null;
  ship_to_location: string;
  dock_number: string | null;
  supplier_part_number: string | null;
  last_released_date: string | null;
  last_updated_date: string | null;
  quantity_source: QuantitySource;
  history_count?: number;
  source_row_number?: number | null;
  source_data?: Record<string, string | number | null>;
  manual?: boolean; // created by hand (Create order), not imported
  placed?: boolean; // has a PO generated (Orders list only)
  ordered_qty?: string | null; // sets ordered by its POs so far (Orders list only)
  kept?: boolean; // kept on Orders by a status mark, though no longer in the latest upload
  other_ship_to?: boolean; // Ship To is not the default address
  below_moq?: boolean; // the order (single or combined) is still below the part's MOQ
  moq?: string | null; // the part's MOQ (sets), sent with below_moq
  // First order of a combined order: the combined Qty and its orders (below-MOQ orders combined until the MOQ).
  combined?: { total: string; moq: string; members: { id: number; po_line_number: string; ship_date: string; qty: string; manual: boolean }[] };
  firm_date?: string | null; // from the order file, else the day the order (or the combined order it starts) first reached the MOQ
  deliveries?: Partial<Record<DeliveryKind, OrderDeliveryInfo>>; // Orders list only
}

// One field of the manual order form: an Excel column of the Supplier Requirements export.
export interface ManualOrderField {
  label: string;
  required: boolean;
  kind: "type" | "date" | "quantity" | "number" | "text";
  options?: string[];
}

export interface ManualOrderWarning {
  code: "duplicate_order" | "below_moq";
  message: string;
}

// A completed upload, to choose which upload's order data the Orders page shows.
export interface UploadChoice {
  id: number;
  original_filename: string;
  uploaded_at: string;
  completed_at: string;
  uploaded_by: string | null;
}

export interface OrderHistory {
  data: OrderRow[];
  headers: string[];
  // moq: the part's MOQ in sets (order Qty counts sets); moq_pcs: in pieces; pack_size: pieces per set.
  group: { po_number: string; part_number: string; order_type: OrderType; description: string | null; moq: string | null; moq_pcs: string | null; pack_size: number };
  combined?: ScheduleGroup[]; // combined orders among the rows (imported orders only)
}

// A combined order in the Order details Schedule. manual_ids: orders an admin added by hand; removed_ids: orders
// taken out of it; candidate_ids: orders the admin can still add; placed: its PO is generated, so it can no longer
// change.
export interface ScheduleGroup {
  anchor_id: number;
  member_ids: number[];
  manual_ids: number[];
  removed_ids: number[];
  total: string;
  moq: string;
  below_moq: boolean;
  placed: boolean;
  candidate_ids: number[];
  firm_date?: string | null; // the day the combined order reached the MOQ (null while below it)
}

export interface RelatedItem {
  value: string;
  types: OrderType[];
  rows: number;
}

// Cards above the Orders table (current order data): open Firm / Order orders not yet delivered to Deere, those with no
// vendor PO yet, those still below the MOQ, and those 90+ days since their Firm Date.
export interface OrdersSummary {
  open: number;
  po_pending: number;
  below_moq: number;
  aged: number;
}

export interface OrdersPage {
  data: OrderRow[];
  meta: PageMeta & { sort?: string; direction?: "asc" | "desc" };
  // The shown upload; `latest` = the current order data (it also lists the manual orders).
  source: { uploaded_at: string; original_filename: string; upload_id: number; latest: boolean } | null;
  facets: { ship_to_locations: string[]; commodity_types: string[] } | null;
  columns?: { key: string; label: string }[];
}

export type VendorType = "business" | "individual";
export type GstTreatment = "registered_regular" | "registered_composition" | "unregistered" | "consumer" | "overseas" | "sez" | "deemed_export";

// name: the display name used across the app; company_name: the legal name; code: the supplier acronym in PO numbers.
export interface Vendor {
  id: number;
  name: string;
  code: string | null;
  vendor_type: VendorType;
  salutation: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null; // one or several, separated by commas
  phone: string | null; // work phone
  mobile: string | null;
  language: string;
  address: string | null;
  gst: string | null;
  gst_treatment: GstTreatment | null;
  place_of_supply: string | null;
  pan: string | null;
  tax_preference: "taxable" | "tax_exempt";
  currency: Currency;
  payment_terms: string | null;
  lead_days: number | null; // days the vendor needs from the PO to dispatch
  gst_rate: string | null; // e.g. "18" or "0.1" (%)
  tax_officer_address: string | null; // jurisdictional tax officer, for the Intimation Letter
  portal_enabled: boolean;
  remarks: string | null;
  product_count: number;
  available_count: number; // parts with an "Available Parts" quantity (pieces the vendor has now)
  created_at: string;
  updated_at: string;
}

export type Currency = "INR" | "USD" | "EUR" | "CNY" | "GBP";

export interface VendorProduct {
  id: number;
  vendor_id: number;
  product_id: number;
  part_number: string;
  commodity_type: string | null;
  sash_part: string | null;
  vendor_part: string | null;
  description: string | null;
  pack_size: number;
  moq: string | null; // in pieces
  moq_sets: string | null;
  moq_text: string | null; // as written in the vendor file
  weight_kg: string | null;
  price_amount: string | null; // per piece
  set_price_amount: string | null; // per set
  price_currency: Currency;
  price_note: string | null;
  price_text: string | null; // as written in the vendor file
  updated_at: string;
  // "Available" tick: the vendor can supply this part now (the manager's check list), and who / when it last changed.
  available: boolean;
  available_qty: string | null; // "Available Parts": pieces the vendor has available now
  available_changed_at: string | null;
  available_changed_by: string | null;
  vendor_name: string;
}

export interface ProductVendor {
  id: number;
  vendor_id: number;
  vendor_name: string;
  pack_size: number;
  price_amount: string | null; // per piece
  set_price_amount: string | null; // per set
  moq: string | null; // in pieces
  moq_sets: string | null;
  moq_text: string | null;
  price_currency: Currency;
  price_note: string | null;
  price_text: string | null;
}

// A vendor order is placed in sets or in pieces; order Qty always counts sets.
export type OrderUnit = "sets" | "pcs";

export interface VendorOrderInfo {
  id: number;
  number: string;
  vendor_id: number;
  vendor_name: string;
  ship_date: string | null; // chosen when placing; null for orders placed before it existed
  qty: string;
  unit: OrderUnit;
  price_amount: string | null;
  price_currency: Currency | null;
  price_note: string | null;
  order_placed_at: string | null; // the admin ticked "Order placed" (the PO was sent to the vendor)
  order_placed_by: string | null;
  created_at: string;
}

export interface VendorOrderPlacementInfo {
  id: number;
  po_number: string;
  po_line_number: string;
  part_number: string;
  order_type: OrderType;
  ship_date: string;
  due_date: string | null;
  order_qty: string;
  ordered_qty: string; // sets this PO orders (part of the order Qty)
  moq: string | null;
  placed_by: string | null;
  placed_at: string;
  vendor_orders: VendorOrderInfo[];
}

// The email to send a vendor with its PO (the app never sends it): shown to copy, or downloaded as an .eml file.
export interface EmailDraft {
  to: string[];
  subject: string;
  body: string;
}

export interface VendorOrderWarning { vendor_order_id?: number; vendor_id: number; vendor_name: string; message: string }

export interface VendorOrderState {
  // qty: a combined order's total; combined: how many orders it combines (null when not combined); ordered / remaining:
  // sets ordered by the POs so far, and still to order.
  order: { id: number; po_number: string; po_line_number: string; part_number: string; order_type: OrderType; ship_date: string; qty: string | null;
           ordered: string; remaining: string; combined?: number | null };
  moq: string | null; // the part's MOQ in sets (order Qty counts sets)
  moq_pcs: string | null;
  pack_size: number;
  vendors: ProductVendor[];
  placements: VendorOrderPlacementInfo[]; // one per Generate PO, oldest first
  warnings: VendorOrderWarning[];
  can_place: boolean;
}

export interface VendorImportResult {
  vendors_created: number;
  products_created: number; // Part Numbers that were not in Products yet
  issues: number; // problems recorded on the Import issues tab
  added: number;
  updated: number;
  skipped: { row: number; message: string }[];
}

export interface MoqAlert {
  id: number;
  po_number: string;
  part_number: string;
  order_type: OrderType;
  ship_date: string;
  qty: string;
  moq: string;
}

export interface AddressChange {
  id: number;
  po_number: string;
  part_number: string;
  order_type: OrderType;
  ship_date: string;
  old_address: string | null;
  new_address: string | null;
}

// The fields of one vendor workbook row, as text (keys of Vendors::Importer::COLUMNS).
export type ImportRowData = Partial<Record<"part_number" | "sash_part" | "vendor_part" | "description" | "moq" | "weight_kg" | "vendor_name" | "price", string | null>>;

// A problem from a vendor workbook import: a skipped row, or a value that could not be read.
export interface ImportIssue {
  id: number;
  filename: string;
  excel_row: number;
  kind: "skipped" | "unreadable" | "vendor_details"; // vendor_details: a vendor details / tax officer row not saved
  field: string | null;
  message: string;
  row_data: ImportRowData;
  status: "open" | "resolved" | "dismissed";
  resolution: "fixed" | "deleted" | "reimported" | "linked" | "created" | null;
  created_at: string;
  resolved_at: string | null;
  imported_by: string | null;
  resolved_by: string | null;
  part_number: string | null;
  vendor_name: string | null;
  vendor_id: number | null;
  product_id: number | null;
  has_part: boolean;
  // Vendor details rows: the file ("details" can be added as a new vendor), the Vendor Code and the vendors offered first.
  source: "details" | "tax_officer" | null;
  vendor_code: string | null;
  candidates: { id: number; name: string; code: string | null }[];
}

// Result of importing the vendor master file (details) or the jurisdictional tax officer file. issues: rows not saved
// (no matching vendor, or a possible duplicate), listed on the Import issues tab.
export interface VendorDetailsImportResult {
  kind: "details" | "tax_officer";
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  issues: number;
}
