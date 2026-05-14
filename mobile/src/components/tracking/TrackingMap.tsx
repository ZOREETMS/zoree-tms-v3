/**
 * TrackingMap — react-native-maps wrapper for the Live Tracking screen
 * (QA #278). Renders a marker per shipment that has current_lat /
 * current_lng (or origin coords as a fallback), with a color-coded pin
 * by status.
 *
 * Graceful fallback: when no shipment has any coords we render an
 * informative empty state rather than a blank gray rectangle, so the
 * user understands the underlying data hasn't started reporting
 * positions yet (vs the map being broken).
 *
 * react-native-maps is already declared in mobile/package.json; on
 * iOS / Android the native bindings are auto-linked by Expo/RN. If
 * `MapView` import throws on web/jest, the screen still renders the
 * fallback because we catch and downgrade.
 */

import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

// Import react-native-maps defensively — if Metro can't resolve it
// (e.g. web build, snapshot tests), fall back gracefully.
let MapView: any = null;
let Marker:  any = null;
let Polyline: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const maps = require('react-native-maps');
  MapView  = maps.default || maps.MapView;
  Marker   = maps.Marker;
  Polyline = maps.Polyline;
} catch (_e) {
  MapView = null;
}

interface MarkerPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  status?: string;
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}

interface Props {
  shipments: any[];
  height?: number;
}

function pickCoord(s: any): { lat: number; lng: number } | null {
  const lat = Number(s?.current_lat ?? s?.currentLat ?? s?.origin_lat ?? s?.originLat);
  const lng = Number(s?.current_lng ?? s?.currentLng ?? s?.origin_lng ?? s?.originLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function statusColor(status?: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'in transit') return colors.accent;
  if (s === 'picked up') return colors.cyan;
  if (s === 'exception') return colors.red;
  if (s === 'delivered') return colors.green;
  return colors.text2;
}

function pointsFor(shipments: any[]): MarkerPoint[] {
  return (shipments || [])
    .map((s) => {
      const coord = pickCoord(s);
      if (!coord) return null;
      const oLat = Number(s?.origin_lat ?? s?.originLat);
      const oLng = Number(s?.origin_lng ?? s?.originLng);
      const dLat = Number(s?.destination_lat ?? s?.destinationLat);
      const dLng = Number(s?.destination_lng ?? s?.destinationLng);
      return {
        id: String(s.id || s.shipment_id || s.shipmentId || Math.random()),
        lat: coord.lat,
        lng: coord.lng,
        title: `${s.id || s.shipment_id || '—'} · ${s.status || ''}`,
        status: s.status,
        origin:
          Number.isFinite(oLat) && Number.isFinite(oLng)
            ? { lat: oLat, lng: oLng }
            : undefined,
        destination:
          Number.isFinite(dLat) && Number.isFinite(dLng)
            ? { lat: dLat, lng: dLng }
            : undefined,
      } as MarkerPoint;
    })
    .filter((p): p is MarkerPoint => p !== null);
}

function regionFor(points: MarkerPoint[]): {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
} {
  if (points.length === 0) {
    // Centred on the continental US so the empty state shows something
    // recognisable rather than the middle of the ocean.
    return {
      latitude: 39.5,
      longitude: -98.35,
      latitudeDelta: 30,
      longitudeDelta: 60,
    };
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const pad = 1.4; // headroom around the bounding box
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.5, (maxLat - minLat) * pad),
    longitudeDelta: Math.max(0.5, (maxLng - minLng) * pad),
  };
}

const TrackingMap: React.FC<Props> = ({ shipments, height = 220 }) => {
  const points = pointsFor(shipments);

  // No map library available → text fallback.
  if (!MapView) {
    return (
      <View style={[styles.fallback, { height }]}>
        <Ionicons name="map-outline" size={36} color={colors.text3} />
        <Text style={styles.fallbackTitle}>Map View</Text>
        <Text style={styles.fallbackBody}>
          Map rendering isn't available on this platform.
        </Text>
      </View>
    );
  }

  // No points → friendly empty state on top of a faded map.
  if (points.length === 0) {
    return (
      <View style={[styles.fallback, { height }]}>
        <Ionicons name="locate-outline" size={36} color={colors.text3} />
        <Text style={styles.fallbackTitle}>No tracking coordinates yet</Text>
        <Text style={styles.fallbackBody}>
          Live positions appear here once the carrier starts reporting
          shipment lat/lng. Active shipments are listed below.
        </Text>
      </View>
    );
  }

  const region = regionFor(points);

  return (
    <View style={[styles.mapWrap, { height }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: region.latitude,
          longitude: region.longitude,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
        }}
        showsUserLocation={false}
        toolbarEnabled={false}>
        {points.map((p) => (
          <React.Fragment key={p.id}>
            <Marker
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              title={p.title}
              description={p.status}
              pinColor={statusColor(p.status)}
            />
            {p.origin && p.destination ? (
              <Polyline
                coordinates={[
                  { latitude: p.origin.lat, longitude: p.origin.lng },
                  { latitude: p.lat, longitude: p.lng },
                  { latitude: p.destination.lat, longitude: p.destination.lng },
                ]}
                strokeColor={statusColor(p.status)}
                strokeWidth={2}
              />
            ) : null}
          </React.Fragment>
        ))}
      </MapView>
      {/* Subtle count badge over the map. */}
      <View style={styles.badge}>
        <Ionicons name="navigate" size={14} color={colors.accent} />
        <Text style={styles.badgeText}>
          {points.length} tracked
          {Platform.OS === 'ios' ? '' : ''}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  fallbackTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginTop: spacing.sm,
  },
  fallbackBody: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  mapWrap: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
});

export default TrackingMap;
