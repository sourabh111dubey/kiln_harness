import { writeFile } from "node:fs/promises";
import { configJsonSchema } from "../packages/shared/src/config";

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kilncraft.dev/config.schema.json",
  title: "Kilncraft configuration",
  description: "Configuration schema for the kilncraft coding agent.",
  ...configJsonSchema,
};

await writeFile(
  new URL("../config.schema.json", import.meta.url),
  `${JSON.stringify(schema, null, 2)}\n`,
  "utf8",
);
