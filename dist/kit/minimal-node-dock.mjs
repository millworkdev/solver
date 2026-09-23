/** Minimal public Node dock for Recipe 0. Use only with public/test candidates. */

import { createServer } from "node:http";
import { createOutputCheckRequestListener, publicAccess } from "./handler.mjs";
import { runHardCheck, scoreQuality } from "./minimal-output-check.mjs";

const listener = createOutputCheckRequestListener({
  access: publicAccess(),
  runHardCheck,
  scoreQuality,
});

createServer((request, response) => void listener(request, response))
  .listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
