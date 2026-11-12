export type Position = {
  latitude: number; longitude: number; accuracy: number | null; altitude: number | null;
  altitudeAccuracy: number | null; heading: number | null; speed: number | null;
};

export function isPosition(value: unknown): value is Position {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const position = value as Position;
  return Number.isFinite(position.latitude) && Math.abs(position.latitude) <= 90
    && Number.isFinite(position.longitude) && Math.abs(position.longitude) <= 180
    && [position.accuracy, position.altitude, position.altitudeAccuracy, position.heading, position.speed]
      .every(field => field === null || Number.isFinite(field));
}
