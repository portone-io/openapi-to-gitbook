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
    pathGroup.items.map((item) =>
      getOperationMd(schema, { ...pathGroup, ...item })
    ),
  ]);
}

function getOperationMd(
  schema: ProcessedSchema,
  item: PathGroup & PathGroupItem,
): string {
  const { refMap, entityMap } = schema;
  const { path, methodOperation: { method, operation } } = item;
  const { summary, description, parameters = [], responses } = operation;
  const baseUrl = "https://api.portone.io";
  return arrayToString([
    `## ⌨ ${summary}\n`,
    `{% swagger method="${method}" path="${path}" baseUrl="${baseUrl}" summary=${
      JSON.stringify(description || summary)
    } %}\n`,
    // description
    parameters.map((p) => [
      `{% swagger-parameter in="${p.in}" name="${p.name}" type="${p.schema?.type}" required="${
        Boolean(p.required)
      }" %}\n`,
      p.description && p.description + "\n",
      `{% endswagger-parameter %}\n`,
    ]),
    Object.entries(responses).map(([status, res]) => {
      const schema = res.content!["application/json"].schema!;
      const refs = collectAllRefs(schema);
      return [
        `{% swagger-response status="${status}" description=${
          JSON.stringify(res.description)
        } %}\n`,
        chunk([
          getResTab("Response", schema),
          ...refs.sort(
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
          }),
        ], 4).map((tabs) => [
          `{% tabs %}\n`,
          tabs,
          `{% endtabs %}\n`,
        ]),
        `{% endswagger-response %}\n`,
      ];
    }),
    `{% endswagger %}\n`,
  ]);
  function getResTab(title: string, _schema: SchemaObject): string {
    const schema = resolve(_schema);
    const type = Array.isArray(schema.enum) ? "enum" : "object";
    return arrayToString([
      `{% tab title="${title}" %}\n`,
      type === "object"
        ? getResTabObject(schema)
        : type === "enum"
        ? getResTabEnum(schema)
        : "",
      `{% endtab %}\n`,
    ]);
  }
  function getResTabObject(schema: SchemaObject): string {
    const { properties = {} } = schema;
    const requiredSet = new Set<string>(schema.required || []);
    return arrayToString(
      Object.entries(properties).map(([key, value]) => {
        const typeName = getTypeName(value);
        const color = value.type === "boolean"
          ? "orange"
          : value.type === "integer"
          ? "blue"
          : value.type === "number"
          ? "blue"
          : value.type === "string"
          ? "green"
          : "red";
        return [
          `**\`${key}\`** ${
            requiredSet.has(key)
              ? `<mark style="color:red;">**\\***</mark>`
              : ""
          } <mark style="color:${color};">**${typeName}**</mark>\n\n`,
          value.description && value.description + "\n\n",
          "****\n\n",
        ];
      }),
    );
    function getTypeName(schema: SchemaObject): string {
      switch (schema.type) {
        case "object":
          return getRefName(String(schema["#ref"]));
        case "array":
          return `Array\\[${getTypeName(schema.items || {})}]`;
        default:
          return String(schema.type);
      }
    }
  }
  function getResTabEnum(schema: SchemaObject): string {
    return arrayToString([
      schema.description && schema.description + "\n\n",
      schema.default && `기본값: \`"${schema.default}"\`\n\n`,
      (schema.enum as string[]).map((v) => `\`"${v}"\``).join(", ") + "\n",
    ]);
  }
  function resolve(schema: SchemaObject): SchemaObject {
    if (schema.type) return schema;
    if (schema.oneOf) {
      return { ...resolve(schema.oneOf[0]), description: schema.description };
    }
    if (schema.allOf) {
      return Object.assign({}, ...schema.allOf.map(resolve), {
        description: schema.description,
      });
    }
    if (schema.$ref) {
      return refMap[schema.$ref] || entityMap[schema.$ref];
    }
    return schema;
  }
}

function getRefName(ref: string): string {
  return String(ref.split("/").pop());
}
function collectAllRefs(object: any): string[] {
  const refs: Set<string> = new Set();
  walk(object);
  return Array.from(refs);
  function walk(value: any) {
    if (typeof value !== "object") return;
    if (Array.isArray(value)) for (const item of value) walk(item);
    else {
      for (const [key, item] of Object.entries(value)) {
        if (key === "#ref") refs.add(String(item));
        else walk(item);
      }
    }
  }
}

interface PathGroup {
  tag: string;
  description: string;
  items: PathGroupItem[];
}
type PathGroupItem = ProcessedSchema["pathGroupByTags"][string][number];
function* pathGroups(schema: ProcessedSchema): Generator<PathGroup> {
  for (const [tag, items] of Object.entries(schema.pathGroupByTags)) {
    const description = String(
      schema.tags.find(({ name }) => name === tag)?.description,
    );
    yield { tag, description, items };
  }
}

type NestedStringArray = (string | undefined | NestedStringArray)[];
function arrayToString(array: NestedStringArray): string {
  return (array as string[]).flat(Infinity).filter((v) => v != null).join("");
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
