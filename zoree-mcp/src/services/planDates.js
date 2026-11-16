// ════════════════════════════════════════════════════════════════════
// planDates.js — pickup / delivery dates for a quote.
//
// Mirrors calcDates() in frontend/src/services/bulkPlanService.js so the
// dates Claude reports match the Plan modal exactly:
//   • earliest pickup = max(today, order ready date)
//   • pickup is pushed as late as possible so delivery lands on the due
//     date (due − transit business days), but never before earliest
//   • delivery = pickup + transit business days (Mon–Fri)
//   • meets_due_date = delivery ≤ due date
// Keep the two in sync if the planner's rule changes.
// ════════════════════════════════════════════════════════════════════

function addBusinessDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d.toISOString().slice(0, 10);
}

function calcDates({ transitDays, readyDate, dueDate, today = new Date().toISOString().slice(0, 10) }) {
  const transit = Number(transitDays) || null;
  if (!transit) return { pickup: null, delivery: null, meetsDueDate: null };
  const minPickup = readyDate && readyDate > today ? readyDate : today;
  let pickup = minPickup;
  if (dueDate) {
    const ideal = addBusinessDays(dueDate, -transit);
    if (ideal >= minPickup) pickup = ideal;
  }
  const delivery = addBusinessDays(pickup, transit);
  return { pickup, delivery, meetsDueDate: dueDate ? delivery <= dueDate : null };
}

module.exports = { addBusinessDays, calcDates };
