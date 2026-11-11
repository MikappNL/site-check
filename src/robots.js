// @ts-check

/**
 * The sitemap addresses a robots.txt points to.
 * @param {string} robots
 */
export function sitemapsIn(robots) {
    return rules(robots)
        .filter((rule) => rule.field === "sitemap")
        .map((rule) => rule.value);
}

/**
 * Whether robots.txt tells every crawler to stay away from the whole site: right for a site that is not open yet, a
 * costly leftover after the handover.
 * @param {string} robots
 */
export function blocksEverything(robots) {
    /** @type {string[]} */
    let agents = [];
    let inRules = false;
    for (const { field, value } of rules(robots)) {
        if (field === "user-agent") {
            // Consecutive user-agent lines share the rules that follow them.
            if (inRules) agents = [];
            inRules = false;
            agents.push(value);
        } else if (field === "allow" || field === "disallow") {
            inRules = true;
            if (field === "disallow" && value === "/" && agents.includes("*")) return true;
        }
    }
    return false;
}

/** @param {string} robots */
function rules(robots) {
    return robots
        .split(/\r?\n/)
        .map((line) => line.replace(/#.*/, "").trim())
        .filter((line) => line.includes(":"))
        .map((line) => {
            const colon = line.indexOf(":");
            return { field: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() };
        });
}
