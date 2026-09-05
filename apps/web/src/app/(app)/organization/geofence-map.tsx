'use client';

import { useEffect } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER: [number, number] = [20, 0];

const pinIcon = L.divIcon({
  className: 'sms-pin',
  html: `<svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.8 0 1 5.8 1 13c0 9.75 13 22 13 22s13-12.25 13-22C27 5.8 21.2 0 14 0Z" fill="#3B57E8"/><circle cx="14" cy="13" r="5" fill="#fff"/></svg>`,
  iconSize: [28, 36],
  iconAnchor: [14, 36],
});

function SyncView({ latitude, longitude }: { latitude: number; longitude: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 14), { animate: true });
  }, [latitude, longitude, map]);
  return null;
}

function ClickPlacer({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMove(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function GeofenceMap({
  latitude,
  longitude,
  radiusMeters,
  onMove,
  onRadius,
}: {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onMove: (lat: number, lng: number) => void;
  onRadius: (r: number) => void;
}) {
  const hasCoords = latitude !== null && longitude !== null;
  const center: [number, number] = hasCoords ? [latitude as number, longitude as number] : DEFAULT_CENTER;
  const zoom = hasCoords ? 15 : 2;

  return (
    <div className="h-full w-full min-h-64 rounded-xl overflow-hidden border border-slate-200 relative z-0">
      <MapContainer center={center} zoom={zoom} className="h-full w-full" zoomControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {hasCoords && (
          <>
            <Marker
              position={[latitude as number, longitude as number]}
              icon={pinIcon}
              draggable
              eventHandlers={{
                dragend(e) {
                  const p = e.target.getLatLng();
                  onMove(p.lat, p.lng);
                },
              }}
            />
            <Circle
              center={[latitude as number, longitude as number]}
              radius={radiusMeters}
              pathOptions={{ color: '#3B57E8', weight: 2, fillColor: '#3B57E8', fillOpacity: 0.1 }}
            />
            <SyncView latitude={latitude as number} longitude={longitude as number} />
          </>
        )}
        <ClickPlacer onMove={onMove} />
      </MapContainer>
      {hasCoords && (
        <div className="absolute bottom-2 left-2 z-[1000] flex items-center gap-2 rounded-lg bg-white/95 shadow-sm border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600">
          <span className="text-slate-400">Radius</span>
          <input
            type="number"
            min={10}
            step={10}
            value={radiusMeters}
            onChange={(e) => onRadius(Math.max(10, Number(e.target.value) || 10))}
            className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right text-xs"
          />
          <span className="text-slate-400">m — drag the pin to move it</span>
        </div>
      )}
      {!hasCoords && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <span className="rounded-lg bg-white/95 shadow-sm border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-500">
            No geofence yet — set a location below or use “Use my current location”
          </span>
        </div>
      )}
    </div>
  );
}