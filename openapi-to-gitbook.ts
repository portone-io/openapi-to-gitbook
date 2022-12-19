import { Command } from "https://deno.land/x/cliffy@v0.25.5/command/mod.ts";

const { options } = await new Command()
  .name("openapi-to-gitbook")
  .description("Generate gitbook markdown files from openapi json")
  .option("--in <path:string>", "Json file path.")
  .option("--out <path:string>", "Out directory.")
  .parse(Deno.args);

console.log(options);
