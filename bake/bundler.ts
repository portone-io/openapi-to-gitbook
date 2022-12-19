import {
  BaseResolver,
  bundle,
  Config,
  detectOpenAPI,
  Document,
  normalizeTypes,
  Oas2Types,
  Oas3_1Types,
  Oas3Types,
  OasMajorVersion,
  OasVersion,
  openAPIMajor,
  resolveDocument,
} from "npm:@redocly/openapi-core";
import {
  ResolvedConfig,
  StyleguideConfig,
} from "npm:@redocly/openapi-core/lib/config";
import { ProcessedSchema } from "./schema/resolved-types.ts";
import {
  OpenApiObject,
  ParameterObjectWithRef,
  SchemaObjectWithRef,
} from "./schema/openapi-types.ts";
import { getSchemaResolver } from "./resolver.ts";

export interface RawApiSchema {
  schema: OpenApiObject;
  refMap: Record<string, SchemaObjectWithRef | ParameterObjectWithRef>;
}

export interface PathOption {
  type: "ignore" | "include";
  items: string[];
}
export interface ProcessConfig {
  pathToApi: string;
  pathOption?: PathOption;
}
export async function processOpenAPISchema({
  pathToApi,
  pathOption = { type: "ignore", items: [] },
}: ProcessConfig): Promise<ProcessedSchema> {
  const { schema, refMap } = await bundleOpenAPISchema(pathToApi);
  const paths = Object.fromEntries(
    Object.entries(schema.paths).filter(([path]) => {
      return pathOption.type === "include"
        ? pathOption.items.includes(path)
        : !pathOption.items.includes(path);
    }),
  );
  const dereferenced: string[] = [];
  const resolver = getSchemaResolver({ schema, refMap }, dereferenced);
  const resolvedPaths = resolver.resolvePaths(paths);
  const entityMap = Object.fromEntries(
    Object.entries(refMap).filter(([ref]) => dereferenced.includes(ref)),
  );
  return {
    tags: schema.tags ?? [],
    pathGroupByTags: resolver.groupPathsByTags(resolvedPaths),
    refMap: resolver.resolveRefMap(refMap),
    entityMap: resolver.resolveEntityMap(entityMap),
  };
}

export async function bundleOpenAPISchema(
  pathToApi: string,
): Promise<RawApiSchema> {
  const config = new Config({} as ResolvedConfig);
  const { bundle: document } = await bundle({
    ref: pathToApi,
    config,
    dereference: false,
  });
  const refMap = await getRefMap(document, config.styleguide);
  return { schema: document.parsed as OpenApiObject, refMap };
}

async function getRefMap(document: Document, config: StyleguideConfig) {
  const oasVersion = detectOpenAPI(document.parsed);
  const oasMajorVersion = openAPIMajor(oasVersion);
  const types = normalizeTypes(
    config.extendTypes(
      oasMajorVersion === OasMajorVersion.Version3
        ? oasVersion === OasVersion.Version3_1 ? Oas3_1Types : Oas3Types
        : Oas2Types,
      oasVersion,
    ),
    config,
  );
  const baseResolver = new BaseResolver();
  const resolvedRefMap = await resolveDocument({
    rootDocument: document,
    rootType: types.Root!,
    externalRefResolver: baseResolver,
  });
  const normalizedRefMap = Object.fromEntries(
    [...resolvedRefMap.entries()].map(([k, v]) => [
      k.split("::")[1],
      v.node as SchemaObjectWithRef | ParameterObjectWithRef,
    ]),
  );
  return normalizedRefMap;
}
