import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaDir = path.join(__dirname, "..", "..", "schema");
const validators = new Map();

async function loadValidator(schemaFile) {
  if (validators.has(schemaFile)) {
    return validators.get(schemaFile);
  }
  const raw = await fs.readFile(path.join(schemaDir, schemaFile), "utf8");
  const schema = JSON.parse(raw);
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  const validator = { ajv, validate };
  validators.set(schemaFile, validator);
  return validator;
}

export async function assertSchema(doc, label = "document") {
  return assertAgainstSchema(doc, "document.schema.json", label);
}

export async function assertCliEnvelope(envelope, label = "CLI envelope") {
  return assertAgainstSchema(envelope, "cli-envelope.schema.json", label);
}

export async function assertArtifact(artifact, label = "artifact") {
  return assertAgainstSchema(artifact, "artifact.schema.json", label);
}

async function assertAgainstSchema(value, schemaFile, label) {
  const { ajv, validate } = await loadValidator(schemaFile);
  const valid = validate(value);
  if (!valid) {
    const details = ajv.errorsText(validate.errors, { separator: " | " });
    throw new Error(`Schema validation failed for ${label}: ${details}`);
  }
}
