import { ensureDir } from "https://deno.land/std@0.168.0/fs/mod.ts";
import { dirname, resolve } from "https://deno.land/std@0.168.0/path/mod.ts";
import { Command } from "https://deno.land/x/cliffy@v0.25.5/command/mod.ts";
import { SchemaObject } from "./bake/schema/openapi-types.ts";
import { ProcessedSchema } from "./bake/schema/resolved-types.ts";

const { options } = await new Command()
  .name("openapi-to-gitbook")
  .description("Generate gitbook markdown files from openapi json")
  .option("--in <path:string>", "Json file path.", { required: true })
  .option("--out <path:string>", "Out directory.", { required: true })
  .parse(Deno.args);

await ensureDir(options.out);

const schema: ProcessedSchema = JSON.parse(await Deno.readTextFile(options.in));

// await write(["./SUMMARY.md"], getToc());

for (const pathGroup of pathGroups(schema)) {
  const { tag } = pathGroup;
  await write(
    [`./api-v2/${tag}.md`],
    getTagMd(schema, pathGroup),
  );
}

// function getToc(): string {
//   const result: string[] = [
//     "# Table of contents\n\n",
//   ];
//   for (const { tag, description, items } of pathGroups(schema)) {
//     result.push(`* [${description} API](./api-v2/${tag}/README.md)\n`);
//     for (const { methodOperation } of items) {
//       const { operationId, summary } = methodOperation.operation;
//       result.push(`  * [⌨ ${summary}](./api-v2/${tag}/${operationId}.md)\n`);
//     }
//   }
//   return result.join("");
// }

function getTagMd(schema: ProcessedSchema, pathGroup: PathGroup): string {
  return arrayToString([
    "---\n",
    `description: ${pathGroup.description}에 관련된 API 를 확인할 수 있습니다.\n`,
    "---\n",
    "\n",
    `# ${pathGroup.description} 관련 API\n\n`,
    pathGroup.items
      .filter(
        ({ methodOperation: { operation } }) =>
          Boolean((operation as any)["x-portone-public"]),
      )
      .map((item) => getOperationMd(schema, { ...pathGroup, ...item })),
  ]);
}

function getOperationMd(
  schema: ProcessedSchema,
  item: PathGroup & PathGroupItem,
): string {
  const { refMap, entityMap } = schema;
  const { path, methodOperation: { method, operation } } = item;
  const { summary, description, parameters = [], requestBody, responses } =
    operation;
  const requestBodySchema = requestBody?.content?.["application/json"]?.schema;
  const requestBodyRefs = requestBodySchema
    ? collectAllRefs(requestBodySchema, refMap, entityMap)
    : [];
  const baseUrl = "https://api.portone.io/v2";
  const swaggerSummary = (description || summary || "")
    .replaceAll(/\r?\n/g, " ") // replace newline to space
    .replaceAll(/\[(.*?)\]\(.*?\)/g, "$1"); // remove link
  return arrayToString([
    `## ⌨ ${summary}\n`,
    `{% swagger method="${method}" path="${path}" baseUrl="${baseUrl}" summary=${
      JSON.stringify(swaggerSummary)
    } %}\n`,
    parameters.map((p) => [
      `{% swagger-parameter in="${p.in}" name="${p.name}" type="${p.schema?.type}" required="${
        Boolean(p.required)
      }" %}\n`,
      p.description && p.description + "\n",
      `{% endswagger-parameter %}\n`,
    ]),
    requestBodySchema && reqBodyToParameters(requestBodySchema),
    Object.entries(responses).map(([status, res]) => {
      const schema = res.content?.["application/json"]?.schema;
      if (!schema) return "";
      const refs = collectEvenRefs(schema, refMap, entityMap);
      return [
        `{% swagger-response status="${status}" description=${
          JSON.stringify(res.description)
        } %}\n`,
        wrapTabs([getResTab("Response", schema), ...getTabs(refs)]),
        `{% endswagger-response %}\n`,
      ];
    }),
    `{% endswagger %}\n`,
    requestBodyRefs.length ? wrapTabs(getTabs(requestBodyRefs)) : "",
  ]);
  function reqBodyToParameters(_schema: SchemaObject): string {
    const schema = resolveSchema(_schema, refMap, entityMap);
    const type = Array.isArray(schema.enum) ? "enum" : "object";
    if (type !== "object") return "";
    const { properties = {} } = schema;
    const requiredSet = new Set<string>(schema.required || []);
    return arrayToString(
      Object.entries(properties).map(([key, _value]) => {
        const value = resolveSchema(_value, refMap, entityMap);
        const typeName = getTypeName(_value, value);
        return [
          `{% swagger-parameter in="body" name="${key}" type="${typeName}" required="${
            requiredSet.has(key) && !("default" in value)
          }" %}\n`,
          value.description && value.description + "\n",
          ("default" in value) && ` (기본값: \`"${value.default}")\`\n`,
          `{% endswagger-parameter %}\n`,
        ];
      }),
    );
  }
  function wrapTabs(tabs: string[]) {
    return chunk(tabs, 4).map((tabs) => [
      `{% tabs %}\n`,
      tabs,
      `{% endtabs %}\n`,
    ]);
  }
  function getTabs(refs: string[]): string[] {
    return refs.sort(
      (a, b) => (
        getRefName(a.toLowerCase()) < getRefName(b.toLowerCase()) ? -1 : 1
      ),
    ).map((ref) => {
      const title = getRefName(ref);
      const schema = refMap[ref] || entityMap[ref];
      if (schema == null) {
        console.log(title, ref);
        return "";
      }
      return getResTab(title, schema);
    });
  }
  function getResTab(title: string, schema: SchemaObject): string {
    return arrayToString([
      `{% tab title="${title}" %}\n`,
      getResTabContent(schema),
      `{% endtab %}\n`,
    ]);
  }
  function getResTabContent(_schema: SchemaObject, depth = 1): string {
    const schema = resolveSchema(_schema, refMap, entityMap);
    const type = Array.isArray(schema.enum) ? "enum" : "object";
    return type === "object"
      ? getResTabObject(schema, depth)
      : type === "enum"
      ? getResTabEnum(schema)
      : "";
  }
  function getResTabObject(schema: SchemaObject, depth = 1): string {
    const { properties = {} } = schema;
    const requiredSet = new Set<string>(schema.required || []);
    return arrayToString(
      Object.entries(properties).map(([key, _value]) => {
        const value = resolveSchema(_value, refMap, entityMap);
        const typeName = getTypeName(_value, value);
        const color = value.type === "boolean"
          ? "orange"
          : value.type === "integer"
          ? "blue"
          : value.type === "number"
          ? "blue"
          : value.type === "string"
          ? "green"
          : "red";
        const ref = getRef(value);
        const isObject = (
          (typeName === "object") &&
          Object.keys(value.properties || {}).length
        );
        const showDetail = (depth < 2) && (!value.enum) && (ref || isObject);
        return [
          `**\`${key}\`** ${
            requiredSet.has(key)
              ? `<mark style="color:red;">**\\***</mark>`
              : ""
          } <mark style="color:${color};">**${typeName}**</mark>\n\n`,
          value.enum
            ? getResTabEnum(value)
            : (value.description && value.description + "\n\n"),
          showDetail && [
            `<details>\n`,
            `<summary>${getRefName(ref || key)}</summary>\n\n`,
            getResTabContent(value, depth + 1),
            `\n</details>\n\n`,
          ],
          "****\n\n",
        ];
      }),
    );
  }
  function getRef(schema: SchemaObject): string | undefined {
    if (schema.type === "object") return schema["#ref"];
    if (schema.type === "array" && schema.items) return getRef(schema.items);
  }
  function getTypeName(
    _schema: SchemaObject,
    resolvedSchema?: SchemaObject,
  ): string {
    const schema = resolvedSchema || _schema;
    switch (_schema.type) {
      case "string":
        return getRefName(schema["#ref"] || "string");
      case "object":
        return getRefName(schema["#ref"] || "object");
      case "array":
        return `Array\\[${
          getTypeName(resolveSchema(_schema.items || {}, refMap, entityMap))
        }]`;
      default:
        return String(schema.type || "object");
    }
  }
  function getResTabEnum(schema: SchemaObject): string {
    return arrayToString([
      schema.description && schema.description + "\n\n",
      schema.default && `기본값: \`"${schema.default}"\`\n\n`,
      (schema.enum as string[]).map((v) => `\`"${v}"\``).join(", ") + "\n",
    ]);
  }
}

function getRefName(ref: string): string {
  return String(ref.split("/").pop());
}
function collectEvenRefs(
  schema: SchemaObject,
  refMap: ProcessedSchema["refMap"],
  entityMap: ProcessedSchema["entityMap"],
): string[] {
  const refs: Set<string> = new Set();
  walk(schema, false);
  return Array.from(refs);
  function walk(_schema: SchemaObject, hasParent: boolean) {
    const schema = resolveSchema(_schema, refMap, entityMap);
    if (schema.properties) {
      for (const [, item] of Object.entries(schema.properties)) {
        const ref = item["#ref"] || item.items?.["#ref"];
        if (ref && !refs.has(ref)) {
          const itemSchema = refMap[ref] || entityMap[ref];
          if (!itemSchema.enum && hasParent) refs.add(ref);
          walk(itemSchema, !hasParent);
        } else {
          if (item.type !== "array" && item.properties) {
            walk(item, !hasParent);
          }
        }
      }
    }
  }
}
function collectAllRefs(
  schema: SchemaObject,
  refMap: ProcessedSchema["refMap"],
  entityMap: ProcessedSchema["entityMap"],
): string[] {
  const refs: Set<string> = new Set();
  walk(schema);
  return Array.from(refs);
  function walk(_schema: SchemaObject) {
    const schema = resolveSchema(_schema, refMap, entityMap);
    if (schema.properties) {
      for (const [, item] of Object.entries(schema.properties)) {
        const ref = item["#ref"] || item.items?.["#ref"];
        if (ref && !refs.has(ref)) {
          const itemSchema = refMap[ref] || entityMap[ref];
          refs.add(ref);
          walk(itemSchema);
        } else {
          if (item.type !== "array" && item.properties) {
            walk(item);
          }
        }
      }
    }
  }
}

function resolveSchema(
  schema: SchemaObject,
  refMap: ProcessedSchema["refMap"],
  entityMap: ProcessedSchema["entityMap"],
): SchemaObject {
  if (schema.type) {
    if (schema.type === "array") return schema.items || schema;
    return schema;
  }
  if (schema.oneOf) {
    return {
      ...resolveSchema(schema.oneOf[0], refMap, entityMap),
      description: schema.description,
    };
  }
  if (schema.allOf) {
    const everySchema = schema.allOf
      .map((s) => resolveSchema(s, refMap, entityMap))
      .filter((s) => s.type === "object");
    const result = {
      ...everySchema[0],
      required: everySchema.map((s) => s.required || []).flat(1),
      properties: Object.assign(
        {},
        ...everySchema.map((s) => s.properties || {}),
      ),
      description: schema.description,
    };
    return result;
  }
  if (schema.$ref) {
    return refMap[schema.$ref] || entityMap[schema.$ref];
  }
  return schema;
}

interface PathGroup {
  tag: string;
  description: string;
  items: PathGroupItem[];
}
type PathGroupItem = ProcessedSchema["pathGroupByTags"][string][number];
function* pathGroups(schema: ProcessedSchema): Generator<PathGroup> {
  for (const [tag, items] of Object.entries(schema.pathGroupByTags)) {
    const t = schema.tags.find(({ name }) => name === tag);
    if (!t) continue;
    const description = String(t?.description);
    yield { tag, description, items };
  }
}

type NestedStringArray = (string | undefined | NestedStringArray)[];
function arrayToString(array: NestedStringArray): string {
  return (array as string[]).flat(Infinity).filter((v) => v).join("");
}

async function write(path: string[], text: string): Promise<void> {
  const target = resolve(options.out, ...path);
  await ensureDir(dirname(target));
  await Deno.writeTextFile(target, text);
}

function chunk<T>(arr: T[], size: number): T[][] {
  return Array(Math.ceil(arr.length / size)).fill(0).map(
    (_, index) => arr.slice(index * size, (index + 1) * size),
  );
}
