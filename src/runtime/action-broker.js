import { getActionDefinition, getActionsForFeature } from "./action-catalog.js";
import { getCapabilityDefinition } from "./feature-catalog.js";

export function createActionBroker({
  featureId,
  policy,
  handlers,
  permissionChecker = hasBrowserPermissions,
}) {
  const declaredActions = getActionsForFeature(featureId);
  const declaredIds = new Set(declaredActions.map((action) => action.id));

  for (const action of declaredActions) {
    if (typeof handlers[action.id] !== "function") {
      throw new Error(
        `[ActionBroker] Feature "${featureId}" has no handler for registered action "${action.id}".`,
      );
    }
  }
  for (const actionId of Object.keys(handlers)) {
    const action = getActionDefinition(actionId);
    if (action.featureId !== featureId || !declaredIds.has(actionId)) {
      throw new Error(
        `[ActionBroker] Feature "${featureId}" cannot handle action "${actionId}" owned by "${action.featureId}".`,
      );
    }
  }

  return Object.freeze({
    featureId,
    can(actionId) {
      const action = requireOwnedAction(actionId, featureId);
      return policy.can(action.capability);
    },
    async execute(actionId, payload) {
      const action = requireOwnedAction(actionId, featureId);
      policy.require(action.capability);
      const capability = getCapabilityDefinition(action.capability);
      if (
        capability.browserPermissions.length > 0 &&
        !(await permissionChecker(capability.browserPermissions))
      ) {
        throw new Error(
          `[ActionBroker] Action "${actionId}" requires browser permissions: ${capability.browserPermissions.join(", ")}.`,
        );
      }
      return handlers[actionId](payload);
    },
  });
}

function requireOwnedAction(actionId, featureId) {
  const action = getActionDefinition(actionId);
  if (action.featureId !== featureId) {
    throw new Error(
      `[ActionBroker] Feature "${featureId}" cannot execute action "${actionId}" owned by "${action.featureId}".`,
    );
  }
  return action;
}

async function hasBrowserPermissions(permissions) {
  if (!permissions.length) return true;
  if (typeof chrome === "undefined" || !chrome.permissions?.contains)
    return false;
  return chrome.permissions.contains({ permissions });
}
