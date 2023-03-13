import { parse } from "https://deno.land/std@0.168.0/encoding/yaml.ts";

const template = parse(await Deno.readTextFile("./template.yaml"));
const yamlPaths: string[] = (template as any).yamls;

type NameAndUrlAndPaths = [serviceName: string, url: string, yamlPath: string];
const nameAndUrlAndPaths = yamlPaths.map((p) => {
  const kebabService = p.replace(/.+?\/([^\/]+?)-interface.+/, "$1");
  const service = kebabService.split("-").map((w) =>
    w[0].toUpperCase() + w.slice(1)
  ).join(" ");
  const url = p.replace(
    /.+?\/([^\/]+?)\/([^\/]+?)-interface.+/,
    "https://github.com/$1/$2",
  );
  return [service, url, p];
}).sort(([a], [b]) => a < b ? 1 : -1) as NameAndUrlAndPaths[];

type NameAndUrlAndYaml = [serviceName: string, url: string, yaml: any];
const nameAndUrlAndYamls = await Promise.all(
  [...nameAndUrlAndPaths].map(
    async ([serviceName, url, yamlPath]) =>
      [
        serviceName,
        url,
        parse(await Deno.readTextFile(yamlPath)),
      ] as const,
  ),
) as NameAndUrlAndYaml[];

function* extractPublicApis(yaml: any): Generator<string> {
  const paths = Object.entries<any>(yaml.paths).sort(
    ([a], [b]) => a < b ? -1 : 1,
  );
  for (const [apiPath, api] of paths) {
    for (const [method, apiObj] of Object.entries<any>(api)) {
      if (!apiObj["x-portone-public"]) continue;
      yield `${method.toUpperCase()} /v2${apiPath}`;
    }
  }
}

for (const [serviceName, url, yaml] of nameAndUrlAndYamls) {
  console.log(`## [${serviceName}](${url})`);
  for (const api of extractPublicApis(yaml)) {
    console.log(`- \`${api}\``);
  }
}
