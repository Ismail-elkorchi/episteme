import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.join(__dirname, "..", "..", "schema", "document.schema.json");

let cachedValidator = null;

async function loadValidator() {
  if (cachedValidator) {
    return cachedValidator;
  }
  const raw = await fs.readFile(schemaPath, "utf8");
  const schema = JSON.parse(raw);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  cachedValidator = { ajv, validate };
  return cachedValidator;
}

export async function assertSchema(doc, label = "document") {
  const { ajv, validate } = await loadValidator();
  const valid = validate(doc);
  if (!valid) {
    const details = ajv.errorsText(validate.errors, { separator: " | " });
    throw new Error(`Schema validation failed for ${label}: ${details}`);
  }
}
