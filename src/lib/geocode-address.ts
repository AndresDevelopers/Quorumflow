/**
 * Resolve location codes (lat/lng or Plus Codes) to a human-readable address.
 * Uses OpenStreetMap Nominatim. Never returns raw coordinates as the "address".
 */

import { getAppName } from '@/lib/app-config';

export type LatLng = { lat: number; lon: number };

const NOMINATIM_HEADERS = (): HeadersInit => ({
  'User-Agent': `${getAppName()}/1.0`,
  Accept: 'application/json',
});

/** Matches plain coordinates: "-0.1807, -78.4678" or "-0.1807 -78.4678" */
const LAT_LNG_REGEX =
  /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** Open Location Code (Plus Code) full or short forms, e.g. "85PR+2W" or "85PR+2W Quito" */
const PLUS_CODE_REGEX = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/i;

/**
 * Parse a "lat, lon" string. Returns null if invalid or out of range.
 */
export function parseLatLng(input: string): LatLng | null {
  const match = input.trim().match(LAT_LNG_REGEX);
  if (!match) return null;

  const lat = Number(match[1]);
  const lon = Number(match[2]);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return { lat, lon };
}

/** True when the string looks like coordinates (lat, lng). */
export function looksLikeCoordinates(value: string): boolean {
  return parseLatLng(value) !== null;
}

/** True when the string starts with a Plus Code. */
export function looksLikePlusCode(value: string): boolean {
  return PLUS_CODE_REGEX.test(value.trim());
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${encodeURIComponent(String(lat))}` +
    `&lon=${encodeURIComponent(String(lon))}` +
    `&accept-language=es`;

  const response = await fetch(url, { headers: NOMINATIM_HEADERS() });
  if (!response.ok) return null;

  const data = (await response.json()) as { display_name?: string };
  const name = data.display_name?.trim();
  return name || null;
}

async function searchGeocode(query: string): Promise<string | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2` +
    `&q=${encodeURIComponent(query)}` +
    `&limit=1` +
    `&accept-language=es`;

  const response = await fetch(url, { headers: NOMINATIM_HEADERS() });
  if (!response.ok) return null;

  const data = (await response.json()) as Array<{ display_name?: string }>;
  const name = data[0]?.display_name?.trim();
  return name || null;
}

/**
 * Convert a location code (coordinates or Plus Code / free-text place code)
 * into a real street address string. Returns null if it cannot be resolved.
 */
export async function resolveLocationCodeToAddress(
  code: string
): Promise<string | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const coords = parseLatLng(trimmed);
  if (coords) {
    return reverseGeocode(coords.lat, coords.lon);
  }

  // Plus codes and other searchable location codes
  return searchGeocode(trimmed);
}

/**
 * Reverse-geocode GPS coordinates to a display address.
 * Does not fall back to raw "lat, lon" — returns null if lookup fails.
 */
export async function reverseGeocodeToAddress(
  lat: number,
  lon: number
): Promise<string | null> {
  return reverseGeocode(lat, lon);
}
