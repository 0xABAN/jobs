import { launch } from "../browser/chrome.ts";
import { paths } from "../shared/config.ts";
import { parse } from "./args.ts";

export async function browseCommand(args: string[]): Promise<number> {
  const [url = "about:blank"] = parse(args, {}, 1).positionals;
  console.log(await launch(paths.chromeProfile, url));
  return 0;
}
