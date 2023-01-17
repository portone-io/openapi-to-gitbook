import { parse } from "https://deno.land/std@0.168.0/encoding/yaml.ts";

export async function getPathsFromFragments(fragments: string[]) {
  const paths = (
    await Promise.all(
      fragments.map(async (fragmentPath) => {
        const paths = await getPathsFromFile(fragmentPath);
        return paths.map((path) => ({
          path,
          ref: `${fragmentPath}#/paths/${path.replaceAll("/", "~1")}`,
        }));
      }),
    )
  ).flat();
  return paths;
}

async function getPathsFromFile(path: string) {
  const file = await Deno.readTextFile(path);
  const parsed = parse(file) as any;
  return Object.keys(parsed.paths);
}
