SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: protect_finished_upload_batches(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_finished_upload_batches() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION '% of % upload batch % is not allowed', TG_OP, OLD.status, OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: protect_snapshot_rows(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_snapshot_rows() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE on order_snapshot_rows is not allowed: historical records are immutable';
  END IF;
  IF OLD.details_loaded OR NEW.id IS DISTINCT FROM OLD.id OR NEW.upload_batch_id IS DISTINCT FROM OLD.upload_batch_id OR NEW.business_key_hash IS DISTINCT FROM OLD.business_key_hash OR NEW.ship_to_location IS DISTINCT FROM OLD.ship_to_location OR NEW.order_type IS DISTINCT FROM OLD.order_type OR NEW.po_number IS DISTINCT FROM OLD.po_number OR NEW.po_line_number IS DISTINCT FROM OLD.po_line_number OR NEW.part_number IS DISTINCT FROM OLD.part_number OR NEW.ship_date IS DISTINCT FROM OLD.ship_date OR NEW.commodity_type IS DISTINCT FROM OLD.commodity_type OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.previous_qty IS DISTINCT FROM OLD.previous_qty OR NEW.effective_qty IS DISTINCT FROM OLD.effective_qty OR NEW.quantity_source IS DISTINCT FROM OLD.quantity_source OR NEW.current_release_number IS DISTINCT FROM OLD.current_release_number OR NEW.current_release_date IS DISTINCT FROM OLD.current_release_date OR NEW.source_row_numbers IS DISTINCT FROM OLD.source_row_numbers OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.due_date IS NOT NULL AND NEW.due_date IS DISTINCT FROM OLD.due_date) OR (OLD.unit IS NOT NULL AND NEW.unit IS DISTINCT FROM OLD.unit) OR (OLD.plant_code IS NOT NULL AND NEW.plant_code IS DISTINCT FROM OLD.plant_code) OR (OLD.last_asn_qty IS NOT NULL AND NEW.last_asn_qty IS DISTINCT FROM OLD.last_asn_qty) OR (OLD.last_asn_date IS NOT NULL AND NEW.last_asn_date IS DISTINCT FROM OLD.last_asn_date) OR (OLD.last_receipt_qty IS NOT NULL AND NEW.last_receipt_qty IS DISTINCT FROM OLD.last_receipt_qty) OR (OLD.last_receipt_date IS NOT NULL AND NEW.last_receipt_date IS DISTINCT FROM OLD.last_receipt_date) OR (OLD.last_packing_list_number IS NOT NULL AND NEW.last_packing_list_number IS DISTINCT FROM OLD.last_packing_list_number) OR (OLD.crossdock_location IS NOT NULL AND NEW.crossdock_location IS DISTINCT FROM OLD.crossdock_location) OR (OLD.dock_number IS NOT NULL AND NEW.dock_number IS DISTINCT FROM OLD.dock_number) OR (OLD.supplier_part_number IS NOT NULL AND NEW.supplier_part_number IS DISTINCT FROM OLD.supplier_part_number) OR (OLD.last_released_date IS NOT NULL AND NEW.last_released_date IS DISTINCT FROM OLD.last_released_date) OR (OLD.last_updated_date IS NOT NULL AND NEW.last_updated_date IS DISTINCT FROM OLD.last_updated_date) THEN
    RAISE EXCEPTION 'UPDATE on order_snapshot_rows is not allowed: historical records are immutable';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: reject_history_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: historical records are immutable', TG_OP, TG_TABLE_NAME;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: active_storage_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_attachments (
    id bigint NOT NULL,
    name character varying NOT NULL,
    record_type character varying NOT NULL,
    record_id bigint NOT NULL,
    blob_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: active_storage_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_attachments_id_seq OWNED BY public.active_storage_attachments.id;


--
-- Name: active_storage_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_blobs (
    id bigint NOT NULL,
    key character varying NOT NULL,
    filename character varying NOT NULL,
    content_type character varying,
    metadata text,
    service_name character varying NOT NULL,
    byte_size bigint NOT NULL,
    checksum character varying,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: active_storage_blobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_blobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_blobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_blobs_id_seq OWNED BY public.active_storage_blobs.id;


--
-- Name: active_storage_variant_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_variant_records (
    id bigint NOT NULL,
    blob_id bigint NOT NULL,
    variation_digest character varying NOT NULL
);


--
-- Name: active_storage_variant_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_variant_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_variant_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_variant_records_id_seq OWNED BY public.active_storage_variant_records.id;


--
-- Name: address_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.address_changes (
    id bigint NOT NULL,
    upload_batch_id bigint NOT NULL,
    previous_upload_batch_id bigint NOT NULL,
    order_row_id bigint NOT NULL,
    previous_order_row_id bigint NOT NULL,
    group_key character varying(64) NOT NULL,
    po_number character varying NOT NULL,
    part_number character varying NOT NULL,
    order_type character varying NOT NULL,
    ship_date date NOT NULL,
    old_address text,
    new_address text,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: address_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.address_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: address_changes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.address_changes_id_seq OWNED BY public.address_changes.id;


--
-- Name: ageing_digests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ageing_digests (
    id bigint NOT NULL,
    mode character varying NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    as_of date NOT NULL,
    upload_batch_id bigint,
    requested_by_id bigint,
    recipients character varying[] DEFAULT '{}'::character varying[] NOT NULL,
    subject character varying,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    provider_message_id character varying,
    last_attempt_at timestamp(6) without time zone,
    sent_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT ageing_digests_mode_valid CHECK (((mode)::text = ANY ((ARRAY['scheduled'::character varying, 'manual'::character varying, 'preview'::character varying, 'baseline'::character varying, 'upload'::character varying])::text[]))),
    CONSTRAINT ageing_digests_status_valid CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])))
);


--
-- Name: ageing_digests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ageing_digests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ageing_digests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ageing_digests_id_seq OWNED BY public.ageing_digests.id;


--
-- Name: ageing_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ageing_notifications (
    id bigint NOT NULL,
    business_key_hash character varying(64) NOT NULL,
    threshold integer NOT NULL,
    ageing_digest_id bigint NOT NULL,
    order_snapshot_row_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    order_row_id bigint,
    CONSTRAINT ageing_notifications_threshold_valid CHECK ((threshold = ANY (ARRAY[30, 60, 90])))
);


--
-- Name: ageing_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ageing_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ageing_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ageing_notifications_id_seq OWNED BY public.ageing_notifications.id;


--
-- Name: ar_internal_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_internal_metadata (
    key character varying NOT NULL,
    value character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    user_id bigint,
    action character varying NOT NULL,
    subject_type character varying,
    subject_id bigint,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address character varying,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: moq_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moq_alerts (
    id bigint NOT NULL,
    upload_batch_id bigint NOT NULL,
    order_row_id bigint NOT NULL,
    product_id bigint NOT NULL,
    group_key character varying(64) NOT NULL,
    po_number character varying NOT NULL,
    part_number character varying NOT NULL,
    order_type character varying NOT NULL,
    ship_date date NOT NULL,
    qty numeric(15,3) NOT NULL,
    moq numeric(15,3) NOT NULL,
    new_alert boolean NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: moq_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.moq_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: moq_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.moq_alerts_id_seq OWNED BY public.moq_alerts.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    upload_batch_id bigint NOT NULL,
    kind character varying NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    recipients character varying[] DEFAULT '{}'::character varying[] NOT NULL,
    subject character varying NOT NULL,
    change_count integer NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    last_attempt_at timestamp(6) without time zone,
    sent_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    provider_message_id character varying,
    address_change_count integer DEFAULT 0 NOT NULL,
    moq_alert_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT notifications_kind_valid CHECK (((kind)::text = ANY ((ARRAY['quantity_changes'::character varying, 'address_changes'::character varying, 'moq_alerts'::character varying])::text[]))),
    CONSTRAINT notifications_status_valid CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('sent'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: order_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_rows (
    id bigint NOT NULL,
    upload_batch_id bigint NOT NULL,
    source_row_number integer NOT NULL,
    group_key character varying(64) NOT NULL,
    current boolean NOT NULL,
    group_row_count integer NOT NULL,
    po_number character varying NOT NULL,
    part_number character varying NOT NULL,
    order_type character varying NOT NULL,
    ship_date date NOT NULL,
    po_line_number character varying NOT NULL,
    ship_to_location character varying NOT NULL,
    commodity_type character varying,
    qty numeric(15,3),
    previous_qty numeric(15,3),
    effective_qty numeric(15,3),
    quantity_source character varying NOT NULL,
    due_date date,
    unit character varying,
    plant_code character varying,
    last_asn_qty numeric(15,3),
    last_asn_date date,
    last_receipt_qty numeric(15,3),
    last_receipt_date date,
    last_packing_list_number character varying,
    crossdock_location character varying,
    dock_number character varying,
    supplier_part_number character varying,
    last_released_date date,
    last_updated_date date,
    source_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_columns character varying[] DEFAULT '{}'::character varying[] NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT order_rows_quantity_source_valid CHECK (((quantity_source)::text = ANY ((ARRAY['qty'::character varying, 'previous_qty'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: order_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_rows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_rows_id_seq OWNED BY public.order_rows.id;


--
-- Name: order_snapshot_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_snapshot_rows (
    id bigint NOT NULL,
    upload_batch_id bigint NOT NULL,
    business_key_hash character varying(64) NOT NULL,
    ship_to_location character varying NOT NULL,
    order_type character varying NOT NULL,
    po_number character varying NOT NULL,
    po_line_number character varying NOT NULL,
    part_number character varying NOT NULL,
    ship_date date NOT NULL,
    commodity_type character varying,
    qty numeric(15,3),
    previous_qty numeric(15,3),
    effective_qty numeric(15,3),
    quantity_source character varying NOT NULL,
    current_release_number character varying,
    current_release_date character varying,
    source_row_numbers integer[] DEFAULT '{}'::integer[] NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    due_date date,
    unit character varying,
    plant_code character varying,
    last_asn_qty numeric(15,3),
    last_asn_date date,
    last_receipt_qty numeric(15,3),
    last_receipt_date date,
    last_packing_list_number character varying,
    crossdock_location character varying,
    dock_number character varying,
    supplier_part_number character varying,
    last_released_date date,
    last_updated_date date,
    details_loaded boolean DEFAULT false NOT NULL,
    CONSTRAINT order_snapshot_rows_effective_qty_consistent CHECK ((((quantity_source)::text = 'unknown'::text) = (effective_qty IS NULL))),
    CONSTRAINT order_snapshot_rows_quantities_non_negative CHECK ((((qty IS NULL) OR (qty >= (0)::numeric)) AND ((previous_qty IS NULL) OR (previous_qty >= (0)::numeric)) AND ((effective_qty IS NULL) OR (effective_qty >= (0)::numeric)))),
    CONSTRAINT order_snapshot_rows_quantity_source_valid CHECK (((quantity_source)::text = ANY (ARRAY[('qty'::character varying)::text, ('previous_qty'::character varying)::text, ('unknown'::character varying)::text])))
);


--
-- Name: order_snapshot_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_snapshot_rows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_snapshot_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_snapshot_rows_id_seq OWNED BY public.order_snapshot_rows.id;


--
-- Name: product_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_conflicts (
    id bigint NOT NULL,
    product_id bigint NOT NULL,
    upload_batch_id bigint,
    existing_commodity_type character varying,
    incoming_commodity_type character varying NOT NULL,
    status character varying DEFAULT 'open'::character varying NOT NULL,
    resolution character varying,
    resolved_by_id bigint,
    resolved_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT product_conflicts_resolution_valid CHECK (((resolution IS NULL) OR ((resolution)::text = ANY (ARRAY[('kept_existing'::character varying)::text, ('accepted_incoming'::character varying)::text])))),
    CONSTRAINT product_conflicts_status_valid CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('resolved'::character varying)::text])))
);


--
-- Name: product_conflicts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_conflicts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_conflicts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_conflicts_id_seq OWNED BY public.product_conflicts.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id bigint NOT NULL,
    part_number character varying NOT NULL,
    commodity_type character varying,
    source character varying NOT NULL,
    created_by_id bigint,
    first_seen_upload_batch_id bigint,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    moq numeric(15,3),
    CONSTRAINT products_moq_positive CHECK (((moq IS NULL) OR (moq > (0)::numeric))),
    CONSTRAINT products_source_valid CHECK (((source)::text = ANY (ARRAY[('upload'::character varying)::text, ('manual'::character varying)::text])))
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: quantity_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quantity_changes (
    id bigint NOT NULL,
    upload_batch_id bigint NOT NULL,
    previous_upload_batch_id bigint NOT NULL,
    order_snapshot_row_id bigint,
    previous_order_snapshot_row_id bigint,
    business_key_hash character varying(64) NOT NULL,
    ship_to_location character varying NOT NULL,
    order_type character varying NOT NULL,
    po_number character varying NOT NULL,
    po_line_number character varying NOT NULL,
    part_number character varying NOT NULL,
    ship_date date NOT NULL,
    commodity_type character varying,
    old_qty numeric(15,3) NOT NULL,
    new_qty numeric(15,3) NOT NULL,
    difference numeric(15,3) NOT NULL,
    direction character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    order_row_id bigint,
    previous_order_row_id bigint,
    CONSTRAINT quantity_changes_difference_valid CHECK (((difference = (new_qty - old_qty)) AND (difference <> (0)::numeric))),
    CONSTRAINT quantity_changes_direction_valid CHECK (((((direction)::text = 'increase'::text) AND (difference > (0)::numeric)) OR (((direction)::text = 'decrease'::text) AND (difference < (0)::numeric))))
);


--
-- Name: quantity_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quantity_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quantity_changes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quantity_changes_id_seq OWNED BY public.quantity_changes.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: upload_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_batches (
    id bigint NOT NULL,
    version_number integer,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    uploaded_by_id bigint NOT NULL,
    previous_upload_batch_id bigint,
    original_filename character varying NOT NULL,
    file_sha256 character varying(64) NOT NULL,
    byte_size bigint NOT NULL,
    content_type character varying,
    source_row_count integer,
    row_count integer,
    duplicate_rows_merged integer,
    unknown_quantity_count integer,
    compared_count integer,
    increase_count integer,
    decrease_count integer,
    unchanged_count integer,
    new_row_count integer,
    missing_row_count integer,
    error_code character varying,
    error_message text,
    validation_errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    processing_started_at timestamp(6) without time zone,
    completed_at timestamp(6) without time zone,
    failed_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    address_change_count integer,
    moq_alert_count integer,
    CONSTRAINT upload_batches_status_valid CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text]))),
    CONSTRAINT upload_batches_version_iff_completed CHECK ((((status)::text = 'completed'::text) = (version_number IS NOT NULL)))
);


--
-- Name: upload_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.upload_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: upload_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.upload_batches_id_seq OWNED BY public.upload_batches.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    email character varying NOT NULL,
    name character varying NOT NULL,
    password_digest character varying NOT NULL,
    role character varying NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_login_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    notifications_seen_at timestamp(6) without time zone,
    CONSTRAINT users_role_valid CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('warehouse_manager'::character varying)::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: vendor_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_products (
    id bigint NOT NULL,
    vendor_id bigint NOT NULL,
    product_id bigint NOT NULL,
    sash_part character varying,
    vendor_part character varying,
    description text,
    moq numeric(15,3),
    weight_kg numeric(12,4),
    price_amount numeric(15,4),
    price_currency character varying(3) DEFAULT 'INR'::character varying NOT NULL,
    price_note character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT vendor_products_currency_valid CHECK (((price_currency)::text = ANY ((ARRAY['INR'::character varying, 'USD'::character varying, 'EUR'::character varying, 'CNY'::character varying])::text[]))),
    CONSTRAINT vendor_products_moq_positive CHECK (((moq IS NULL) OR (moq > (0)::numeric))),
    CONSTRAINT vendor_products_price_valid CHECK (((price_amount IS NULL) OR (price_amount >= (0)::numeric))),
    CONSTRAINT vendor_products_weight_valid CHECK (((weight_kg IS NULL) OR (weight_kg >= (0)::numeric)))
);


--
-- Name: vendor_products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_products_id_seq OWNED BY public.vendor_products.id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id bigint NOT NULL,
    name character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendors_id_seq OWNED BY public.vendors.id;


--
-- Name: active_storage_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments ALTER COLUMN id SET DEFAULT nextval('public.active_storage_attachments_id_seq'::regclass);


--
-- Name: active_storage_blobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_blobs ALTER COLUMN id SET DEFAULT nextval('public.active_storage_blobs_id_seq'::regclass);


--
-- Name: active_storage_variant_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records ALTER COLUMN id SET DEFAULT nextval('public.active_storage_variant_records_id_seq'::regclass);


--
-- Name: address_changes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_changes ALTER COLUMN id SET DEFAULT nextval('public.address_changes_id_seq'::regclass);


--
-- Name: ageing_digests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_digests ALTER COLUMN id SET DEFAULT nextval('public.ageing_digests_id_seq'::regclass);


--
-- Name: ageing_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_notifications ALTER COLUMN id SET DEFAULT nextval('public.ageing_notifications_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: moq_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moq_alerts ALTER COLUMN id SET DEFAULT nextval('public.moq_alerts_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: order_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_rows ALTER COLUMN id SET DEFAULT nextval('public.order_rows_id_seq'::regclass);


--
-- Name: order_snapshot_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_snapshot_rows ALTER COLUMN id SET DEFAULT nextval('public.order_snapshot_rows_id_seq'::regclass);


--
-- Name: product_conflicts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_conflicts ALTER COLUMN id SET DEFAULT nextval('public.product_conflicts_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: quantity_changes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_changes ALTER COLUMN id SET DEFAULT nextval('public.quantity_changes_id_seq'::regclass);


--
-- Name: upload_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_batches ALTER COLUMN id SET DEFAULT nextval('public.upload_batches_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: vendor_products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_products ALTER COLUMN id SET DEFAULT nextval('public.vendor_products_id_seq'::regclass);


--
-- Name: vendors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors ALTER COLUMN id SET DEFAULT nextval('public.vendors_id_seq'::regclass);


--
-- Name: active_storage_attachments active_storage_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments
    ADD CONSTRAINT active_storage_attachments_pkey PRIMARY KEY (id);


--
-- Name: active_storage_blobs active_storage_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_blobs
    ADD CONSTRAINT active_storage_blobs_pkey PRIMARY KEY (id);


--
-- Name: active_storage_variant_records active_storage_variant_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records
    ADD CONSTRAINT active_storage_variant_records_pkey PRIMARY KEY (id);


--
-- Name: address_changes address_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_changes
    ADD CONSTRAINT address_changes_pkey PRIMARY KEY (id);


--
-- Name: ageing_digests ageing_digests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_digests
    ADD CONSTRAINT ageing_digests_pkey PRIMARY KEY (id);


--
-- Name: ageing_notifications ageing_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_notifications
    ADD CONSTRAINT ageing_notifications_pkey PRIMARY KEY (id);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: moq_alerts moq_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moq_alerts
    ADD CONSTRAINT moq_alerts_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_rows order_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_rows
    ADD CONSTRAINT order_rows_pkey PRIMARY KEY (id);


--
-- Name: order_snapshot_rows order_snapshot_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_snapshot_rows
    ADD CONSTRAINT order_snapshot_rows_pkey PRIMARY KEY (id);


--
-- Name: product_conflicts product_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_conflicts
    ADD CONSTRAINT product_conflicts_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: quantity_changes quantity_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_changes
    ADD CONSTRAINT quantity_changes_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: upload_batches upload_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_batches
    ADD CONSTRAINT upload_batches_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendor_products vendor_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_products
    ADD CONSTRAINT vendor_products_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: index_active_storage_attachments_on_blob_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_active_storage_attachments_on_blob_id ON public.active_storage_attachments USING btree (blob_id);


--
-- Name: index_active_storage_attachments_uniqueness; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_attachments_uniqueness ON public.active_storage_attachments USING btree (record_type, record_id, name, blob_id);


--
-- Name: index_active_storage_blobs_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_blobs_on_key ON public.active_storage_blobs USING btree (key);


--
-- Name: index_active_storage_variant_records_uniqueness; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_variant_records_uniqueness ON public.active_storage_variant_records USING btree (blob_id, variation_digest);


--
-- Name: index_address_changes_on_batch_and_row; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_address_changes_on_batch_and_row ON public.address_changes USING btree (upload_batch_id, order_row_id);


--
-- Name: index_address_changes_on_order_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_address_changes_on_order_row_id ON public.address_changes USING btree (order_row_id);


--
-- Name: index_address_changes_on_previous_order_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_address_changes_on_previous_order_row_id ON public.address_changes USING btree (previous_order_row_id);


--
-- Name: index_address_changes_on_previous_upload_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_address_changes_on_previous_upload_batch_id ON public.address_changes USING btree (previous_upload_batch_id);


--
-- Name: index_ageing_digests_on_mode_and_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ageing_digests_on_mode_and_created_at ON public.ageing_digests USING btree (mode, created_at);


--
-- Name: index_ageing_digests_on_requested_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ageing_digests_on_requested_by_id ON public.ageing_digests USING btree (requested_by_id);


--
-- Name: index_ageing_digests_on_upload_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ageing_digests_on_upload_batch_id ON public.ageing_digests USING btree (upload_batch_id);


--
-- Name: index_ageing_notifications_on_ageing_digest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ageing_notifications_on_ageing_digest_id ON public.ageing_notifications USING btree (ageing_digest_id);


--
-- Name: index_ageing_notifications_on_order_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ageing_notifications_on_order_row_id ON public.ageing_notifications USING btree (order_row_id);


--
-- Name: index_ageing_notifications_on_order_snapshot_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ageing_notifications_on_order_snapshot_row_id ON public.ageing_notifications USING btree (order_snapshot_row_id);


--
-- Name: index_ageing_notifications_once_per_threshold; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_ageing_notifications_once_per_threshold ON public.ageing_notifications USING btree (business_key_hash, threshold);


--
-- Name: index_audit_logs_on_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_created_at ON public.audit_logs USING btree (created_at);


--
-- Name: index_audit_logs_on_subject_type_and_subject_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_subject_type_and_subject_id ON public.audit_logs USING btree (subject_type, subject_id);


--
-- Name: index_audit_logs_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_logs_on_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: index_moq_alerts_on_batch_and_group; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_moq_alerts_on_batch_and_group ON public.moq_alerts USING btree (upload_batch_id, group_key);


--
-- Name: index_moq_alerts_on_batch_and_new; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_moq_alerts_on_batch_and_new ON public.moq_alerts USING btree (upload_batch_id, new_alert);


--
-- Name: index_moq_alerts_on_order_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_moq_alerts_on_order_row_id ON public.moq_alerts USING btree (order_row_id);


--
-- Name: index_moq_alerts_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_moq_alerts_on_product_id ON public.moq_alerts USING btree (product_id);


--
-- Name: index_notifications_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notifications_on_status ON public.notifications USING btree (status);


--
-- Name: index_notifications_on_upload_batch_id_and_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_notifications_on_upload_batch_id_and_kind ON public.notifications USING btree (upload_batch_id, kind);


--
-- Name: index_order_rows_on_batch_and_excel_row; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_order_rows_on_batch_and_excel_row ON public.order_rows USING btree (upload_batch_id, source_row_number);


--
-- Name: index_order_rows_on_batch_current_ship_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_order_rows_on_batch_current_ship_date ON public.order_rows USING btree (upload_batch_id, current, ship_date);


--
-- Name: index_order_rows_on_batch_group_ship_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_order_rows_on_batch_group_ship_date ON public.order_rows USING btree (upload_batch_id, group_key, ship_date);


--
-- Name: index_order_rows_on_batch_part_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_order_rows_on_batch_part_po ON public.order_rows USING btree (upload_batch_id, part_number, po_number);


--
-- Name: index_order_rows_on_batch_po_part; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_order_rows_on_batch_po_part ON public.order_rows USING btree (upload_batch_id, po_number, part_number);


--
-- Name: index_order_snapshot_rows_on_batch_and_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_order_snapshot_rows_on_batch_and_key ON public.order_snapshot_rows USING btree (upload_batch_id, business_key_hash);


--
-- Name: index_product_conflicts_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_conflicts_on_product_id ON public.product_conflicts USING btree (product_id);


--
-- Name: index_product_conflicts_on_resolved_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_conflicts_on_resolved_by_id ON public.product_conflicts USING btree (resolved_by_id);


--
-- Name: index_product_conflicts_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_conflicts_on_status ON public.product_conflicts USING btree (status);


--
-- Name: index_product_conflicts_on_upload_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_product_conflicts_on_upload_batch_id ON public.product_conflicts USING btree (upload_batch_id);


--
-- Name: index_product_conflicts_one_open_per_value; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_product_conflicts_one_open_per_value ON public.product_conflicts USING btree (product_id, incoming_commodity_type) WHERE ((status)::text = 'open'::text);


--
-- Name: index_products_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_created_by_id ON public.products USING btree (created_by_id);


--
-- Name: index_products_on_first_seen_upload_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_products_on_first_seen_upload_batch_id ON public.products USING btree (first_seen_upload_batch_id);


--
-- Name: index_products_on_part_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_products_on_part_number ON public.products USING btree (part_number);


--
-- Name: index_quantity_changes_on_batch_and_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_quantity_changes_on_batch_and_key ON public.quantity_changes USING btree (upload_batch_id, business_key_hash);


--
-- Name: index_quantity_changes_on_order_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_quantity_changes_on_order_row_id ON public.quantity_changes USING btree (order_row_id);


--
-- Name: index_quantity_changes_on_order_snapshot_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_quantity_changes_on_order_snapshot_row_id ON public.quantity_changes USING btree (order_snapshot_row_id);


--
-- Name: index_quantity_changes_on_previous_order_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_quantity_changes_on_previous_order_row_id ON public.quantity_changes USING btree (previous_order_row_id);


--
-- Name: index_quantity_changes_on_previous_order_snapshot_row_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_quantity_changes_on_previous_order_snapshot_row_id ON public.quantity_changes USING btree (previous_order_snapshot_row_id);


--
-- Name: index_quantity_changes_on_previous_upload_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_quantity_changes_on_previous_upload_batch_id ON public.quantity_changes USING btree (previous_upload_batch_id);


--
-- Name: index_snapshot_rows_on_batch_and_part; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_snapshot_rows_on_batch_and_part ON public.order_snapshot_rows USING btree (upload_batch_id, part_number);


--
-- Name: index_snapshot_rows_on_batch_and_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_snapshot_rows_on_batch_and_po ON public.order_snapshot_rows USING btree (upload_batch_id, po_number, po_line_number);


--
-- Name: index_snapshot_rows_on_batch_and_ship_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_snapshot_rows_on_batch_and_ship_date ON public.order_snapshot_rows USING btree (upload_batch_id, ship_date);


--
-- Name: index_upload_batches_on_completed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_upload_batches_on_completed_at ON public.upload_batches USING btree (completed_at);


--
-- Name: index_upload_batches_on_failed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_upload_batches_on_failed_at ON public.upload_batches USING btree (failed_at);


--
-- Name: index_upload_batches_on_file_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_upload_batches_on_file_sha256 ON public.upload_batches USING btree (file_sha256);


--
-- Name: index_upload_batches_on_previous_upload_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_upload_batches_on_previous_upload_batch_id ON public.upload_batches USING btree (previous_upload_batch_id);


--
-- Name: index_upload_batches_on_status_and_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_upload_batches_on_status_and_created_at ON public.upload_batches USING btree (status, created_at);


--
-- Name: index_upload_batches_on_uploaded_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_upload_batches_on_uploaded_by_id ON public.upload_batches USING btree (uploaded_by_id);


--
-- Name: index_upload_batches_on_version_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_upload_batches_on_version_number ON public.upload_batches USING btree (version_number);


--
-- Name: index_users_on_lower_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_lower_email ON public.users USING btree (lower((email)::text));


--
-- Name: index_vendor_products_on_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_vendor_products_on_product_id ON public.vendor_products USING btree (product_id);


--
-- Name: index_vendor_products_on_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_vendor_products_on_vendor_id ON public.vendor_products USING btree (vendor_id);


--
-- Name: index_vendor_products_on_vendor_id_and_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_vendor_products_on_vendor_id_and_product_id ON public.vendor_products USING btree (vendor_id, product_id);


--
-- Name: index_vendors_on_lower_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_vendors_on_lower_name ON public.vendors USING btree (lower((name)::text));


--
-- Name: address_changes address_changes_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER address_changes_append_only BEFORE DELETE OR UPDATE ON public.address_changes FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();


--
-- Name: audit_logs audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_append_only BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();


--
-- Name: moq_alerts moq_alerts_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER moq_alerts_append_only BEFORE DELETE OR UPDATE ON public.moq_alerts FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();


--
-- Name: order_rows order_rows_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_rows_append_only BEFORE DELETE OR UPDATE ON public.order_rows FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();


--
-- Name: order_snapshot_rows order_snapshot_rows_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_snapshot_rows_append_only BEFORE DELETE OR UPDATE ON public.order_snapshot_rows FOR EACH ROW EXECUTE FUNCTION public.protect_snapshot_rows();


--
-- Name: quantity_changes quantity_changes_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quantity_changes_append_only BEFORE DELETE OR UPDATE ON public.quantity_changes FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();


--
-- Name: upload_batches upload_batches_protect_finished; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER upload_batches_protect_finished BEFORE DELETE OR UPDATE ON public.upload_batches FOR EACH ROW EXECUTE FUNCTION public.protect_finished_upload_batches();


--
-- Name: address_changes fk_rails_02702585ce; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_changes
    ADD CONSTRAINT fk_rails_02702585ce FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: ageing_notifications fk_rails_0e43f85aef; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_notifications
    ADD CONSTRAINT fk_rails_0e43f85aef FOREIGN KEY (ageing_digest_id) REFERENCES public.ageing_digests(id);


--
-- Name: audit_logs fk_rails_1f26bc34ae; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT fk_rails_1f26bc34ae FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: product_conflicts fk_rails_1f3c3cb0b7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_conflicts
    ADD CONSTRAINT fk_rails_1f3c3cb0b7 FOREIGN KEY (resolved_by_id) REFERENCES public.users(id);


--
-- Name: ageing_notifications fk_rails_2dda75e39b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_notifications
    ADD CONSTRAINT fk_rails_2dda75e39b FOREIGN KEY (order_snapshot_row_id) REFERENCES public.order_snapshot_rows(id);


--
-- Name: ageing_digests fk_rails_351ea1f8a1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_digests
    ADD CONSTRAINT fk_rails_351ea1f8a1 FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: vendor_products fk_rails_443e06182c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_products
    ADD CONSTRAINT fk_rails_443e06182c FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: product_conflicts fk_rails_45ae6305cd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_conflicts
    ADD CONSTRAINT fk_rails_45ae6305cd FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: notifications fk_rails_4777f8bf05; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_rails_4777f8bf05 FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: quantity_changes fk_rails_499d631071; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_changes
    ADD CONSTRAINT fk_rails_499d631071 FOREIGN KEY (previous_upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: ageing_notifications fk_rails_53aeabf9c2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_notifications
    ADD CONSTRAINT fk_rails_53aeabf9c2 FOREIGN KEY (order_row_id) REFERENCES public.order_rows(id);


--
-- Name: moq_alerts fk_rails_5735834603; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moq_alerts
    ADD CONSTRAINT fk_rails_5735834603 FOREIGN KEY (order_row_id) REFERENCES public.order_rows(id);


--
-- Name: quantity_changes fk_rails_6db61947e6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_changes
    ADD CONSTRAINT fk_rails_6db61947e6 FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: quantity_changes fk_rails_90ce969403; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_changes
    ADD CONSTRAINT fk_rails_90ce969403 FOREIGN KEY (order_row_id) REFERENCES public.order_rows(id);


--
-- Name: active_storage_variant_records fk_rails_993965df05; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records
    ADD CONSTRAINT fk_rails_993965df05 FOREIGN KEY (blob_id) REFERENCES public.active_storage_blobs(id);


--
-- Name: ageing_digests fk_rails_a8bc51aaf0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ageing_digests
    ADD CONSTRAINT fk_rails_a8bc51aaf0 FOREIGN KEY (requested_by_id) REFERENCES public.users(id);


--
-- Name: products fk_rails_aefb4f3a33; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_rails_aefb4f3a33 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: moq_alerts fk_rails_b49d84f22c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moq_alerts
    ADD CONSTRAINT fk_rails_b49d84f22c FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: order_snapshot_rows fk_rails_b4e1f58c36; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_snapshot_rows
    ADD CONSTRAINT fk_rails_b4e1f58c36 FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: address_changes fk_rails_b7aaec717a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_changes
    ADD CONSTRAINT fk_rails_b7aaec717a FOREIGN KEY (previous_upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: quantity_changes fk_rails_bb0c15f79e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_changes
    ADD CONSTRAINT fk_rails_bb0c15f79e FOREIGN KEY (previous_order_row_id) REFERENCES public.order_rows(id);


--
-- Name: upload_batches fk_rails_c39769a808; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_batches
    ADD CONSTRAINT fk_rails_c39769a808 FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id);


--
-- Name: active_storage_attachments fk_rails_c3b3935057; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments
    ADD CONSTRAINT fk_rails_c3b3935057 FOREIGN KEY (blob_id) REFERENCES public.active_storage_blobs(id);


--
-- Name: moq_alerts fk_rails_d1ebb4b42e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moq_alerts
    ADD CONSTRAINT fk_rails_d1ebb4b42e FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: quantity_changes fk_rails_dba99be903; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_changes
    ADD CONSTRAINT fk_rails_dba99be903 FOREIGN KEY (order_snapshot_row_id) REFERENCES public.order_snapshot_rows(id);


--
-- Name: vendor_products fk_rails_dc716d7803; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_products
    ADD CONSTRAINT fk_rails_dc716d7803 FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: order_rows fk_rails_dde6d74b6b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_rows
    ADD CONSTRAINT fk_rails_dde6d74b6b FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: product_conflicts fk_rails_f74a21bb34; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_conflicts
    ADD CONSTRAINT fk_rails_f74a21bb34 FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: quantity_changes fk_rails_f76a2d5734; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_changes
    ADD CONSTRAINT fk_rails_f76a2d5734 FOREIGN KEY (previous_order_snapshot_row_id) REFERENCES public.order_snapshot_rows(id);


--
-- Name: products fk_rails_f774f6fc1a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_rails_f774f6fc1a FOREIGN KEY (first_seen_upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: address_changes fk_rails_fcc4488252; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_changes
    ADD CONSTRAINT fk_rails_fcc4488252 FOREIGN KEY (previous_order_row_id) REFERENCES public.order_rows(id);


--
-- Name: upload_batches fk_rails_fced93fee8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_batches
    ADD CONSTRAINT fk_rails_fced93fee8 FOREIGN KEY (previous_upload_batch_id) REFERENCES public.upload_batches(id);


--
-- Name: address_changes fk_rails_fdaf55e9ac; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_changes
    ADD CONSTRAINT fk_rails_fdaf55e9ac FOREIGN KEY (order_row_id) REFERENCES public.order_rows(id);


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('20261001160001'),
('20261001140001'),
('20261001120001'),
('20261001090001'),
('20260930170001'),
('20260930150001'),
('20260930120001'),
('20260930090001'),
('20260929120001'),
('20260929100001'),
('20260929090009'),
('20260929090008'),
('20260929090007'),
('20260929090006'),
('20260929090005'),
('20260929090004'),
('20260929090003'),
('20260929090002'),
('20260929090001'),
('20260929085914');

