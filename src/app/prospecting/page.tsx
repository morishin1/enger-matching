import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "エンド開拓｜ENGER",
  robots: { index: false, follow: false },
};

export default function ProspectingRedirectPage() {
  redirect("/meetings?section=prospecting");
}
