import { ensureDir } from "https://deno.land/std@0.168.0/fs/mod.ts";
import { dirname } from "https://deno.land/std@0.168.0/path/mod.ts";
import { Command } from "https://deno.land/x/cliffy@v0.25.5/command/mod.ts";
import { processOpenAPISchema } from "./bake/bundler.ts";

const { options } = await new Command()
  .name("expand")
  .description("Expand openapi yaml file into json")
  .option(
    "--in <path:string>",
    "Entrypoint yaml file path.",
    { required: true },
  )
  .option(
    "--out <path:string>",
    "Out json path.",
    { required: true },
  )
  .parse(Deno.args);

const schema = await processOpenAPISchema({
  pathToApi: options.in,
});

await ensureDir(dirname(options.out));
await Deno.writeTextFile(options.out, JSON.stringify(schema, null, 2));
