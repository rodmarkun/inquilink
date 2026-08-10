export const PROPERTY_COVER_STAGING_REASON = "PROPERTY_COVER_STAGING";
export const PROPERTY_COVER_STAGING_CLEANUP_REASON = "PROPERTY_COVER_STAGING_CLEANUP";
export const PROPERTY_COVER_STAGING_LEASE_MS = 5 * 60_000;

export function propertyImageStorageKey(propertyId: string, version: string): string {
  return `properties/${propertyId}/cover/${version}`;
}

export function propertyImagePath(propertyId: string, version: string): string {
  return `/api/v1/property-images/${encodeURIComponent(propertyId)}/${encodeURIComponent(version)}`;
}

export function propertyImageStorageKeyFromUrl(coverImageUrl: string | null, expectedPropertyId?: string): string | null {
  if (!coverImageUrl) return null;
  try {
    const match = new URL(coverImageUrl, "http://localhost").pathname.match(/^\/api\/v1\/property-images\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);
    if (!match?.[1] || !match[2] || (expectedPropertyId && match[1] !== expectedPropertyId)) return null;
    return propertyImageStorageKey(match[1], match[2]);
  } catch {
    return null;
  }
}
