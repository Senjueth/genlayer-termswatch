// Asserts Watch and Recheck are enabled only when the contract would accept the call (run: node app/check-actions.mjs app/index.html).
import { readFileSync } from "node:fs";
const html = readFileSync(process.argv[2], "utf8");
const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const body = js.slice(js.indexOf("const URL_RE"), js.indexOf("const fields"));
const make = new Function("ctx", `let me = ctx.me; ${body}; return { problem, actions };`);
const ok = { name: "Plausible", url: "https://plausible.io/privacy", promises: "We never sell your data\nYou can delete your account" };
const run = (f, me = "0xa") => make({ me }).problem({ ...ok, ...f });
const check = (name, good) => { console.log(good ? "ok  " : "FAIL", name); if (!good) process.exitCode = 1; };

check("valid input enables Watch", run({}) === "");
check("no wallet: disabled with a prompt", run({}, null).includes("Connect"));
check("one-letter name", run({ name: " P " }) !== "");
check("plain http page", run({ url: "http://plausible.io/privacy" }) !== "");
check("no promises", run({ promises: "\n \n" }) !== "");
check("nine promises", run({ promises: Array.from({ length: 9 }, (_, i) => `promise number ${i}`).join("\n") }) !== "");
check("a short promise", run({ promises: "We never sell your data\nshort" }) !== "");
check("duplicate promises differing only in case and spacing", run({ promises: "We never sell data\nwe NEVER  sell data" }) !== "");
check("blank lines are ignored", run({ promises: "\nWe never sell your data\n\n" }) === "");
check("recheck needs a wallet", !make({ me: null }).actions({ id: 0 }).includes("data-act"));
check("anyone with a wallet can recheck", make({ me: "0xz" }).actions({ id: 3 }).includes('data-act="recheck" data-id="3"'));
