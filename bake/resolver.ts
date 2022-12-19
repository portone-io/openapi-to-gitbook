import {
  OperationObject,
  OperationObjectWithRef,
  ParameterObject,
  ParameterObjectWithRef,
  PathItemObject,
  PathItemObjectWithRef,
  PathsObjectWithRef,
  ReferenceObject,
  RequestBodyObjectWithRef,
  ResponseObject,
  ResponseObjectWithRef,
  ResponsesObject,
  ResponsesObjectWithRef,
  SchemaObject,
  SchemaObjectWithRef,
} from "./schema/openapi-types.ts";
import {
  GroupedParameters,
  Method,
  MethodOperationObject,
  PathGroup,
} from "./schema/resolved-types.ts";
import { RawApiSchema } from "./bundler.ts";

export const methods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

export function getSchemaResolver(
  payload: RawApiSchema,
  dereferenced: string[] = [],
) {
  const refMap = payload.refMap;
  return {
    groupPathsByTags,
    resolvePaths,
    resolveRefMap,
    resolveEntityMap,
    resolveParametersWithRef,
    resolveOperationObjectWithRef,
    resolveResponsesObjectWithRef,
    resolveSchemaObjectWithRef: resolveSchemaObjectWithRefOrRefObject,
  };
  function resolvePaths(paths: PathsObjectWithRef) {
    return Object.fromEntries(
      Object.entries(paths).map(([path, nodeOrAllOfs]) => {
        const node = nodeOrAllOfs.allOf
          ? mergePathItemObjects(
            nodeOrAllOfs.allOf.map((el) => resolvePathItemObjectWithRef(el)),
          )
          : nodeOrAllOfs;
        return [
          path,
          Object.fromEntries(
            methods
              .filter((method) => node[method] != null)
              .map((method) => {
                const operation = node[method];
                if (!operation) throw new Error("Unreachable Error");
                return [method, resolveOperationObjectWithRef(operation)];
              }),
          ) as Record<Method, OperationObject>,
        ];
      }),
    );
  }
  function resolveRefMap(
    refMap: Record<string, SchemaObjectWithRef | ParameterObjectWithRef>,
  ) {
    return Object.fromEntries(
      Object.entries(refMap)
        .filter(([, node]) => !("in" in node))
        .map(([ref, node]) => {
          return [ref, resolveSchemaObjectWithRefOrRefObject(node)];
        }),
    );
  }
  function resolveEntityMap(
    entityMap: Record<string, SchemaObjectWithRef | ParameterObjectWithRef>,
  ) {
    return Object.fromEntries(
      Object.entries(entityMap)
        .filter(([, node]) => !("in" in node))
        .map(([ref, node]) => {
          return [ref, resolveSchemaObjectWithRefOrRefObject(node)] as const;
        })
        .filter(([, node]) => node.type === "object" || node.enum != null),
    );
  }

  function groupPathsByTags(paths: PathsObjectWithRef) {
    return Object.entries(paths)
      .map(([path, node]) => {
        return [
          path,
          methods
            .map((method) => {
              const operation = node[method];
              if (!operation) return null;
              return {
                method,
                operation,
              };
            })
            .filter((v): v is MethodOperationObject => v != null),
        ] as [string, MethodOperationObject[]];
      })
      .reduce((group, current) => {
        const [path, methodOperations] = current;
        methodOperations.forEach((methodOperation) => {
          methodOperation.operation.tags?.forEach((tag) => {
            if (group[tag]) group[tag]!.push({ path, methodOperation });
            else group[tag] = [{ path, methodOperation }];
          });
        });
        return group;
      }, {} as PathGroup);
  }
  function resolveParametersWithRef(
    parameters?: (ReferenceObject | ParameterObjectWithRef)[],
  ): ParameterObject[] {
    return (
      parameters?.map((parameter) => {
        if ("schema" in parameter) {
          // deref
          return {
            ...parameter,
            schema: resolveSchemaObjectWithRefOrRefObject(parameter.schema),
          } as ParameterObject;
        }
        if ("$ref" in parameter) {
          // deref
          return refMap[parameter.$ref] as ParameterObject;
        }
        return parameter as ParameterObject;
      }) ?? []
    );
  }
  function resolveOperationObjectWithRef(
    operationObjectWithRef: OperationObjectWithRef,
  ): OperationObject {
    return {
      ...operationObjectWithRef,
      parameters: resolveParametersWithRef(operationObjectWithRef.parameters),
      responses: resolveResponsesObjectWithRef(
        operationObjectWithRef.responses,
      ),
      requestBody: resolveRequestBodyObjectWithRef(
        operationObjectWithRef.requestBody,
      ),
      // @TODO(hyp3rflow): Resolve below properties
      callbacks: undefined,
    };
  }
  function resolvePathItemObjectWithRef(
    pathItemObjectWithRef: PathItemObjectWithRef | ReferenceObject,
  ) {
    if (pathItemObjectWithRef.$ref) {
      return refMap[pathItemObjectWithRef.$ref] as PathItemObject;
    }
    // @TODO(hyp3rflow): Resolve internal properties if needed
    return pathItemObjectWithRef as PathItemObject;
  }
  function resolveRequestBodyObjectWithRef(
    requestBody: ReferenceObject | RequestBodyObjectWithRef | undefined,
  ) {
    if (!requestBody) return undefined;
    if (isReferenceObject(requestBody)) throw new Error("TODO");
    const content = requestBody.content["application/json"];
    if (!content) return undefined;
    const resolvedSchema = content.schema?.$ref
      ? refMap[content.schema.$ref]
      : content.schema;
    return {
      ...requestBody,
      content: {
        ["application/json"]: {
          schema: resolveSchemaObjectWithRefOrRefObject(resolvedSchema),
        },
      },
    };
  }
  function resolveResponsesObjectWithRef(
    responses: ResponsesObjectWithRef,
  ): ResponsesObject {
    return Object.fromEntries(
      Object.entries(responses).map(([code, response]) => {
        if ("$ref" in response) {
          const deref = refMap[response.$ref] as ResponseObjectWithRef;
          const content = deref.content?.["application/json"]?.schema;
          if (content && content.$ref) {
            return [
              code,
              {
                ...deref,
                content: {
                  ["application/json"]: {
                    schema: resolveSchemaObjectWithRefOrRefObject(content),
                  },
                },
              },
            ];
          }
          return [code, content];
        }
        if ((response as any).schema) {
          const schema = (response as any).schema;
          const resolvedSchema = schema.$ref ? refMap[schema.$ref] : schema;
          return [
            code,
            {
              ...response,
              content: {
                ["application/json"]: {
                  schema: resolveSchemaObjectWithRefOrRefObject(resolvedSchema),
                },
              },
            },
          ];
        }
        const content = Object.fromEntries(
          Object.entries(response.content ?? {}).map(([mediaType, content]) => {
            if (!content.schema) throw new Error("Unexpected schema");
            const resolvedSchema = content.schema.$ref
              ? refMap[content.schema.$ref]
              : content.schema;
            return [
              mediaType,
              { schema: resolveSchemaObjectWithRefOrRefObject(resolvedSchema) },
            ];
          }),
        );
        // @TODO(hyp3rflow): Fully resolve this as ResponseObject
        return [code, { ...response, content } as ResponseObject];
      }),
    );
  }

  function resolveSchemaObjectWithRefOrRefObject<
    T extends SchemaObjectWithRef | ReferenceObject,
  >(object: T): SchemaObject;
  function resolveSchemaObjectWithRefOrRefObject<
    T extends SchemaObjectWithRef | ReferenceObject | undefined,
  >(object: T): SchemaObject | undefined;
  function resolveSchemaObjectWithRefOrRefObject<
    T extends SchemaObjectWithRef | ReferenceObject | undefined,
  >(object: T): SchemaObject | undefined {
    if (object == null) return object;
    if (isReferenceObject(object)) {
      dereferenced.push(object.$ref);
      return resolveSchemaObjectWithRef({
        ...refMap[object.$ref],
        ["#ref"]: object.$ref,
      });
    }
    return resolveSchemaObjectWithRef(object);
    function resolveSchemaObjectWithRef(
      objectWithRef: SchemaObjectWithRef,
    ): SchemaObject {
      return {
        ...objectWithRef,
        additionalProperties: {},
        allOf: objectWithRef.allOf?.map<SchemaObject>(
          resolveSchemaObjectWithRefOrRefObject,
        ),
        oneOf: objectWithRef.oneOf?.map<SchemaObject>(
          resolveSchemaObjectWithRefOrRefObject,
        ),
        anyOf: objectWithRef.anyOf?.map<SchemaObject>(
          resolveSchemaObjectWithRefOrRefObject,
        ),
        not: resolveSchemaObjectWithRefOrRefObject(objectWithRef.not),
        items: resolveSchemaObjectWithRefOrRefObject(objectWithRef.items),
        properties: Object.fromEntries(
          Object.entries(objectWithRef.properties ?? {}).map(([key, value]) => [
            key,
            resolveSchemaObjectWithRefOrRefObject(value),
          ]),
        ),
      };
    }
  }
}

export function groupParameterObject(
  parameters?: ParameterObject[],
): GroupedParameters {
  const path = parameters?.filter((param) => param.in === "path") ?? [];
  const query = parameters?.filter((param) => param.in === "query") ?? [];
  const header = parameters?.filter((param) => param.in === "header") ?? [];
  const cookie = parameters?.filter((param) => param.in === "cookie") ?? [];
  return { path, query, header, cookie };
}

function mergePathItemObjects(allOf: PathItemObject[]) {
  return allOf.reduce<PathItemObject>((acc, pathItem) => {
    return {
      ...acc,
      ...pathItem,
      parameters: acc.parameters?.concat(pathItem.parameters ?? []),
    };
  }, {} as PathItemObject);
}
export function mergeSchemaObjects(allOf: SchemaObject[]) {
  return allOf.reduce<SchemaObject>((acc, schema) => {
    if (acc.type && schema.type && acc.type !== schema.type) {
      throw new Error("TODO: Cannot merge with different type yet");
    }
    return mergeSchemaObject(acc, schema);
  }, {} as SchemaObject);
  function mergeSchemaObject(
    base: SchemaObject,
    addition: SchemaObject,
  ): SchemaObject {
    const required = (Array.isArray(base.required) || base.required == null) &&
        (Array.isArray(addition.required) || addition.required == null)
      ? [...(base.required ?? []), ...(addition.required ?? [])]
      : base.required || addition.required;
    return {
      ...base,
      ...addition,
      required,
      ["#ref"]: undefined,
      properties: mergeProperties(base.properties, addition.properties),
    };
  }
  function mergeProperties(
    base: SchemaObject["properties"],
    addition: SchemaObject["properties"],
  ): SchemaObject["properties"] {
    if (!base || !addition) return addition ?? base;
    const baseKeys = Object.keys(base);
    const additionKeys = Object.keys(addition);
    const duplicates = additionKeys.filter((key) => baseKeys.includes(key));
    const newEntries = [
      ...Object.entries(base).filter(([key]) => !duplicates.includes(key)),
      ...Object.entries(addition).filter(([key]) => !duplicates.includes(key)),
    ];
    if (duplicates.length > 0) {
      duplicates.forEach((dupe) => {
        newEntries.push([
          dupe,
          mergeSchemaObject(base[dupe]!, addition[dupe]!),
        ]);
      });
    }
    return Object.fromEntries(newEntries);
  }
}

export function isExplainableObject(schema: SchemaObject | undefined): boolean {
  if (!schema) return false;
  return (
    schema.type === "object" &&
    schema.properties != null &&
    Object.values(schema.properties).length > 0
  );
}

export function isEnumObject(schema: SchemaObject | undefined): boolean {
  if (!schema) return false;
  return (
    schema.type === "string" && schema.enum != null && schema.enum.length > 0
  );
}

function isReferenceObject(object: unknown): object is ReferenceObject {
  return typeof object === "object" && object != null && "$ref" in object;
}
