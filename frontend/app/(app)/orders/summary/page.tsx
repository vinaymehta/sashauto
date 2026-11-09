"use client";

import Link from "next/link";
import { can } from "@/lib/permissions";
import { ChevronLeftIcon } from "@/components/icons";
import { OrderSummaryPanel } from "@/components/products/order-summary";
import { useSession } from "@/components/session";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";

// Orders → Order summary: the Order summary (as on Products → Order summary) on its own page, like Compare versions.
export default function OrderSummaryPage() {
  const me = useSession().user;
  return (
    <>
      <Link href="/orders" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-ink-muted transition-colors hover:text-ink">
        <ChevronLeftIcon size={15} /> Orders
      </Link>
      <PageHeader title="Order summary" description="Firm, Addition and Forecast of every part for each day with an upload, as in SASH's Excel." />
      {can(me, "products") ? (
        <OrderSummaryPanel />
      ) : (
        <Panel><EmptyState title="Not available" description="The Order summary needs the Products view permission." /></Panel>
      )}
    </>
  );
}
