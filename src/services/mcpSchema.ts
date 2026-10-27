import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { Schema } from "effect";

/**
 * Bridges an Effect schema to what the MCP SDK advertises and validates with.
 *
 * Effect exposes Standard Schema v1 `validate` (`toStandardSchemaV1`) and a
 * Standard-JSON-Schema converter (`toStandardJSONSchemaV1`) as two separate
 * objects; the SDK wants both halves on one `~standard` property. Merging
 * them is the whole bridge.
 *
 * The casts exist because Effect's `StandardSchemaV1`/`StandardJSONSchemaV1`
 * types are structurally identical to the SDK's but nominally unrelated.
 */
export function mcpSchema<S extends Schema.Constraint>(
  schema: S
): StandardSchemaWithJSON<S["Encoded"], S["Type"]> & S {
  const standard = Schema.toStandardSchemaV1(schema as never) as any;
  const withJson = Schema.toStandardJSONSchemaV1(schema) as any;
  Object.assign(standard["~standard"], withJson["~standard"]);
  return standard;
}

/**
 * Pipeable description annotation, e.g. `Schema.String.pipe(describe("Name"))`.
 *
 * The explicit `<S extends Schema.Top>` on the returned function is required:
 * without it the generic is fixed at the outer call, the helper degrades to
 * `(self: Top) => Top["Rebuild"]`, and every field it touches silently widens
 * the enclosing struct's `.Type` to `{}` — i.e. handler arguments stop being
 * typed and nothing reports an error.
 */
export const describe =
  (text: string) =>
  <S extends Schema.Top>(self: S): S["Rebuild"] =>
    Schema.annotate({ description: text })(self) as S["Rebuild"];
