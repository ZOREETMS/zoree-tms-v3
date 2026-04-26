/**
 * useBulkPlan — Hook for managing bulk plan workflow state.
 *
 * Manages: order selection, lane grouping, rating, execution, results.
 */

import { useCallback, useMemo, useState } from 'react';
import { useData } from '../../state/DataContext';
import { BulkPlanApi } from '../../lib/api';
import { buildLaneGroups, classifyLoadType } from '../utils/laneUtils';
import { planAllLanes } from '../services/bulkPlanService';
import {
  createFailureCollector,
  mapBackendErrorsToOrders,
} from '../../services/bulkPlanFailureCollector';
import { FAILURE_CODES } from '../../types/planningFailure';

export default function useBulkPlan() {
  const { data, refreshData } = useData();

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  /** Only unplanned orders are eligible for planning */
  const unplannedOrders = useMemo(
    () => data.orders.filter((o) => {
      const status = (o.status || '').toLowerCase();
      return status === 'unplanned' || (!o.shipmentId && !o.shipment_id && status !== 'cancelled');
    }),
    [data.orders],
  );

  /** Selection summary */
  const selectionSummary = useMemo(() => {
    const selected = unplannedOrders.filter((o) => selectedIds.has(o.id));
    return {
      count: selected.length,
      weight: selected.reduce((s, o) => s + Number(o.weight || 0), 0),
      pieces: selected.reduce((s, o) => s + Number(o.pieces || 0), 0),
    };
  }, [unplannedOrders, selectedIds]);

  /** Lane groups from selected orders */
  const lanes = useMemo(() => {
    const selected = unplannedOrders.filter((o) => selectedIds.has(o.id));
    const groups = buildLaneGroups(selected);
    return groups.map((g) => ({ ...g, loadType: classifyLoadType(g.totalWeight) }));
  }, [unplannedOrders, selectedIds]);

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((filteredOrders) => {
    setSelectedIds((prev) => {
      const allSelected = filteredOrders.every((o) => prev.has(o.id));
      if (allSelected) return new Set(); // deselect all
      return new Set(filteredOrders.map((o) => o.id));
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /** Execute the full plan: rate → consolidate → create shipments */
  const executePlan = useCallback(
    async (optimizeBy = 'cost') => {
      if (selectedIds.size === 0) return;

      setBusy(true);
      setError('');
      setProgress('Grouping orders by lane...');
      setResults(null);

      try {
        const selectedOrders = unplannedOrders.filter((o) => selectedIds.has(o.id));
        const laneGroups = buildLaneGroups(selectedOrders);

        setProgress(`Rating ${laneGroups.length} lane(s)...`);

        // Phase 1: Rate all lanes with progressive consolidation
        const planResult = await planAllLanes(
          laneGroups,
          data.orders,
          optimizeBy,
          (msg) => setProgress(msg),
        );

        if (planResult.plans.length === 0) {
          setError('No carriers returned quotes. Check rate table or enable CarrierConnect.');
          setBusy(false);
          return;
        }

        // Phase 2: Execute — create shipments
        setProgress(`Creating ${planResult.plans.length} shipment(s)...`);
        const executeResult = await BulkPlanApi.execute(planResult.plans);

        // Build a structured failure list so the results screen can
        // render *why* each order dropped, instead of a bare count.
        // Source 1: orders that planAllLanes itself couldn't rate
        //   (currently only NO_CARRIER_QUOTE — extend planAllLanes to
        //   return richer reasons if we ever surface them).
        // Source 2: backend lane errors from /bulk-plan/execute, keyed
        //   back to orders via the plan list and skipping orders that
        //   survived on a different shipment.
        const failures = createFailureCollector();
        const failedIds = planResult.failedOrderIds || [];
        for (const id of failedIds) failures.add(id, FAILURE_CODES.NO_CARRIER_QUOTE);

        const shipments = executeResult.shipments || [];
        const plannedOrderIds = new Set(
          shipments.flatMap((sh) =>
            Array.isArray(sh.order_ids) ? sh.order_ids : [],
          ),
        );
        const backendFailures = mapBackendErrorsToOrders({
          backendErrors: executeResult.errors || [],
          plans: planResult.plans,
          plannedOrderIds,
        });
        for (const f of backendFailures) failures.add(f.orderId, f.code, f.details);

        setResults({
          shipments,
          ordersUpdated: executeResult.ordersUpdated || 0,
          errors: executeResult.errors || [],
          consolidated: planResult.totalConsolidated,
          individual: planResult.totalIndividual,
          failed: failedIds,
          // New structured shape (orderId / code / details). The
          // results screen renders this list when present.
          failures: failures.list(),
        });

        // Refresh data to get updated order statuses
        await refreshData();
        setSelectedIds(new Set());
      } catch (e) {
        setError(e.message || 'Planning failed');
      } finally {
        setBusy(false);
        setProgress('');
      }
    },
    [selectedIds, unplannedOrders, data.orders, refreshData],
  );

  const reset = useCallback(() => {
    setResults(null);
    setError('');
    setProgress('');
    clearSelection();
  }, [clearSelection]);

  return {
    unplannedOrders,
    selectedIds,
    selectionSummary,
    lanes,
    busy,
    progress,
    results,
    error,
    toggleSelect,
    selectAll,
    clearSelection,
    executePlan,
    reset,
  };
}
