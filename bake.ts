import { Command } from "https://deno.land/x/cliffy@v0.25.5/command/mod.ts";

const { options } = await new Command()
  .name("bake")
  .description("Bake openapi yaml files into one json")
  .option("--in <path:string>", "Entrypoint yaml file path.")
  .option("--out <path:string>", "Out json path.")
  .parse(Deno.args);

console.log(options);
