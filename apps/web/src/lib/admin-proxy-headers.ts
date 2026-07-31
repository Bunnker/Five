const CLIENT_CONTROLLED_FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
] as const;

/**
 * Next's rewrite proxy fills these headers from its own socket only when the client did not supply
 * them. Removing the client values first keeps Fastify's trusted-loopback source calculation from
 * accepting an attacker-selected address.
 */
export function sanitizeAdminProxyRequestHeaders(input: Headers): Headers {
  const sanitized = new Headers(input);
  for (const name of CLIENT_CONTROLLED_FORWARDING_HEADERS) sanitized.delete(name);
  return sanitized;
}
