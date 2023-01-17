import { ensureDir } from "https://deno.land/std@0.168.0/fs/mod.ts";
import { dirname } from "https://deno.land/std@0.168.0/path/mod.ts";
import {
  parse,
  stringify,
} from "https://deno.land/std@0.168.0/encoding/yaml.ts";
import { Command } from "https://deno.land/x/cliffy@v0.25.5/command/mod.ts";
import { getPathsFromFragments } from "./bake/path-finder.ts";

const { options } = await new Command()
  .name("bake")
  .description("Bake federated openapi yaml file")
  .option(
    "--template <path:string>",
    "Template file path.",
    { required: true },
  )
  .option(
    "--out <path:string>",
    "Out yaml path.",
    { required: true },
  )
  .parse(Deno.args);

const templateYaml = await Deno.readTextFile(options.template);
const template = parse(templateYaml) as { yamls: string[] };

const result = await combinePaths();

await ensureDir(dirname(options.out));
await Deno.writeTextFile(options.out, stringify(result));

async function combinePaths() {
  const result: any = { ...template };
  delete result.yamls;
  const paths = await getPathsFromFragments(template.yamls);
  const keys = [...new Set(paths.map((path) => path.path))];
  result.paths = {};
  for (const key of keys) {
    const currentPaths = paths.filter((path) => path.path === key);
    result.paths[key] = currentPaths.length === 1
      ? { $ref: "." + currentPaths[0].ref }
      : { allOf: currentPaths.map((path) => ({ $ref: "." + path.ref })) };
  }
  return result;
}
