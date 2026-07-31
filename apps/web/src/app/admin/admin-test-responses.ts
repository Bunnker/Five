export function createAdminJsonResponse(
  body: unknown,
  options: { headers?: Record<string, string>; status?: number } = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": "request-test-admin-0001",
      ...options.headers,
    },
    status: options.status ?? 200,
  });
}

export function createAdminEmptyResponse(status = 204): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": "request-test-admin-0001",
    },
    status,
  });
}
