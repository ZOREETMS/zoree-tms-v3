/** Customer Portal domain constants */

export const PORTAL_STATUS = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  PENDING: "Pending",
};

export const VISIBILITY_LEVELS = {
  FULL: "Full",
  STATUS_ONLY: "Status Only",
  ETA_ONLY: "ETA Only",
};

export function emptyCustomerInvite() {
  return {
    name: "",
    email: "",
    company: "",
    visibility: VISIBILITY_LEVELS.FULL,
  };
}
