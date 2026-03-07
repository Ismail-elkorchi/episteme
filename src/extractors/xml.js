import { parseXml } from "@ismail-elkorchi/xml-parser";
import { normalizeText } from "../utils.js";

const XSD_SCHEMA_ATTRS = [
  "targetNamespace",
  "elementFormDefault",
  "attributeFormDefault",
  "version",
  "id",
];

const XSD_ELEMENT_ATTRS = [
  "type",
  "substitutionGroup",
  "minOccurs",
  "maxOccurs",
  "abstract",
  "nillable",
  "default",
  "fixed",
  "form",
  "block",
  "final",
];

const XSD_ATTRIBUTE_ATTRS = ["type", "use", "default", "fixed", "form"];

export function extractXmlDocument({
  text,
  url,
  family,
  authority,
  snapshotId,
  source,
  documentType,
  title,
}) {
  let parsed;
  try {
    const document = parseXml(text || "");
    parsed = toExtractorTree(document);
  } catch (error) {
    return buildErrorDoc({
      url,
      family,
      authority,
      snapshotId,
      source,
      documentType,
      title,
      warning: `XML parse failed: ${error?.message || String(error)}`,
    });
  }

  const rootName = parsed ? Object.keys(parsed).find((key) => !key.startsWith("?")) : null;
  const rootNode = rootName ? parsed[rootName] : null;
  const isXsd = rootName ? isSchemaRoot(rootName) : false;

  const sections = isXsd
    ? buildXsdSections(rootNode)
    : buildGenericXmlSections(rootName || "document", rootNode);

  return {
    schemaVersion: "0.2",
    url,
    title: title || url,
    family: family || "generic",
    authority: authority || "informative",
    documentType: documentType || null,
    snapshotId: snapshotId || null,
    source: source || null,
    extractedAt: new Date().toISOString(),
    sections,
    warnings: [],
  };
}

function toExtractorTree(document) {
  const root = document?.root;
  if (!root) {
    return {};
  }
  return {
    [root.qName]: toExtractorNode(root),
  };
}

function toExtractorNode(node) {
  if (!node || typeof node !== "object" || node.kind !== "element") {
    return {};
  }

  const out = {};

  for (const attr of node.attributes || []) {
    out[`@_${attr.qName}`] = attr.value;
  }

  let text = "";
  for (const child of node.children || []) {
    if (child?.kind === "text") {
      text += child.value || "";
      continue;
    }

    if (child?.kind !== "element") {
      continue;
    }

    const key = child.qName;
    const childValue = toExtractorNode(child);
    const previous = out[key];
    if (previous === undefined) {
      out[key] = childValue;
    } else if (Array.isArray(previous)) {
      previous.push(childValue);
    } else {
      out[key] = [previous, childValue];
    }
  }

  if (text.length > 0) {
    out["#text"] = text;
  }

  return out;
}

function buildErrorDoc({ url, family, authority, snapshotId, source, documentType, title, warning }) {
  return {
    schemaVersion: "0.2",
    url,
    title: title || url,
    family: family || "generic",
    authority: authority || "informative",
    documentType: documentType || null,
    snapshotId: snapshotId || null,
    source: source || null,
    extractedAt: new Date().toISOString(),
    sections: [],
    warnings: [warning],
  };
}

function isSchemaRoot(rootName) {
  const local = rootName.split(":").pop();
  return local === "schema";
}

function buildXsdSections(rootNode) {
  const buckets = {
    elements: [],
    attributes: [],
    attributeGroups: [],
    groups: [],
    complexTypes: [],
    simpleTypes: [],
  };

  collectXsd(rootNode, buckets);

  const sections = [];
  const schemaSection = buildSchemaSection(rootNode);
  if (schemaSection) {
    sections.push(schemaSection);
  }

  pushDefinitionSection(sections, "elements", "Elements", "element-definitions", buckets.elements);
  pushDefinitionSection(sections, "attributes", "Attributes", "attribute-definitions", buckets.attributes);
  pushDefinitionSection(
    sections,
    "attribute-groups",
    "Attribute Groups",
    "attribute-group-definitions",
    buckets.attributeGroups,
  );
  pushDefinitionSection(sections, "groups", "Groups", "group-definitions", buckets.groups);
  pushDefinitionSection(
    sections,
    "complex-types",
    "Complex Types",
    "complex-type-definitions",
    buckets.complexTypes,
  );
  pushDefinitionSection(
    sections,
    "simple-types",
    "Simple Types",
    "simple-type-definitions",
    buckets.simpleTypes,
  );

  if (sections.length === 0) {
    return buildGenericXmlSections("schema", rootNode);
  }
  return sections;
}

function buildSchemaSection(rootNode) {
  if (!rootNode || typeof rootNode !== "object") {
    return null;
  }
  const items = [];
  const attrs = Object.entries(rootNode)
    .filter(([key]) => key.startsWith("@_"))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [key, value] of attrs) {
    const name = key.replace("@_", "");
    if (XSD_SCHEMA_ATTRS.includes(name) || name.startsWith("xmlns")) {
      items.push({ term: normalizeText(name), definition: normalizeText(String(value)) });
    }
  }

  if (items.length === 0) {
    return null;
  }

  return {
    id: "schema-metadata",
    heading: "Schema Metadata",
    level: 1,
    blocks: [
      {
        id: "schema-attributes",
        type: "definitionList",
        items,
      },
    ],
    source: null,
  };
}

function pushDefinitionSection(sections, id, heading, blockId, items) {
  if (!items.length) {
    return;
  }
  sections.push({
    id,
    heading,
    level: 1,
    blocks: [
      {
        id: blockId,
        type: "definitionList",
        items,
      },
    ],
    source: null,
  });
}

function collectXsd(node, buckets) {
  if (!node || typeof node !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) {
      continue;
    }
    const local = key.split(":").pop();
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (local === "element") {
        buckets.elements.push(buildXsdElementItem(item));
      } else if (local === "attribute") {
        buckets.attributes.push(buildXsdAttributeItem(item));
      } else if (local === "attributeGroup") {
        buckets.attributeGroups.push(buildXsdAttributeGroupItem(item));
      } else if (local === "group") {
        buckets.groups.push(buildXsdGroupItem(item));
      } else if (local === "complexType") {
        buckets.complexTypes.push(buildXsdComplexTypeItem(item));
      } else if (local === "simpleType") {
        buckets.simpleTypes.push(buildXsdSimpleTypeItem(item));
      }
      collectXsd(item, buckets);
    }
  }
}

function buildXsdElementItem(node) {
  const name = node?.["@_name"] || null;
  const ref = node?.["@_ref"] || null;
  const label = name || (ref ? `ref:${ref}` : "(anonymous)");
  const parts = buildAttributeParts(node, XSD_ELEMENT_ATTRS);

  const inlineType = node?.complexType ? "complexType" : node?.simpleType ? "simpleType" : null;
  if (inlineType) {
    parts.push(`inlineType=${inlineType}`);
  }

  const modelElements = extractModelElements(node);
  const attributes = extractAttributeRefs(node);
  if (modelElements.length) {
    parts.push(`elements=[${summarizeList(modelElements, 20)}]`);
  }
  if (attributes.length) {
    parts.push(`attributes=[${summarizeList(attributes, 20)}]`);
  }

  const annotation = extractAnnotationText(node);
  if (annotation) {
    parts.push(`doc=${truncate(annotation, 240)}`);
  }

  return {
    term: normalizeText(`element ${label}`),
    definition: normalizeText(parts.join("; ")),
  };
}

function buildXsdAttributeItem(node) {
  const name = node?.["@_name"] || null;
  const ref = node?.["@_ref"] || null;
  const label = name || (ref ? `ref:${ref}` : "(anonymous)");
  const parts = buildAttributeParts(node, XSD_ATTRIBUTE_ATTRS);
  const annotation = extractAnnotationText(node);
  if (annotation) {
    parts.push(`doc=${truncate(annotation, 240)}`);
  }
  return {
    term: normalizeText(`attribute ${label}`),
    definition: normalizeText(parts.join("; ")),
  };
}

function buildXsdAttributeGroupItem(node) {
  const name = node?.["@_name"] || node?.["@_ref"] || "(anonymous)";
  const attributes = extractAttributeRefs(node);
  const parts = [];
  if (attributes.length) {
    parts.push(`attributes=[${summarizeList(attributes, 20)}]`);
  }
  const annotation = extractAnnotationText(node);
  if (annotation) {
    parts.push(`doc=${truncate(annotation, 240)}`);
  }
  return {
    term: normalizeText(`attributeGroup ${name}`),
    definition: normalizeText(parts.join("; ")),
  };
}

function buildXsdGroupItem(node) {
  const name = node?.["@_name"] || node?.["@_ref"] || "(anonymous)";
  const elements = extractModelElements(node);
  const parts = [];
  if (elements.length) {
    parts.push(`elements=[${summarizeList(elements, 20)}]`);
  }
  const annotation = extractAnnotationText(node);
  if (annotation) {
    parts.push(`doc=${truncate(annotation, 240)}`);
  }
  return {
    term: normalizeText(`group ${name}`),
    definition: normalizeText(parts.join("; ")),
  };
}

function buildXsdComplexTypeItem(node) {
  const name = node?.["@_name"] || "(anonymous)";
  const parts = [];
  const attrParts = buildAttributeParts(node, ["mixed", "abstract", "block", "final"]);
  parts.push(...attrParts);

  const base = extractTypeBase(node);
  if (base) {
    parts.push(`base=${base}`);
  }

  const elements = extractModelElements(node);
  const attributes = extractAttributeRefs(node);
  if (elements.length) {
    parts.push(`elements=[${summarizeList(elements, 20)}]`);
  }
  if (attributes.length) {
    parts.push(`attributes=[${summarizeList(attributes, 20)}]`);
  }

  const assertions = extractAssertions(node);
  if (assertions.length) {
    parts.push(`assertions=[${summarizeList(assertions, 10)}]`);
  }

  const annotation = extractAnnotationText(node);
  if (annotation) {
    parts.push(`doc=${truncate(annotation, 240)}`);
  }

  return {
    term: normalizeText(`complexType ${name}`),
    definition: normalizeText(parts.join("; ")),
  };
}

function buildXsdSimpleTypeItem(node) {
  const name = node?.["@_name"] || "(anonymous)";
  const parts = [];
  const attrParts = buildAttributeParts(node, ["final"]);
  parts.push(...attrParts);

  const restriction = firstByLocal(node, "restriction");
  const listNode = firstByLocal(node, "list");
  const unionNode = firstByLocal(node, "union");

  if (restriction) {
    if (restriction?.["@_base"]) {
      parts.push(`base=${restriction["@_base"]}`);
    } else {
      const inlineBase = describeInlineSimpleType(restriction);
      if (inlineBase) {
        parts.push(`base=${inlineBase}`);
      }
    }
    const facets = extractFacets(restriction);
    if (facets.length) {
      parts.push(`facets=[${summarizeList(facets, 20)}]`);
    }
  } else if (listNode) {
    if (listNode?.["@_itemType"]) {
      parts.push(`listOf=${listNode["@_itemType"]}`);
    } else {
      const inlineList = describeInlineSimpleType(listNode);
      if (inlineList) {
        parts.push(`listOf=${inlineList}`);
      }
    }
  } else if (unionNode) {
    if (unionNode?.["@_memberTypes"]) {
      parts.push(`unionOf=${unionNode["@_memberTypes"]}`);
    } else {
      const inlineUnion = describeInlineSimpleType(unionNode);
      if (inlineUnion) {
        parts.push(`unionOf=${inlineUnion}`);
      }
    }
  }

  const annotation = extractAnnotationText(node);
  if (annotation) {
    parts.push(`doc=${truncate(annotation, 240)}`);
  }

  return {
    term: normalizeText(`simpleType ${name}`),
    definition: normalizeText(parts.join("; ")),
  };
}

function buildAttributeParts(node, attrs) {
  const parts = [];
  for (const attr of attrs) {
    const value = node?.[`@_${attr}`];
    if (value != null) {
      parts.push(`${attr}=${value}`);
    }
  }
  return parts;
}

function extractTypeBase(node) {
  const complexContent = firstByLocal(node, "complexContent");
  if (complexContent) {
    const extension = firstByLocal(complexContent, "extension");
    const restriction = firstByLocal(complexContent, "restriction");
    if (extension?.["@_base"]) return extension["@_base"];
    if (restriction?.["@_base"]) return restriction["@_base"];
  }
  const simpleContent = firstByLocal(node, "simpleContent");
  if (simpleContent) {
    const extension = firstByLocal(simpleContent, "extension");
    const restriction = firstByLocal(simpleContent, "restriction");
    if (extension?.["@_base"]) return extension["@_base"];
    if (restriction?.["@_base"]) return restriction["@_base"];
  }
  return null;
}

function extractModelElements(node) {
  const elements = [];
  collectModelElements(node, elements);
  return elements;
}

function collectModelElements(node, elements) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectModelElements(child, elements));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) {
      continue;
    }
    const local = key.split(":").pop();
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (local === "element") {
        const name = item?.["@_name"] || item?.["@_ref"] || "(anonymous)";
        const parts = [];
        if (item?.["@_type"]) parts.push(`type=${item["@_type"]}`);
        if (item?.["@_minOccurs"]) parts.push(`minOccurs=${item["@_minOccurs"]}`);
        if (item?.["@_maxOccurs"]) parts.push(`maxOccurs=${item["@_maxOccurs"]}`);
        const detail = parts.length ? ` (${parts.join(", ")})` : "";
        elements.push(normalizeText(`${name}${detail}`));
      } else {
        collectModelElements(item, elements);
      }
    }
  }
}

function extractAttributeRefs(node) {
  const attrs = [];
  collectAttributes(node, attrs);
  return attrs;
}

function collectAttributes(node, attrs) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectAttributes(child, attrs));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) {
      continue;
    }
    const local = key.split(":").pop();
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (local === "attribute") {
        const name = item?.["@_name"] || item?.["@_ref"] || "(anonymous)";
        const parts = [];
        if (item?.["@_type"]) parts.push(`type=${item["@_type"]}`);
        if (item?.["@_use"]) parts.push(`use=${item["@_use"]}`);
        const detail = parts.length ? ` (${parts.join(", ")})` : "";
        attrs.push(normalizeText(`${name}${detail}`));
      } else {
        collectAttributes(item, attrs);
      }
    }
  }
}

function extractFacets(restrictionNode) {
  const facets = [];
  if (!restrictionNode || typeof restrictionNode !== "object") {
    return facets;
  }

  for (const [key, value] of Object.entries(restrictionNode)) {
    if (key.startsWith("@_")) {
      continue;
    }
    const local = key.split(":").pop();
    if (local === "annotation" || local === "simpleType") {
      continue;
    }
    const nodes = Array.isArray(value) ? value : [value];
    for (const node of nodes) {
      const facetValue = formatFacet(local, node);
      if (facetValue) {
        facets.push(facetValue);
      }
    }
  }

  return facets;
}

function formatFacet(local, node) {
  if (node == null) {
    return normalizeText(local);
  }
  if (typeof node !== "object") {
    return normalizeText(`${local}=${node}`);
  }
  const attrs = listAttributePairs(node);
  const value = node?.["@_value"];
  if (value != null && attrs.length === 1) {
    return normalizeText(`${local}=${value}`);
  }
  if (attrs.length) {
    return normalizeText(`${local}(${attrs.join(", ")})`);
  }
  return normalizeText(local);
}

function listAttributePairs(node) {
  if (!node || typeof node !== "object") {
    return [];
  }
  return Object.entries(node)
    .filter(([key]) => key.startsWith("@_"))
    .map(([key, value]) => `${key.replace("@_", "")}=${value}`);
}

function describeInlineSimpleType(parentNode) {
  const inlineSimpleType = firstByLocal(parentNode, "simpleType");
  if (!inlineSimpleType) {
    return null;
  }
  const restriction = firstByLocal(inlineSimpleType, "restriction");
  if (restriction?.["@_base"]) {
    return restriction["@_base"];
  }
  const listNode = firstByLocal(inlineSimpleType, "list");
  if (listNode?.["@_itemType"]) {
    return `list:${listNode["@_itemType"]}`;
  }
  const unionNode = firstByLocal(inlineSimpleType, "union");
  if (unionNode?.["@_memberTypes"]) {
    return `union:${unionNode["@_memberTypes"]}`;
  }
  return "inline";
}

function extractAssertions(node) {
  const results = [];
  const assertions = [];
  collectByLocal(node, "assert", assertions);
  for (const assertion of assertions) {
    const attrs = listAttributePairs(assertion);
    if (attrs.length) {
      results.push(normalizeText(`assert(${attrs.join(", ")})`));
    } else {
      results.push("assert");
    }
  }
  return results;
}

function collectByLocal(node, localName, results) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectByLocal(child, localName, results));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) {
      continue;
    }
    const local = key.split(":").pop();
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (local === localName) {
        results.push(item);
      }
      collectByLocal(item, localName, results);
    }
  }
}

function extractAnnotationText(node) {
  const annotations = allByLocal(node, "annotation");
  const parts = [];
  for (const annotation of annotations) {
    const docs = allByLocal(annotation, "documentation");
    for (const doc of docs) {
      const text = extractText(doc);
      if (text) {
        parts.push(text);
      }
    }
  }
  return normalizeText(parts.join(" "));
}

function extractText(node) {
  const parts = [];
  collectText(node, parts);
  return normalizeText(parts.join(" "));
}

function collectText(node, parts) {
  if (node == null) {
    return;
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    const value = normalizeText(String(node));
    if (value) {
      parts.push(value);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, parts));
    return;
  }
  if (typeof node === "object") {
    if (node["#text"]) {
      collectText(node["#text"], parts);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("@_")) {
        continue;
      }
      if (key === "#text") {
        continue;
      }
      collectText(value, parts);
    }
  }
}

function firstByLocal(node, localName) {
  const items = allByLocal(node, localName);
  return items.length ? items[0] : null;
}

function allByLocal(node, localName) {
  if (!node || typeof node !== "object") {
    return [];
  }
  const matches = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) {
      continue;
    }
    const local = key.split(":").pop();
    if (local === localName) {
      if (Array.isArray(value)) {
        matches.push(...value);
      } else {
        matches.push(value);
      }
    }
  }
  return matches;
}

function summarizeList(items, limit = 20) {
  if (!items.length) return "";
  const slice = items.slice(0, limit);
  const extra = items.length > limit ? `, ... (+${items.length - limit} more)` : "";
  return `${slice.join(", ")}${extra}`;
}

function truncate(text, max) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function buildGenericXmlSections(rootName, rootNode) {
  const lines = [];
  collectXmlLines(rootNode, `/${rootName}`, lines);
  return [
    {
      id: null,
      heading: rootName || "Document",
      level: 1,
      blocks: [
        {
          id: "xml-lines",
          type: "list",
          items: lines.slice(0, 2000),
        },
      ],
      source: null,
    },
  ];
}

function collectXmlLines(node, path, lines) {
  if (node == null) {
    return;
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    const text = normalizeText(String(node));
    if (text) {
      lines.push(`${path}: ${text}`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectXmlLines(child, `${path}[${index}]`, lines));
    return;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("@_")) {
        lines.push(`${path} @${key.replace("@_", "")}: ${value}`);
      } else {
        collectXmlLines(value, `${path}/${key}`, lines);
      }
    }
  }
}
