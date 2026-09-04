import { Injectable } from '@nestjs/common';

/**
 * Geofencing domain service (Hackathon Upgrade 2).
 *
 * All distance/containment math is computed server-side from raw coordinates.
 * The client (browser) may supply its latitude/longitude, but the "inside"
 * decision and any geofenceResult are NEVER trusted from the client.
 */

export interface GeofencePoint {
  latitude: number;
  longitude: number;
}

export interface GeofenceFence {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface GeofenceEvaluation {
  distanceMeters: number;
  radiusMeters: number;
  inside: boolean;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two coordinates (Haversine formula).
 * Deterministic and free of any external geolocation/map service.
 */
export function haversineDistanceMeters(a: GeofencePoint, b: GeofencePoint): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  // Clamp to avoid floating-point overshoot producing NaN (>1) at antipodes.
  const clamped = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(clamped));
}

@Injectable()
export class GeofenceService {
  /**
   * Evaluate a coordinate against a configured fence.
   * @returns distance from the fence center, the configured radius, and whether
   *          the point lies within the radius (boundary inclusive).
   */
  evaluate(point: GeofencePoint, fence: GeofenceFence): GeofenceEvaluation {
    const distanceMeters = haversineDistanceMeters(point, {
      latitude: fence.latitude,
      longitude: fence.longitude,
    });
    return {
      distanceMeters,
      radiusMeters: fence.radiusMeters,
      inside: distanceMeters <= fence.radiusMeters,
    };
  }
}
