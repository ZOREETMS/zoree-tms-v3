import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCarrierBids } from '@zoree/shared/src/hooks/useCarrierBids';
import { SEED_BIDS } from '@zoree/shared/src/services/carrierBidsService';
import { BID_STATUSES } from '@zoree/shared/src/types/carrierBids';
import KpiCard from '../../components/ui/KpiCard';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const STATUS_BADGE_MAP: Record<string, string> = {
  [BID_STATUSES.OPEN]: 'Active',
  [BID_STATUSES.AWARDED]: 'Delivered',
  [BID_STATUSES.CLOSED]: 'Inactive',
  [BID_STATUSES.CANCELLED]: 'Cancelled',
};

export default function CarrierBidsScreen() {
  const { bids, stats, awardBid } = useCarrierBids(SEED_BIDS);

  const handleAward = useCallback(
    (rfq: any) => {
      if (rfq.responses && rfq.responses.length > 0) {
        const bestCarrier = rfq.responses.reduce((best: any, r: any) => {
          const rScore = r.score || 0;
          const bScore = best.score || 0;
          return rScore > bScore ? r : best;
        }, rfq.responses[0]);

        Alert.alert(
          'Award Bid',
          `Award ${rfq.id} to ${bestCarrier.carrier} at ${bestCarrier.rate}?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Award',
              onPress: () => awardBid(rfq.id, bestCarrier.carrier),
            },
          ],
        );
      } else {
        Alert.alert('No Bids', 'No carrier responses to award.');
      }
    },
    [awardBid],
  );

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const isOpen = item.status === BID_STATUSES.OPEN;
      const badgeStatus = STATUS_BADGE_MAP[item.status] || item.status;

      return (
        <Card style={styles.bidCard}>
          <View style={styles.bidHeader}>
            <View style={styles.bidInfo}>
              <Text style={styles.bidId}>{item.id}</Text>
              <StatusBadge status={badgeStatus} />
            </View>
          </View>

          {/* Lane */}
          <View style={styles.laneRow}>
            <Ionicons name="navigate-outline" size={16} color={colors.accent} />
            <Text style={styles.laneText} numberOfLines={1}>
              {item.lane}
            </Text>
          </View>

          {/* Details */}
          <View style={styles.detailsGrid}>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Volume</Text>
              <Text style={styles.detailValue}>
                {item.volume} loads
              </Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Deadline</Text>
              <Text style={styles.detailValue}>
                {item.deadline
                  ? new Date(item.deadline).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'N/A'}
              </Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Bids</Text>
              <Text style={styles.detailValue}>{item.bids}</Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Best Bid</Text>
              <Text style={[styles.detailValue, { color: colors.green }]}>
                {item.bestBid}
              </Text>
            </View>
          </View>

          {/* Incumbent */}
          <View style={styles.incumbentRow}>
            <Text style={styles.incumbentLabel}>Incumbent:</Text>
            <Text style={styles.incumbentValue}>{item.incumbent}</Text>
          </View>

          {/* Award Action */}
          {isOpen && item.bids > 0 && (
            <TouchableOpacity
              style={styles.awardBtn}
              activeOpacity={0.7}
              onPress={() => handleAward(item)}
            >
              <Ionicons name="trophy-outline" size={16} color={colors.white} />
              <Text style={styles.awardBtnText}>Award Bid</Text>
            </TouchableOpacity>
          )}
        </Card>
      );
    },
    [handleAward],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Carrier Bids</Text>
          <Text style={styles.subtitle}>RFQ management and bid analysis</Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <KpiCard
              label="Active RFQs"
              value={stats.activeRfqs}
              icon="document-text-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.statItem}>
            <KpiCard
              label="Total Bids"
              value={stats.totalBids}
              icon="people-outline"
              color={colors.cyan}
            />
          </View>
          <View style={styles.statItem}>
            <KpiCard
              label="Awarded"
              value={stats.awarded}
              icon="trophy-outline"
              color={colors.green}
            />
          </View>
        </View>

        {/* Bids List */}
        <FlatList
          data={bids}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={
            bids.length === 0 ? styles.emptyContainer : styles.listContent
          }
          ListEmptyComponent={
            <EmptyState
              icon="megaphone-outline"
              title="No RFQs"
              subtitle="Create an RFQ to start collecting carrier bids."
            />
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  statItem: {
    flex: 1,
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing['5xl'],
  },
  emptyContainer: {
    flexGrow: 1,
  },
  bidCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  bidHeader: {
    marginBottom: spacing.sm,
  },
  bidInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bidId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  laneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.bg4,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  laneText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
    flex: 1,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  detailCol: {
    width: '45%',
  },
  detailLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  incumbentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  incumbentLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  incumbentValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  awardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
  },
  awardBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
});
