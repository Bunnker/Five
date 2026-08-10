export const CONTRACT_POSTER_TEMPLATE_VERSION = "poster-template-v3" as const;
export const DEMO_POSTER_TEMPLATE_VERSION = "demo-poster-v1" as const;
// Content published before the structured generator adopted the contract version keeps this
// immutable snapshot value. The renderer must continue to serve those active and historical days.
export const LEGACY_AUTOMATIC_POSTER_TEMPLATE_VERSION = "automatic-poster-template-v1" as const;
