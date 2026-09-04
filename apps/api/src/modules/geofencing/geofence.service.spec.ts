import { describe, it, expect } from 'vitest';

import { GeofenceService, haversineDistanceMeters } from './geofence.service';

describe('haversineDistanceMeters', () => {
  it('returns ~0 for identical coordinates', () => {
    expect(haversineDistanceMeters({ latitude: 40.7128, longitude: -74.006 }, { latitude: 40.7128, longitude: -74.006 })).toBeCloseTo(0, 0);
  });

  it('returns the expected great-circle distance between two well-known points', () => {
    // NYC (40.7128, -74.006) -> Los Angeles (34.0522, -118.2437) ≈ 3935 km
    const meters = haversineDistanceMeters(
      { latitude: 40.7128, longitude: -74.006 },
      { latitude: 34.0522, longitude: -118.2437 },
    );
    expect(meters).toBeGreaterThan(3_850_000);
    expect(meters).toBeLessThan(4_000_000);
  });

  it('is symmetric (distance does not depend on argument order)', () => {
    const a = { latitude: 48.8566, longitude: 2.3522 };
    const b = { latitude: 51.5074, longitude: -0.1278 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 3);
  });

  it('measures ~a kilometer-scale separation for nearby points', () => {
    // ~111.32 km per degree of latitude; 0.1 degrees ≈ 11.1 km
    const meters = haversineDistanceMeters(
      { latitude: 40.7128, longitude: -74.006 },
      { latitude: 40.8128, longitude: -74.006 },
    );
    expect(meters).toBeGreaterThan(10_500);
    expect(meters).toBeLessThan(11_800);
  });
});

describe('GeofenceService.evaluate', () => {
  const service = new GeofenceService();
  const fence = { latitude: 40.7128, longitude: -74.006, radiusMeters: 100 };

  it('flags a point well inside the radius as inside', () => {
    // Very close to the fence center.
    const res = service.evaluate({ latitude: 40.7128, longitude: -74.006 }, fence);
    expect(res.inside).toBe(true);
    expect(res.distanceMeters).toBeLessThan(100);
    expect(res.radiusMeters).toBe(100);
  });

  it('flags a point far outside the radius as outside', () => {
    // ~1 km away from the center, far beyond the 100m radius.
    const res = service.evaluate({ latitude: 40.7218, longitude: -74.006 }, fence);
    expect(res.inside).toBe(false);
    expect(res.distanceMeters).toBeGreaterThan(100);
  });

  it('treats near-boundary (just inside the radius) as inside', () => {
    // ~99m due north of the center stays inside a 100m radius (boundary-inclusive).
    const res = service.evaluate({ latitude: 40.7128 + 0.00089, longitude: -74.006 }, fence);
    expect(res.inside).toBe(true);
    expect(res.distanceMeters).toBeLessThanOrEqual(100);
  });

  it('returns distance and radius explicitly and independently of the inside flag', () => {
    const res = service.evaluate({ latitude: 34.05, longitude: -118.24 }, fence);
    expect(res.distanceMeters).toBeGreaterThan(0);
    expect(res.radiusMeters).toBe(100);
    expect(res.inside).toBe(false);
  });
});
