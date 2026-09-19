import { NextRequest } from "next/server"
import { getAll } from "@/lib/store"
import { APP_VERSION } from "@/generated/app-version"
import { checkAdminToken, adminAuthResponse } from "@/lib/auth"
import { extractUserParam, checkUserAuth, getScopedUserId, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const rawUser = extractUserParam(req)
  const rawInvalid = !!rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)
  const scoped = getScopedUserId(rawUser)
  const rl = await rateLimit(rawInvalid ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (rawInvalid) return invalidUserResponse()
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  } else {
    // Fail-open senza ADMIN_TOKEN (istanza pubblica HF Spaces); fail-closed con token.
    if (!checkAdminToken(req)) return adminAuthResponse()
  }
  const mappings = await getAll(scoped)
  return Response.json({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    mappings,
  })
}
