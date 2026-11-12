"use client";

import Link from "next/link";
import { can } from "@/lib/permissions";
import { BusinessPicker, useBusiness } from "@/components/business-switch";
import { ChevronLeftIcon } from "@/components/icons";
import { VersionCompare } from "@/components/orders/version-compare";
import { useSession } from "@/components/session";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";

// Orders → Compare versions: two uploads of one business side by side, like a diff checker.
export default function CompareVersionsPage() {
  const me = useSession().user;
  const { view: business } = useBusiness();

  return (
    <>
      <Link href="/orders" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-ink-muted transition-colors hover:text-ink">
        <ChevronLeftIcon size={15} /> Orders
      </Link>
      <PageHeader title="Compare versions" description="What changed between two order files: the old one on the left, the new one on the right."
                  actions={<BusinessPicker />} />
      {!can(me, "orders", "edit") || me?.role === "warehouse_manager" ? (
        <Panel><EmptyState title="Not available" description={me?.role === "warehouse_manager" ? "Compare versions is not available for the Warehouse Manager."
          : "Comparing order files needs the Orders edit permission."} /></Panel>
      ) : business === "all" ? (
        <Panel><EmptyState title="Choose DTP or GMBH" description="Versions are compared within one business. Pick DTP or GMBH in the Business menu above." /></Panel>
      ) : (
        <VersionCompare key={business} business={business} />
      )}
    </>
  );
}
