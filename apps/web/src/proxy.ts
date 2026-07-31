import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { sanitizeAdminProxyRequestHeaders } from "./lib/admin-proxy-headers";

export function proxy(request: NextRequest): NextResponse {
  return NextResponse.next({
    request: { headers: sanitizeAdminProxyRequestHeaders(request.headers) },
  });
}

export const config = {
  matcher: "/admin/api/:path*",
};
