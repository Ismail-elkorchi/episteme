import { createPdfEngine } from "@ismail-elkorchi/pdf-engine";

const SUCCESS_STATUSES = new Set(["completed", "partial"]);

export async function extractPdfDocument({
  buffer,
  url,
  family,
  authority,
  snapshotId,
  source,
  documentType,
  title,
}) {
  const extractedAt = requireSnapshotTimestamp(source);
  const baseDocument = {
    schemaVersion: "0.1",
    url,
    title: title || url,
    family: family || "generic",
    authority: authority || "informative",
    documentType: documentType || null,
    snapshotId: snapshotId || null,
    source: source || null,
    extractedAt,
  };
  const engine = createPdfEngine();
  let document;

  try {
    const bytes = normalizePdfBytes(buffer);
    const opened = await engine.open({
      source: {
        kind: "bytes",
        bytes,
        mediaType: "application/pdf",
        ...(typeof source?.fileName === "string" ? { fileName: source.fileName } : {}),
        ...(typeof source?.sha256 === "string" ? { sha256: source.sha256 } : {}),
      },
    });
    const openDiagnostics = projectDiagnostics(opened.diagnostics);
    if (!SUCCESS_STATUSES.has(opened.status)) {
      return failedPdfDocument(baseDocument, engine, opened.status, openDiagnostics);
    }

    document = opened.value;
    const [knowledgeResult, featuresResult] = await Promise.all([
      document.knowledge(),
      document.features(),
    ]);
    const diagnostics = projectDiagnostics([
      ...opened.diagnostics,
      ...knowledgeResult.diagnostics,
      ...featuresResult.diagnostics,
    ]);
    if (!SUCCESS_STATUSES.has(knowledgeResult.status)) {
      return failedPdfDocument(baseDocument, engine, knowledgeResult.status, diagnostics, document.summary);
    }

    const knowledge = knowledgeResult.value;
    const features = SUCCESS_STATUSES.has(featuresResult.status) ? featuresResult.value : undefined;
    const resolvedTitle = title || features?.metadata.title || url;
    const sections = projectKnowledgeSections(knowledge.items, resolvedTitle, url);
    const warnings = sections.length === 0
      ? ["PDF extraction produced no native structured content"]
      : [];

    return {
      ...baseDocument,
      title: resolvedTitle,
      sections,
      warnings,
      diagnostics,
      pdf: {
        engine: engine.identity.name,
        engineVersion: engine.identity.version,
        status: resultStatus(opened.status, knowledgeResult.status, featuresResult.status),
        pdfVersion: document.summary.pdfVersion,
        pageCount: document.summary.pageCount,
        encrypted: document.summary.encrypted,
        repaired: document.summary.repaired,
        strategy: knowledge.strategy,
        knownLimits: [...knowledge.knownLimits],
        findings: features?.findings.map(projectFinding) ?? [],
        forms: knowledge.forms.map((form) => projectForm(form, url)),
      },
    };
  } catch (error) {
    return {
      ...baseDocument,
      sections: [],
      warnings: [`PDF extraction failed: ${errorMessage(error)}`],
      diagnostics: [],
      pdf: {
        engine: engine.identity.name,
        engineVersion: engine.identity.version,
        status: "failed",
        knownLimits: [],
        findings: [],
        forms: [],
      },
    };
  } finally {
    try {
      await document?.dispose();
    } finally {
      await engine.dispose();
    }
  }
}

function requireSnapshotTimestamp(source) {
  if (typeof source?.fetchedAt !== "string" || source.fetchedAt.length === 0) {
    throw new TypeError("PDF extraction requires source.fetchedAt from the recorded snapshot");
  }
  return source.fetchedAt;
}

function normalizePdfBytes(input) {
  if (input instanceof Uint8Array) {
    return Uint8Array.from(input);
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0));
  }
  if (ArrayBuffer.isView(input)) {
    const bytes = new Uint8Array(input.byteLength);
    bytes.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    return bytes;
  }
  throw new TypeError(`Unsupported PDF buffer type: ${Object.prototype.toString.call(input)}`);
}

function projectKnowledgeSections(items, title, url) {
  const sections = [];
  let currentSection;

  function ensureSection() {
    if (currentSection) {
      return currentSection;
    }
    currentSection = {
      id: "pdf-document",
      heading: title,
      level: 1,
      blocks: [],
      source: emptyBlockSource(url),
    };
    sections.push(currentSection);
    return currentSection;
  }

  function preserveHeadingOnlySection() {
    if (!currentSection || currentSection.id === "pdf-document" || currentSection.blocks.length > 0) {
      return;
    }
    currentSection.blocks.push({
      id: `${currentSection.id}-content`,
      type: "paragraph",
      role: "heading",
      text: currentSection.heading,
      source: currentSection.source,
    });
  }

  for (const item of items) {
    if (item.kind === "table") {
      ensureSection().blocks.push(projectTableBlock(item.table, url));
      continue;
    }

    const chunk = item.chunk;
    if (chunk.role !== "heading") {
      ensureSection().blocks.push(projectChunkBlock(chunk, url));
      continue;
    }

    preserveHeadingOnlySection();
    const [heading = title, ...bodyLines] = chunk.text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const source = blockSourceFromCitations(url, chunk.citations, chunk.pageNumbers);
    currentSection = {
      id: chunk.id,
      heading,
      level: 2,
      blocks: [],
      source,
    };
    sections.push(currentSection);
    if (bodyLines.length > 0) {
      currentSection.blocks.push({
        id: `${chunk.id}-content`,
        type: "paragraph",
        role: "body",
        text: bodyLines.join("\n"),
        source,
      });
    }
  }

  preserveHeadingOnlySection();
  return sections;
}

function projectChunkBlock(chunk, url) {
  const source = blockSourceFromCitations(url, chunk.citations, chunk.pageNumbers);
  if (chunk.role === "list") {
    return {
      id: chunk.id,
      type: "list",
      role: chunk.role,
      ordered: false,
      items: chunk.text
        .split(/\r?\n/u)
        .map((line) => line.replace(/^[-*]\s*/u, "").trim())
        .filter(Boolean),
      source,
    };
  }
  return {
    id: chunk.id,
    type: "paragraph",
    role: chunk.role,
    text: chunk.text,
    source,
  };
}

function projectTableBlock(table, url) {
  const rowIndexes = sortedNumbers(table.cells.map((cell) => cell.rowIndex));
  const columnIndexes = sortedNumbers(table.cells.map((cell) => cell.columnIndex));
  const rows = rowIndexes.map((rowIndex) => columnIndexes.map((columnIndex) =>
    table.cells.find((cell) => cell.rowIndex === rowIndex && cell.columnIndex === columnIndex)?.text ?? ""
  ));
  const headers = table.headers ? [...table.headers] : [];
  const bodyRows = headers.length > 0 && sameStrings(rows[0] ?? [], headers) ? rows.slice(1) : rows;
  const citations = dedupeCitations(table.cells.flatMap((cell) => cell.citations));

  return {
    id: table.id,
    type: "table",
    headers,
    rows: bodyRows,
    pageNumber: table.pageNumber,
    confidence: table.confidence,
    ...(table.heuristic ? { heuristic: table.heuristic } : {}),
    cells: table.cells.map((cell) => ({
      rowIndex: cell.rowIndex,
      columnIndex: cell.columnIndex,
      text: cell.text,
      source: blockSourceFromCitations(url, cell.citations, [table.pageNumber]),
    })),
    source: blockSourceFromCitations(url, citations, [table.pageNumber]),
  };
}

function projectForm(form, url) {
  return {
    id: form.id,
    pageNumber: form.pageNumber,
    ...(form.title ? { title: form.title } : {}),
    ...(form.heuristic ? { heuristic: form.heuristic } : {}),
    confidence: form.confidence,
    source: blockSourceFromCitations(
      url,
      dedupeCitations(form.fields.flatMap((field) => field.citations)),
      [form.pageNumber],
    ),
    fields: form.fields.map((field) => ({
      id: field.id,
      pageNumber: field.pageNumber,
      name: field.name,
      ...(field.value === undefined ? {} : { value: field.value }),
      valueState: field.valueState,
      confidence: field.confidence,
      source: blockSourceFromCitations(url, field.citations, [field.pageNumber]),
    })),
  };
}

function blockSourceFromCitations(url, citations, fallbackPageNumbers = []) {
  const uniqueCitations = dedupeCitations(citations);
  const pageNumbers = sortedNumbers([
    ...fallbackPageNumbers,
    ...uniqueCitations.map((citation) => citation.pageNumber),
  ]);
  const blockIds = [...new Set(uniqueCitations.map((citation) => citation.blockId))];
  const runIds = [...new Set(uniqueCitations.flatMap((citation) => citation.runIds))];
  const [onlyPage] = pageNumbers.length === 1 ? pageNumbers : [];
  const [onlyBlock] = blockIds.length === 1 ? blockIds : [];
  return {
    url,
    fragment: onlyPage === undefined ? null : `page=${onlyPage}`,
    path: onlyPage === undefined || onlyBlock === undefined
      ? null
      : `pages/${onlyPage}/blocks/${onlyBlock}`,
    pageNumbers,
    blockIds,
    runIds,
    citations: uniqueCitations.map(projectCitation),
  };
}

function emptyBlockSource(url) {
  return {
    url,
    fragment: null,
    path: null,
    pageNumbers: [],
    blockIds: [],
    runIds: [],
    citations: [],
  };
}

function projectCitation(citation) {
  return {
    id: citation.id,
    pageNumber: citation.pageNumber,
    blockId: citation.blockId,
    runIds: [...citation.runIds],
    text: citation.text,
    ...(citation.pageRef ? { pageRef: { ...citation.pageRef } } : {}),
    ...(citation.sourceSpan ? {
      sourceSpan: {
        text: citation.sourceSpan.text,
        blockRange: { ...citation.sourceSpan.blockRange },
        runSpans: citation.sourceSpan.runSpans.map((span) => ({
          runId: span.runId,
          range: { ...span.range },
          text: span.text,
          ...(span.bbox ? { bbox: { ...span.bbox } } : {}),
        })),
        ...(citation.sourceSpan.bbox ? { bbox: { ...citation.sourceSpan.bbox } } : {}),
        ...(citation.sourceSpan.pageRef ? { pageRef: { ...citation.sourceSpan.pageRef } } : {}),
      },
    } : {}),
  };
}

function projectDiagnostics(diagnostics) {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    stage: diagnostic.stage,
    level: diagnostic.level,
    message: diagnostic.message,
    ...(diagnostic.feature ? { feature: diagnostic.feature } : {}),
    ...(diagnostic.pageNumber === undefined ? {} : { pageNumber: diagnostic.pageNumber }),
    ...(diagnostic.objectRef ? { objectRef: { ...diagnostic.objectRef } } : {}),
    ...(diagnostic.detail ? { detail: diagnostic.detail } : {}),
  }));
}

function projectFinding(finding) {
  return {
    ...finding,
    ...(finding.objectRef ? { objectRef: { ...finding.objectRef } } : {}),
  };
}

function failedPdfDocument(baseDocument, engine, status, diagnostics, summary) {
  const detail = diagnostics.map((diagnostic) => diagnostic.message).filter(Boolean).join("; ");
  return {
    ...baseDocument,
    sections: [],
    warnings: [`PDF extraction ${status}${detail ? `: ${detail}` : ""}`],
    diagnostics,
    pdf: {
      engine: engine.identity.name,
      engineVersion: engine.identity.version,
      status,
      ...(summary ? {
        pdfVersion: summary.pdfVersion,
        pageCount: summary.pageCount,
        encrypted: summary.encrypted,
        repaired: summary.repaired,
      } : {}),
      knownLimits: [],
      findings: [],
      forms: [],
    },
  };
}

function resultStatus(...statuses) {
  return statuses.every((status) => status === "completed") ? "completed" : "partial";
}

function dedupeCitations(citations) {
  const byId = new Map();
  for (const citation of citations) {
    byId.set(citation.id, citation);
  }
  return [...byId.values()];
}

function sortedNumbers(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
