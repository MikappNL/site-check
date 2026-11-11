#!/usr/bin/env node
// @ts-check
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkBuild } from "../src/build.js";
import { CONFIG_FILE, loadConfig, parseConfig } from "../src/config.js";
import { checkLive } from "../src/live.js";
import { formatReport } from "../src/report.js";

const USAGE = `Usage:
  site-check build           check the built site before it goes online
  site-check live [address]  check what the live site answers (default: "site" from the config)

Options:
  --config <file>  the config file (default: ${CONFIG_FILE})`;

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { config: { type: "string", default: CONFIG_FILE }, help: { type: "boolean", short: "h" } },
});
const [command, address] = positionals;

try {
    if (values.help) {
        console.log(USAGE);
    } else if (command === "build") {
        const { report, pageCount } = await checkBuild(await loadConfig(values.config));
        console.log(formatReport(`site-check build: ${pageCount} pages`, report));
        process.exitCode = report.errorCount > 0 ? 1 : 0;
    } else if (command === "live") {
        const config = await liveConfig(values.config, address);
        const { report, pageCount } = await checkLive(config);
        console.log(formatReport(`site-check live ${config.site}: ${pageCount} pages`, report));
        process.exitCode = report.errorCount > 0 ? 1 : 0;
    } else {
        console.error(USAGE);
        process.exitCode = 2;
    }
} catch (error) {
    console.error(`site-check: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 2;
}

/**
 * An address on the command line checks another host, such as a client's site that has no config file.
 * @param {string} file
 * @param {string | undefined} address
 */
async function liveConfig(file, address) {
    if (!address) return loadConfig(file);
    const { site } = parseConfig({ site: address });
    const config = existsSync(file) ? await loadConfig(file) : parseConfig({ site });
    return { ...config, site };
}
