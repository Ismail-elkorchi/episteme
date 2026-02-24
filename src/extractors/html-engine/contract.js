const REQUIRED_METHODS = [
  "parse",
  "queryOne",
  "queryAll",
  "matches",
  "iterateElements",
  "text",
  "classNames",
];

export function assertHtmlEngineContract(engine, name = "htmlEngine") {
  if (!engine || typeof engine !== "object") {
    throw new Error(`${name} must be an object`);
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof engine[method] !== "function") {
      throw new Error(`${name} must implement method "${method}"`);
    }
  }

  return engine;
}

export function defineHtmlEngine(engine, name = "htmlEngine") {
  return Object.freeze(assertHtmlEngineContract(engine, name));
}

