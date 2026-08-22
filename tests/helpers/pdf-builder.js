const encoder = new TextEncoder();

export function buildPdfWithPageContents(pageContents) {
  const pageObjectNumbers = pageContents.map((_, index) => 4 + index * 2);
  const objects = [
    { objectNumber: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    {
      objectNumber: 2,
      body: `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageContents.length} >>`,
    },
    { objectNumber: 3, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
  ];

  for (const [index, content] of pageContents.entries()) {
    const pageObjectNumber = 4 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    objects.push(
      {
        objectNumber: pageObjectNumber,
        body: `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObjectNumber} 0 R >>`,
      },
      {
        objectNumber: contentObjectNumber,
        body: `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`,
      },
    );
  }

  return buildPdfObjects(objects);
}

function buildPdfObjects(objects) {
  const offsets = new Map();
  const sorted = [...objects].sort((left, right) => left.objectNumber - right.objectNumber);
  let pdf = "%PDF-1.4\n";
  for (const object of sorted) {
    offsets.set(object.objectNumber, encoder.encode(pdf).byteLength);
    pdf += `${object.objectNumber} 0 obj\n${object.body}\nendobj\n`;
  }

  const xrefOffset = encoder.encode(pdf).byteLength;
  const objectCount = Math.max(...sorted.map((object) => object.objectNumber)) + 1;
  pdf += `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber < objectCount; objectNumber += 1) {
    const offset = offsets.get(objectNumber);
    pdf += offset === undefined
      ? "0000000000 65535 f \n"
      : `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Root 1 0 R /Size ${objectCount} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}
