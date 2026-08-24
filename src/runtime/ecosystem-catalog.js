export const PRODUCT_IDS = Object.freeze({
  AD_PROTECTION: "ad-protection",
  MEDIA_TOOLS: "media-tools",
});

export const COMPONENT_IDS = Object.freeze({
  BROWSER_EXTENSION: "browser-extension",
  MEDIA_HELPER: "media-helper",
});

const P = PRODUCT_IDS;
const C = COMPONENT_IDS;

export const PRODUCT_CATALOG = Object.freeze({
  [P.AD_PROTECTION]: product(P.AD_PROTECTION, {
    name: "AdsFriendly Protection",
    requiredComponents: [C.BROWSER_EXTENSION],
    optionalComponents: [],
  }),
  [P.MEDIA_TOOLS]: product(P.MEDIA_TOOLS, {
    name: "AdsFriendly Media Tools",
    requiredComponents: [C.BROWSER_EXTENSION],
    optionalComponents: [C.MEDIA_HELPER],
  }),
});

validateProductCatalog();

export function getProductDefinition(productId) {
  const definition = PRODUCT_CATALOG[productId];
  if (!definition) {
    throw new Error(
      `[EcosystemRegistry] Unknown product "${productId}". Register it in ecosystem-catalog.js before use.`,
    );
  }
  return definition;
}

export function assertRegisteredProduct(productId) {
  getProductDefinition(productId);
  return productId;
}

export function assertRegisteredComponent(componentId) {
  if (!Object.values(COMPONENT_IDS).includes(componentId)) {
    throw new Error(
      `[EcosystemRegistry] Unknown component "${componentId}". Register it in ecosystem-catalog.js before use.`,
    );
  }
  return componentId;
}

export function isComponentRequiredByProduct(productId, componentId) {
  assertRegisteredComponent(componentId);
  return getProductDefinition(productId).requiredComponents.includes(
    componentId,
  );
}

export function isComponentOptionalForProduct(productId, componentId) {
  assertRegisteredComponent(componentId);
  return getProductDefinition(productId).optionalComponents.includes(
    componentId,
  );
}

function product(
  id,
  { name, requiredComponents = [], optionalComponents = [] },
) {
  return Object.freeze({
    id,
    name,
    requiredComponents: Object.freeze([...requiredComponents]),
    optionalComponents: Object.freeze([...optionalComponents]),
  });
}

function validateProductCatalog() {
  const productIds = Object.values(PRODUCT_IDS);
  if (new Set(productIds).size !== productIds.length) {
    throw new Error("[EcosystemRegistry] Duplicate product ID.");
  }
  for (const productId of productIds) {
    const definition = PRODUCT_CATALOG[productId];
    if (!definition || definition.id !== productId) {
      throw new Error(
        `[EcosystemRegistry] Product "${productId}" has no metadata definition.`,
      );
    }
    const components = [
      ...definition.requiredComponents,
      ...definition.optionalComponents,
    ];
    if (new Set(components).size !== components.length) {
      throw new Error(
        `[EcosystemRegistry] Product "${productId}" declares a component more than once.`,
      );
    }
    for (const componentId of components) {
      assertRegisteredComponent(componentId);
    }
  }
}
