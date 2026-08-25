export const NAVIGATION_SEQUENCES = Object.freeze({
  OPENED_TAB_IS_TARGET: "opened_tab_is_target",
  ORIGINAL_TAB_WAS_REDIRECTED: "original_tab_was_redirected",
});

const SEQUENCE_PLANS = Object.freeze({
  [NAVIGATION_SEQUENCES.OPENED_TAB_IS_TARGET]: ({
    originalTabId,
    openedTabId,
  }) => ({
    closeTabId: openedTabId,
    restoreTabId: null,
    survivingTabId: originalTabId,
    notifyTabId: originalTabId,
  }),
  [NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED]: ({
    originalTabId,
    openedTabId,
    restoreOriginal = false,
  }) =>
    restoreOriginal
      ? {
          closeTabId: null,
          restoreTabId: originalTabId,
          survivingTabId: originalTabId,
          notifyTabId: originalTabId,
        }
      : {
          closeTabId: originalTabId,
          restoreTabId: null,
          survivingTabId: openedTabId,
          notifyTabId: openedTabId,
        },
});

export function createNavigationEnforcementPlan({
  sequence,
  originalTabId,
  openedTabId,
  restoreOriginal = false,
}) {
  const buildPlan = SEQUENCE_PLANS[sequence];
  if (!buildPlan) {
    throw new Error(
      `Unknown navigation sequence: ${sequence}. Register it before use.`,
    );
  }
  if (!Number.isInteger(originalTabId) || !Number.isInteger(openedTabId)) {
    throw new TypeError("Navigation enforcement requires two valid tab IDs.");
  }

  const plan = Object.freeze(
    buildPlan({ originalTabId, openedTabId, restoreOriginal }),
  );
  if (plan.notifyTabId !== plan.survivingTabId) {
    throw new Error("Navigation toast must target the surviving tab.");
  }
  if (plan.closeTabId === plan.notifyTabId) {
    throw new Error("Navigation toast cannot target the tab being closed.");
  }
  return plan;
}

export function getRegisteredNavigationSequences() {
  return Object.freeze(Object.keys(SEQUENCE_PLANS));
}
