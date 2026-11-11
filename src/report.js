// @ts-check

/**
 * @typedef {object} Problem
 * @property {"error" | "warning"} level An error stops the build or the handover; a warning is worth a look.
 * @property {string} where The page address or file the problem is on.
 * @property {string} message Reads as a sentence after `where`: "/werk needs exactly one <h1>, has 2".
 */

export class Report {
    /** @type {Problem[]} */
    problems = [];

    /**
     * @param {string} where
     * @param {string} message
     */
    error(where, message) {
        this.problems.push({ level: "error", where, message });
    }

    /**
     * @param {string} where
     * @param {string} message
     */
    warning(where, message) {
        this.problems.push({ level: "warning", where, message });
    }

    get errorCount() {
        return this.problems.filter((problem) => problem.level === "error").length;
    }

    get warningCount() {
        return this.problems.length - this.errorCount;
    }
}

/**
 * @param {string} heading Such as "site-check build: 36 pages".
 * @param {Report} report
 */
export function formatReport(heading, report) {
    const lines = [`${heading}, ${plural(report.errorCount, "error")}, ${plural(report.warningCount, "warning")}`];

    /** @type {Map<string, Problem[]>} */
    const byPlace = new Map();
    for (const problem of report.problems) {
        byPlace.set(problem.where, [...(byPlace.get(problem.where) ?? []), problem]);
    }

    for (const [where, problems] of [...byPlace].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push("", where);
        for (const problem of problems) lines.push(`  ${problem.level.padEnd(7)}  ${problem.message}`);
    }
    return lines.join("\n");
}

/**
 * @param {number} count
 * @param {string} noun
 */
function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
