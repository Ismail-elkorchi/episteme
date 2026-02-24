import { extractTextDocument } from "./text.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

function normalizePdfBytes(input) {
  if (!input) {
    throw new Error("PDF extraction requires binary data");
  }

  const BufferRef = typeof Buffer !== "undefined" ? Buffer : null;
  if (BufferRef?.isBuffer?.(input)) {
    return Uint8Array.from(input);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  }

  throw new Error(`Unsupported PDF buffer type: ${Object.prototype.toString.call(input)}`);
}

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
  try {
    const data = normalizePdfBytes(buffer);
    const loadingTask = getDocument({ data, disableWorker: true });
    const pdf = await loadingTask.promise;
    let text = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .filter(Boolean)
        .join(" ");
      if (pageText) {
        text += `${pageText}\n\n`;
      }
    }
    const doc = extractTextDocument({
      text,
      url,
      family,
      authority,
      snapshotId,
      source,
      documentType,
      title,
    });
    doc.warnings = text.trim().length === 0 ? ["PDF extraction produced empty text"] : [];
    return doc;
  } catch (error) {
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
      warnings: [`PDF extraction failed: ${error?.message || String(error)}`],
    };
  }
}
