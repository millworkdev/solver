import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { constants as fsConstants } from "node:fs";
export const STARTER_CONFIG_PATH = ".millwork" + "/starter.json";
export const POOL_STARTER_CONFIG_PATH = ".millwork" + "/pool-starter.json";
export const STARTER_ECHO_EXAMPLE_PATH = "examples" + "/starter-echo.ts";
export const STARTER_POOL_EXAMPLE_PATH = "examples" + "/starter-pool.ts";
export const STARTER_SCAFFOLD_CONTENTS = {
    [STARTER_CONFIG_PATH]: `${JSON.stringify({
        template_id: "starter",
        template_version: "1",
        request_preset_id: "starter-public-sandbox-v1",
        mode: "echo",
        provider_resource_created: false,
    }, null, 2)}\n`,
    [POOL_STARTER_CONFIG_PATH]: `${JSON.stringify({
        template_id: "pooled-open-model",
        template_version: "1",
        request_preset_id: "pooled-open-model-public-v1",
        access_lane: "millwork_pool",
        data_classes: ["public"],
        fallback_policy: "none",
        verifier: "platform.output_presence",
        provider_resource_created: false,
    }, null, 2)}\n`,
    ".env.example": [
        "# Secretless placeholders. Copy to .env locally; never commit a live key.",
        "SOLVERAPI_API_KEY=",
        "SOLVERAPI_BASE_URL=https://api.getmillwork.dev/",
        "",
    ].join("\n"),
    [STARTER_ECHO_EXAMPLE_PATH]: [
        "import { Solver } from \"@millwork/solver\";",
        "",
        "const solver = new Solver({",
        "  apiKey: process.env.SOLVERAPI_API_KEY ?? \"\",",
        "  baseUrl: process.env.SOLVERAPI_BASE_URL ?? 'https://api.getmillwork.dev/',",
        "});",
        "",
        "const receiptId = process.argv[2];",
        "if (!receiptId) {",
        `  throw new Error("usage: npx tsx ${STARTER_ECHO_EXAMPLE_PATH} <receipt_id>");`,
        "}",
        "",
        "const receipt = await solver.receipts.get(receiptId);",
        "process.stdout.write(`${JSON.stringify(receipt, null, 2)}\\n`);",
        "",
    ].join("\n"),
    [STARTER_POOL_EXAMPLE_PATH]: [
        "import { Solver } from \"@millwork/solver\";",
        "",
        "const solver = new Solver({",
        "  apiKey: process.env.SOLVERAPI_API_KEY ?? \"\",",
        "  baseUrl: process.env.SOLVERAPI_BASE_URL ?? 'https://api.getmillwork.dev/',",
        "});",
        "",
        "const executionId = process.argv[2];",
        "if (!executionId) {",
        `  throw new Error("usage: npx tsx ${STARTER_POOL_EXAMPLE_PATH} <execution_id>");`,
        "}",
        "",
        "const [result, receipt] = await Promise.all([",
        "  solver.executions.result(executionId),",
        "  solver.receipts.get(executionId),",
        "]);",
        "process.stdout.write(`${JSON.stringify({ result, receipt }, null, 2)}\\n`);",
        "",
    ].join("\n"),
};
export async function writeApprovedScaffold(cwd, manifest) {
    const written = [];
    const skippedExisting = [];
    for (const entry of manifest) {
        const content = STARTER_SCAFFOLD_CONTENTS[entry.path];
        if (content === undefined) {
            throw new Error(`refusing to write undeclared scaffold path ${entry.path}`);
        }
        if (entry.path.includes("..") || entry.path.startsWith("/")) {
            throw new Error(`refusing to write unsafe scaffold path ${entry.path}`);
        }
        const dest = join(cwd, entry.path);
        try {
            await access(dest, fsConstants.F_OK);
            skippedExisting.push(entry.path);
            continue;
        }
        catch {
            // missing is the write path
        }
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, content, { flag: "wx" });
        written.push(entry.path);
    }
    return { written, skipped_existing: skippedExisting };
}
