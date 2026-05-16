import React, { useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { exportRowsAsCsv } from '../../services/csvExport';
import { useData } from '../../state/DataContext';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

// Compliance constants
const HOS_MAX_HOURS = 11;

// Seed data from shared compliance service
const SEED_HOS = [
  { driver: 'James Wilson', vehicle: 'TRK-101', hoursToday: 9.5, remaining: 1.5, status: 'Warning', violation: '' },
  { driver: 'Maria Santos', vehicle: 'TRK-102', hoursToday: 7.2, remaining: 3.8, status: 'OK', violation: '' },
  { driver: 'David Chen', vehicle: 'TRK-103', hoursToday: 11.1, remaining: 0, status: 'Violation', violation: 'Exceeded 11-hr driving limit' },
  { driver: 'Linda Park', vehicle: 'TRK-105', hoursToday: 8.4, remaining: 2.6, status: 'OK', violation: '' },
  { driver: 'Carlos Rivera', vehicle: 'TRK-106', hoursToday: 6.0, remaining: 5.0, status: 'OK', violation: '' },
  { driver: 'Amy Johnson', vehicle: 'TRK-107', hoursToday: 10.2, remaining: 0.8, status: 'Warning', violation: '' },
  { driver: 'Tom Bradley', vehicle: 'TRK-109', hoursToday: 9.8, remaining: 1.2, status: 'Warning', violation: '' },
  { driver: 'Rachel Kim', vehicle: 'TRK-110', hoursToday: 7.5, remaining: 3.5, status: 'OK', violation: '' },
];

const SEED_WEIGHTS = [
  { ship: 'SHP-2024-1840', weight: 28400, limit: 80000, axleOk: true, permitReq: false, status: 'Pass' },
  { ship: 'SHP-2024-1844', weight: 42000, limit: 80000, axleOk: true, permitReq: false, status: 'Pass' },
  { ship: 'SHP-2024-1845', weight: 79500, limit: 80000, axleOk: false, permitReq: true, status: 'Warning' },
  { ship: 'SHP-2024-1848', weight: 32100, limit: 80000, axleOk: true, permitReq: false, status: 'Pass' },
  { ship: 'SHP-2024-1851', weight: 81200, limit: 80000, axleOk: false, permitReq: true, status: 'Fail' },
];

const SEED_HAZMAT = [
  { ship: 'SHP-2024-1851', class: 'Class 3 - Flammable Liquid', carrier: 'JB Hunt', certified: true, placardOk: true, status: 'Compliant' },
  { ship: 'SHP-2024-1848', class: 'Class 8 - Corrosive', carrier: 'XPO Logistics', certified: true, placardOk: true, status: 'Compliant' },
  { ship: 'SHP-2024-1843', class: 'Class 9 - Misc.', carrier: 'FedEx Freight', certified: true, placardOk: false, status: 'Warning' },
];

type SectionKey = 'hos' | 'weight' | 'hazmat';

// Map compliance statuses to StatusBadge-compatible statuses
const COMPLIANCE_STATUS_MAP: Record<string, string> = {
  OK: 'Active',
  Pass: 'Active',
  Compliant: 'Active',
  Warning: 'Warning',
  Violation: 'Error',
  Fail: 'Error',
};

export default function ComplianceScreen() {
  const { data } = useData();
  const [activeSection, setActiveSection] = useState<SectionKey>('hos');

  // QA #323 — Carrier Certification Status. Derives a compact status
  // per carrier from whatever certification-adjacent fields the row
  // carries. The exact column names vary across tenants so we read
  // through a permissive set of aliases; missing data renders as
  // "Not on file" rather than a hard failure.
  const carrierCerts = useMemo(() => {
    const carriers = Array.isArray(data.carriers) ? data.carriers : [];
    return carriers.slice(0, 6).map((c: any) => {
      const hazmat = c.hazmat_certified ?? c.hazmatCertified ?? c.is_hazmat_certified;
      const insurance = c.insurance_active ?? c.insuranceActive ?? c.insurance_status;
      const authority = c.mc_authority ?? c.mcAuthority ?? c.operating_authority;
      const insExp = c.insurance_expires ?? c.insuranceExpires ?? c.insurance_expiry;
      // Translate the per-carrier signals into a single overall status.
      let status: 'Compliant' | 'Warning' | 'Expired' | 'Unknown' = 'Unknown';
      const isExpired = (() => {
        if (!insExp) return false;
        const t = new Date(insExp).getTime();
        return Number.isFinite(t) && t < Date.now();
      })();
      if (isExpired) status = 'Expired';
      else if (insurance === false || insurance === 'inactive') status = 'Warning';
      else if (insurance === true || insurance === 'active') status = 'Compliant';
      return {
        id: c.id || c.scac || c.name,
        name: c.name || c.scac || 'Unknown carrier',
        hazmat: hazmat === true || hazmat === 'yes' || hazmat === 'true',
        authority: authority || null,
        insurance: insurance == null ? null : Boolean(insurance === true || insurance === 'active'),
        insExp: insExp || null,
        status,
      };
    });
  }, [data.carriers]);
  const carrierCertsTotal = Array.isArray(data.carriers) ? data.carriers.length : 0;

  const stats = useMemo(() => {
    const hosWarnings = SEED_HOS.filter((h) => h.status === 'Warning').length;
    const hosViolations = SEED_HOS.filter((h) => h.status === 'Violation').length;
    const weightFails = SEED_WEIGHTS.filter((w) => w.status === 'Fail').length;
    const weightWarnings = SEED_WEIGHTS.filter((w) => w.status === 'Warning').length;
    const totalChecked = SEED_HOS.length + SEED_WEIGHTS.length;
    const totalIssues = hosWarnings + hosViolations + weightFails;
    const compliantPct = totalChecked > 0
      ? Math.round(((totalChecked - totalIssues) / totalChecked) * 100)
      : 100;

    return {
      compliantPct,
      violations: hosViolations + weightFails,
      warnings: hosWarnings + weightWarnings,
      hazmatShipments: SEED_HAZMAT.length,
    };
  }, []);

  const getHosPct = (hours: number) =>
    Math.min(100, Math.round((hours / HOS_MAX_HOURS) * 100));

  const renderHosItem = ({ item }: { item: typeof SEED_HOS[0] }) => (
    <Card style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleRow}>
          <Ionicons name="person-outline" size={16} color={colors.accent} />
          <Text style={styles.itemTitle}>{item.driver}</Text>
        </View>
        <StatusBadge status={COMPLIANCE_STATUS_MAP[item.status] || item.status} />
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Vehicle</Text>
          <Text style={styles.detailValue}>{item.vehicle}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Hours Today</Text>
          <Text style={styles.detailValue}>{item.hoursToday}h / {HOS_MAX_HOURS}h</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Remaining</Text>
          <Text style={[styles.detailValue, item.remaining <= 1 && { color: colors.red }]}>
            {item.remaining}h
          </Text>
        </View>
        {/* HOS bar */}
        <View style={styles.hosBarContainer}>
          <View style={styles.hosBarBg}>
            <View
              style={[
                styles.hosBarFill,
                {
                  width: `${getHosPct(item.hoursToday)}%`,
                  backgroundColor:
                    item.status === 'Violation'
                      ? colors.red
                      : item.status === 'Warning'
                      ? colors.yellow
                      : colors.green,
                },
              ]}
            />
          </View>
          <Text style={styles.hosBarText}>{getHosPct(item.hoursToday)}%</Text>
        </View>
        {item.violation ? (
          <View style={styles.violationRow}>
            <Ionicons name="alert-circle" size={14} color={colors.red} />
            <Text style={styles.violationText}>{item.violation}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );

  const renderWeightItem = ({ item }: { item: typeof SEED_WEIGHTS[0] }) => (
    <Card style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleRow}>
          <Ionicons name="cube-outline" size={16} color={colors.accent} />
          <Text style={styles.itemTitle}>{item.ship}</Text>
        </View>
        <StatusBadge status={COMPLIANCE_STATUS_MAP[item.status] || item.status} />
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Weight</Text>
          <Text style={styles.detailValue}>{item.weight.toLocaleString()} lbs</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Limit</Text>
          <Text style={styles.detailValue}>{item.limit.toLocaleString()} lbs</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Axle Check</Text>
          <Ionicons
            name={item.axleOk ? 'checkmark-circle' : 'close-circle'}
            size={18}
            color={item.axleOk ? colors.green : colors.red}
          />
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Permit Required</Text>
          <Text style={[styles.detailValue, item.permitReq && { color: colors.yellow }]}>
            {item.permitReq ? 'Yes' : 'No'}
          </Text>
        </View>
      </View>
    </Card>
  );

  const renderHazmatItem = ({ item }: { item: typeof SEED_HAZMAT[0] }) => (
    <Card style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleRow}>
          <Ionicons name="warning-outline" size={16} color={colors.yellow} />
          <Text style={styles.itemTitle}>{item.ship}</Text>
        </View>
        <StatusBadge status={COMPLIANCE_STATUS_MAP[item.status] || item.status} />
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Class</Text>
          <Text style={styles.detailValue} numberOfLines={1}>{item.class}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Carrier</Text>
          <Text style={styles.detailValue}>{item.carrier}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Certified</Text>
          <Ionicons
            name={item.certified ? 'checkmark-circle' : 'close-circle'}
            size={18}
            color={item.certified ? colors.green : colors.red}
          />
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Placard OK</Text>
          <Ionicons
            name={item.placardOk ? 'checkmark-circle' : 'close-circle'}
            size={18}
            color={item.placardOk ? colors.green : colors.red}
          />
        </View>
      </View>
    </Card>
  );

  const SECTIONS: { key: SectionKey; label: string; icon: keyof typeof Ionicons.glyphMap; count: number }[] = [
    { key: 'hos', label: 'HOS', icon: 'time-outline', count: SEED_HOS.length },
    { key: 'weight', label: 'Weight', icon: 'scale-outline', count: SEED_WEIGHTS.length },
    { key: 'hazmat', label: 'Hazmat', icon: 'warning-outline', count: SEED_HAZMAT.length },
  ];

  const renderList = () => {
    switch (activeSection) {
      case 'hos':
        return (
          <FlatList
            data={SEED_HOS}
            renderItem={renderHosItem}
            keyExtractor={(item) => item.driver}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<EmptyState icon="time-outline" title="No HOS data" />}
          />
        );
      case 'weight':
        return (
          <FlatList
            data={SEED_WEIGHTS}
            renderItem={renderWeightItem}
            keyExtractor={(item) => item.ship}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<EmptyState icon="scale-outline" title="No weight data" />}
          />
        );
      case 'hazmat':
        return (
          <FlatList
            data={SEED_HAZMAT}
            renderItem={renderHazmatItem}
            keyExtractor={(item) => item.ship}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<EmptyState icon="warning-outline" title="No hazmat data" />}
          />
        );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Header — QA #283 parity adds an inline Export Report button. */}
        <View style={styles.header}>
          <Ionicons name="shield-checkmark-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Compliance</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => {
              // QA #283 — Export the active section's rows as CSV. The
              // column shape changes per section so we branch and feed
              // exportRowsAsCsv a section-appropriate spec.
              if (activeSection === 'hos') {
                exportRowsAsCsv(
                  SEED_HOS,
                  [
                    { key: 'driver',     header: 'Driver' },
                    { key: 'vehicle',    header: 'Vehicle' },
                    { key: 'hoursToday', header: 'Hours Today' },
                    { key: 'remaining',  header: 'Hours Remaining' },
                    { key: 'status',     header: 'Status' },
                    { key: 'violation',  header: 'Violation' },
                  ],
                  { title: 'HOS Compliance', filename: 'compliance_hos.csv' },
                );
              } else if (activeSection === 'weight') {
                exportRowsAsCsv(
                  SEED_WEIGHTS,
                  [
                    { key: 'ship',      header: 'Shipment' },
                    { key: 'weight',    header: 'Weight (lbs)' },
                    { key: 'limit',     header: 'Limit (lbs)' },
                    { key: 'axleOk',    header: 'Axles OK' },
                    { key: 'permitReq', header: 'Permit Required' },
                    { key: 'status',    header: 'Status' },
                  ],
                  { title: 'Weight Compliance', filename: 'compliance_weight.csv' },
                );
              } else {
                exportRowsAsCsv(
                  SEED_HAZMAT,
                  [
                    { key: 'ship',      header: 'Shipment' },
                    { key: 'class',     header: 'Hazmat Class' },
                    { key: 'carrier',   header: 'Carrier' },
                    { key: 'certified', header: 'Certified' },
                    { key: 'placardOk', header: 'Placards OK' },
                    { key: 'status',    header: 'Status' },
                  ],
                  { title: 'Hazmat Compliance', filename: 'compliance_hazmat.csv' },
                );
              }
            }}
            style={styles.exportBtn}
            accessibilityRole="button"
            accessibilityLabel="Export compliance report as CSV">
            <Ionicons name="download-outline" size={16} color={colors.accent} />
            <Text style={styles.exportText}>Export Report</Text>
          </TouchableOpacity>
        </View>

        {/* KPI cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kpiRow}
          style={styles.kpiScroll}
        >
          <KpiCard
            label="Compliance Rate"
            value={`${stats.compliantPct}%`}
            icon="shield-checkmark-outline"
            color={stats.compliantPct >= 90 ? colors.green : colors.yellow}
          />
          <KpiCard
            label="Violations"
            value={stats.violations}
            icon="alert-circle-outline"
            color={colors.red}
          />
          <KpiCard
            label="Warnings"
            value={stats.warnings}
            icon="warning-outline"
            color={colors.yellow}
          />
          <KpiCard
            label="Hazmat Shipments"
            value={stats.hazmatShipments}
            icon="flask-outline"
            color={colors.purple}
          />
        </ScrollView>

        {/* QA #323 — Carrier Certification Status. Shows up to 6
            carriers with their hazmat / insurance / authority status
            at a glance, plus a "View all" affordance pointing at the
            Carriers screen for the full roster. Mirrors the web
            Compliance "Carrier Certification Status" panel. */}
        {carrierCertsTotal > 0 ? (
          <Card style={styles.certCard}>
            <View style={styles.certHeader}>
              <View style={styles.certTitleRow}>
                <Ionicons name="ribbon-outline" size={16} color={colors.accent} />
                <Text style={styles.certTitle}>Carrier Certification Status</Text>
              </View>
              <Text style={styles.certMeta}>{carrierCertsTotal} carrier{carrierCertsTotal === 1 ? '' : 's'}</Text>
            </View>
            {carrierCerts.length === 0 ? (
              <Text style={styles.certEmpty}>No carriers on file.</Text>
            ) : (
              carrierCerts.map((c: any) => (
                <View key={`cert-${c.id}`} style={styles.certRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.certName} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.certSub} numberOfLines={1}>
                      {[
                        c.hazmat ? 'Hazmat ✓' : 'Hazmat —',
                        c.insurance === true ? 'Insurance ✓' : c.insurance === false ? 'Insurance ✗' : 'Insurance —',
                        c.authority ? `Authority ${c.authority}` : 'Authority —',
                      ].join('  ·  ')}
                    </Text>
                  </View>
                  <StatusBadge status={
                    c.status === 'Compliant' ? 'Active'
                    : c.status === 'Warning' ? 'Warning'
                    : c.status === 'Expired' ? 'Error'
                    : 'Inactive'
                  } />
                </View>
              ))
            )}
          </Card>
        ) : null}

        {/* Section tabs */}
        <View style={styles.tabContainer}>
          {SECTIONS.map((section) => (
            <TouchableOpacity
              key={section.key}
              style={[styles.tab, activeSection === section.key && styles.tabActive]}
              onPress={() => setActiveSection(section.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={section.icon}
                size={16}
                color={activeSection === section.key ? colors.accent : colors.text2}
              />
              <Text
                style={[
                  styles.tabLabel,
                  activeSection === section.key && styles.tabLabelActive,
                ]}
              >
                {section.label} ({section.count})
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Section list */}
        {renderList()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  exportText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  kpiScroll: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  kpiRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  // QA #323 — Carrier Certification Status card.
  certCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  certHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  certTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  certTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  certMeta: {
    fontSize: fontSize.xs,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  certRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  certName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  certSub: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  certEmpty: {
    fontSize: fontSize.sm,
    color: colors.text3,
    fontStyle: 'italic',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.lg,
    padding: spacing.xs,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  tabActive: {
    backgroundColor: colors.bg2,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  tabLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  tabLabelActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['5xl'],
    flexGrow: 1,
  },
  itemCard: {
    marginBottom: spacing.md,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  itemTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  itemDetails: {
    gap: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },
  hosBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  hosBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  hosBarFill: {
    height: '100%',
    borderRadius: borderRadius.full,
  },
  hosBarText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    width: 36,
    textAlign: 'right',
  },
  violationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    backgroundColor: colors.redDim,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  violationText: {
    fontSize: fontSize.xs,
    color: colors.red,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
});
