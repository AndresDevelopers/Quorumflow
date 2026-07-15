import {
  looksLikeCoordinates,
  looksLikePlusCode,
  parseLatLng,
} from '@/lib/geocode-address';

describe('parseLatLng', () => {
  it('parses comma-separated coordinates', () => {
    expect(parseLatLng('-0.1807, -78.4678')).toEqual({
      lat: -0.1807,
      lon: -78.4678,
    });
  });

  it('parses space-separated coordinates', () => {
    expect(parseLatLng('40.7128  -74.0060')).toEqual({
      lat: 40.7128,
      lon: -74.006,
    });
  });

  it('rejects out-of-range values', () => {
    expect(parseLatLng('100, 0')).toBe(null);
    expect(parseLatLng('0, 200')).toBe(null);
  });

  it('rejects non-coordinate text', () => {
    expect(parseLatLng('Calle Principal 123')).toBe(null);
    expect(parseLatLng('')).toBe(null);
  });
});

describe('looksLikeCoordinates', () => {
  it('detects lat/lng strings', () => {
    expect(looksLikeCoordinates('-0.18, -78.46')).toBe(true);
    expect(looksLikeCoordinates('Av. Amazonas')).toBe(false);
  });
});

describe('looksLikePlusCode', () => {
  it('detects Open Location Codes', () => {
    expect(looksLikePlusCode('85PR+2W')).toBe(true);
    expect(looksLikePlusCode('85PR+2W Quito')).toBe(true);
    expect(looksLikePlusCode('not-a-code')).toBe(false);
  });
});
