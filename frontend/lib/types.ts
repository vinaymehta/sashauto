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
  address_change_count?: number | null;
  moq_alert_count?: number | null;
}

// One email sent for an upload; each kind has its own template.
export type EmailKind = "quantity_changes" | "address_changes" | "moq_alerts" | "ageing";

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

export type Direction = "increase" | "decrease";
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
  old_qty: string;
  new_qty: string;
  difference: string;
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

export interface Product {
  id: number;
  part_number: string;
  commodity_type: string | null;
  sash_part: string | null;
  vendor_part: string | null;
  description: string | null;
  moq: string | null;
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

export type ActivityKind = "changes" | "no_changes" | "baseline" | "upload_failed" | "email_failed" | "conflicts";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  description: string;
  at: string;
  href: string;
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
}

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
  group: { po_number: string; part_number: string; order_type: OrderType; description: string | null };
}

export interface RelatedItem {
  value: string;
  types: OrderType[];
  rows: number;
}

export interface OrdersPage {
  data: OrderRow[];
  meta: PageMeta & { sort?: string; direction?: "asc" | "desc" };
  // The shown upload; `latest` = the current order data (it also lists the manual orders).
  source: { uploaded_at: string; original_filename: string; upload_id: number; latest: boolean } | null;
  facets: { ship_to_locations: string[]; commodity_types: string[] } | null;
  columns?: { key: string; label: string }[];
}

export interface Vendor {
  id: number;
  name: string;
  email: string | null;
  product_count: number;
  created_at: string;
  updated_at: string;
}

export type Currency = "INR" | "USD" | "EUR" | "CNY";

export interface VendorProduct {
  id: number;
  vendor_id: number;
  product_id: number;
  part_number: string;
  commodity_type: string | null;
  sash_part: string | null;
  vendor_part: string | null;
  description: string | null;
  moq: string | null;
  weight_kg: string | null;
  price_amount: string | null;
  price_currency: Currency;
  price_note: string | null;
  updated_at: string;
}

export interface ProductVendor {
  id: number;
  vendor_id: number;
  vendor_name: string;
  price_amount: string | null;
  price_currency: Currency;
  price_note: string | null;
}

export type VendorEmailStatus = "pending" | "sent" | "failed" | "no_email";

export interface VendorOrderInfo {
  id: number;
  number: string;
  vendor_id: number;
  vendor_name: string;
  qty: string;
  price_amount: string | null;
  price_currency: Currency | null;
  price_note: string | null;
  email_status: VendorEmailStatus;
  email_recipient: string | null;
  email_sent_at: string | null;
  email_last_error: string | null;
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
  moq: string | null;
  placed_by: string | null;
  placed_at: string;
  vendor_orders: VendorOrderInfo[];
}

export interface VendorOrderWarning { vendor_order_id?: number; vendor_id: number; vendor_name: string; message: string }

export interface VendorOrderState {
  order: { id: number; po_number: string; po_line_number: string; part_number: string; order_type: OrderType; ship_date: string; qty: string | null };
  moq: string | null;
  vendors: (ProductVendor & { has_email: boolean })[];
  placement: VendorOrderPlacementInfo | null;
  warnings: VendorOrderWarning[];
  can_place: boolean;
}

export interface VendorImportResult {
  vendors_created: number;
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
