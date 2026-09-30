export type Role = "admin" | "warehouse_manager";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
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
}

export interface NotificationInfo {
  id: number;
  status: "pending" | "sent" | "failed";
  recipients: string[];
  subject: string;
  change_count: number;
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
  notification: NotificationInfo | null;
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
}

export interface OrdersPage {
  data: OrderRow[];
  meta: PageMeta & { sort?: string; direction?: "asc" | "desc" };
  source: { uploaded_at: string; original_filename: string; upload_id: number } | null;
}
