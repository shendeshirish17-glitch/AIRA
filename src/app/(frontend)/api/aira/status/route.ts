import { providerStatus } from "@/lib/aira-server/config"
import { rateLimit } from "@/lib/aira-server/http"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const limited = rateLimit(request, "status", 60)
  if (limited) return limited
  return Response.json(providerStatus(), {
    headers: { "Cache-Control": "no-store" },
  })
}
