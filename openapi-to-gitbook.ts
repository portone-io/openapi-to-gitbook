import { ensureDir } from "https://deno.land/std@0.168.0/fs/mod.ts";
import { resolve } from "https://deno.land/std@0.168.0/path/mod.ts";
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
  const result: string[] = [];
  return result.join("");
}

function getOperationMd(item: PathGroup & PathGroupItem): string {
  const result: string[] = [];
  return result.join("");
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

async function write(path: string[], text: string): Promise<void> {
  await Deno.writeTextFile(resolve(options.out, ...path), text);
}
