import {
  OperationObject,
  ParameterObject,
  SchemaObject,
  TagObject,
} from "./openapi-types.ts";

export type Method =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch"
  | "trace";

export interface MethodOperationObject {
  method:
    | "get"
    | "put"
    | "post"
    | "delete"
    | "options"
    | "head"
    | "patch"
    | "trace";
  operation: OperationObject;
}
export interface PathGroup {
  [tag: string]: {
    path: string;
    methodOperation: MethodOperationObject;
  }[];
}

type ParameterType = "query" | "path" | "header" | "cookie";
export type GroupedParameters = Record<ParameterType, ParameterObject[]>;

export interface ProcessedSchema {
  tags: TagObject[];
  pathGroupByTags: PathGroup;
  refMap: Record<string, SchemaObject>;
  entityMap: Record<string, SchemaObject>;
}
