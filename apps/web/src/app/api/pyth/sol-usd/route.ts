import { NextResponse } from "next/server";
import { fetchHermesSolUsd, hermesBaseUrls } from "../../../../lib/pythUpdate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-side Hermes fetch so `PYTH_API_KEY` stays out of the browser bundle.
 * The key is read from the environment (apps/web/.env.local). Never commit it.
 */
export async function GET() {
  try {
    const data = await fetchHermesSolUsd({
      apiKey: process.env.PYTH_API_KEY,
      urls: hermesBaseUrls(process.env.PYTH_HERMES_URL),
    });
    return NextResponse.json({ data: data.toString("base64") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hermes request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
