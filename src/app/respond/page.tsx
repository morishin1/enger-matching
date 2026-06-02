import { RespondClient } from "./RespondClient";

export const dynamic = "force-dynamic";

export default async function RespondPage({ searchParams }: { searchParams: Promise<{ token?: string; action?: string }> }) {
    const params = await searchParams;
    return <RespondClient token={params.token ?? ""} action={params.action ?? ""} />;
}
