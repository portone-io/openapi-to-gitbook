import { ensureDir } from "https://deno.land/std@0.168.0/fs/mod.ts";
import { dirname, resolve } from "https://deno.land/std@0.168.0/path/mod.ts";
import { Command } from "https://deno.land/x/cliffy@v0.25.5/command/mod.ts";
import { ProcessedSchema } from "./bake/schema/resolved-types.ts";

const { options } = await new Command()
  .name("openapi-to-gitbook")
  .description("Generate gitbook markdown files from openapi json")
  .option("--in <path:string>", "Json file path.", { required: true })
  .option("--out <path:string>", "Out directory.", { required: true })
  .parse(Deno.args);

await ensureDir(options.out);

const schema: ProcessedSchema = JSON.parse(await Deno.readTextFile(options.in));

await write(["./SUMMARY.md"], getToc());

for (const pathGroup of pathGroups(schema)) {
  const { tag, items } = pathGroup;
  await write(
    [`./api-v2/${tag}/README.md`],
    getTagMd(pathGroup),
  );
  for (const item of items) {
    const { methodOperation: { operation: { operationId } } } = item;
    await write(
      [`./api-v2/${tag}/${operationId}.md`],
      getOperationMd({ ...pathGroup, ...item }),
    );
  }
}

function getToc(): string {
  const result: string[] = [
    "# Table of contents\n\n",
  ];
  for (const { tag, description, items } of pathGroups(schema)) {
    result.push(`* [${description} API](./api-v2/${tag}/README.md)\n`);
    for (const { methodOperation } of items) {
      const { operationId, summary } = methodOperation.operation;
      result.push(`  * [⌨ ${summary}](./api-v2/${tag}/${operationId}.md)\n`);
    }
  }
  return result.join("");
}

function getTagMd(pathGroup: PathGroup): string {
  return arrayToString([
    "---\n",
    `description: ${pathGroup.description}에 관련된 API 를 확인할 수 있습니다.\n`,
    "---\n",
    "\n",
    `# ${pathGroup.description}관련 API\n`,
  ]);
}

function getOperationMd(item: PathGroup & PathGroupItem): string {
  const { path, methodOperation: { method, operation } } = item;
  const { summary, description } = operation;
  const baseUrl = "https://api.iamport.kr";
  return arrayToString([
    `# ⌨ ${summary}\n`,
    `{% swagger method="${method}" path="${path}" baseUrl=${baseUrl} summary=${
      JSON.stringify(description || summary)
    } %}\n`,
    // description
    // parameter
    // response
    `{% endswagger %}`,
    // response schema
  ]);
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
