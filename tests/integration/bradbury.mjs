// End-to-end on Testnet Bradbury (Phase 2), on the packed code that is deployed:
//
//   python deploy/shrink.py contracts/terms_watch.py build/terms_watch.py --pack
//   npm i genlayer-js@2.0.0-rc.2   # plus the estimateTransactionFees patch in app/README.md
//   GL_PK0=0x... GL_PK1=0x... node tests/integration/bradbury.mjs build/terms_watch.py [contract]
//
// No value moves, so every transaction is only waited on until validators decide.
// Real policy: plausible.io/privacy, watched for two commitments it states; a commitment it
// does not state is refused as a baseline; a recheck of the same text is UNCHANGED.
// Changed policy: DEMO (this repo's gh-pages demo/policy.html, which `demo/policy-v2.html`
// replaces mid-run): the script watches v1, then waits until the live page serves v2 (push it
// to gh-pages when asked) and rechecks: the data-sale promise is dropped and refunds weakened.
// PART=real or PART=demo runs one half (demo needs the gh-pages site); default both.
// Every transaction carries a fee deposit from estimateTransactionFees.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const REAL = "https://plausible.io/privacy";
const REAL_PROMISES = ["We never sell your data", "You can delete your account, and all your data is permanently deleted"];
const DEMO = process.env.DEMO_URL ?? "https://termswatch.senju.quest/demo/policy.html";
const DEMO_PROMISES = ["We never sell or rent your personal data", "Refunds within 30 days of purchase, no questions asked", "You can export all your data at any time"];
// rpc.testnet-chain.genlayer.com (the chain default) does not serve gen_call; this one serves the same chain.
const endpoint = "https://rpc-bradbury.genlayer.com";
const a0 = createAccount(process.env.GL_PK0);
const a1 = createAccount(process.env.GL_PK1);
const c0 = createClient({ chain: testnetBradbury, endpoint, account: a0 });
const c1 = createClient({ chain: testnetBradbury, endpoint, account: a1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flaky = (e) => /fetch failed|ECONNRESET|timed out|socket|not valid JSON|terminated|unknown RPC error/i.test(`${e?.shortMessage} ${e?.details} ${e?.message}`);

async function retry(f) {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= 5 || !flaky(e)) throw e;
      await sleep(10000);
    }
  }
}
const fees = (c) => retry(async () => {
  const e = await c.estimateTransactionFees({});
  return { distribution: e.distribution, feeValue: e.feeValue };
});
// The public RPC drops connections now and then; retry the wait, never the write.
const wait = (c, hash) => retry(() => c.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 5000, retries: 240 }));
const check = (ok, what) => {
  console.log(ok ? "  ok  " : "  FAIL", what);
  if (!ok) process.exit(1);
};
let address, w;
// A leader timeout (NOT_VOTED) executed nothing, so sending the call again is safe.
async function tx(c, label, functionName, args) {
  for (let i = 0; ; i++) {
    const hash = await c.writeContract({ address, functionName, args, value: 0n, fees: await fees(c) });
    const r = await wait(c, hash);
    console.log(`${label}: ${hash} ${r.txExecutionResultName}`);
    if (r.txExecutionResultName !== "NOT_VOTED" || i >= 2) return r;
  }
}
const plain = (x) => (x instanceof Map ? Object.fromEntries([...x].map(([k, y]) => [k, plain(y)])) : Array.isArray(x) ? x.map(plain) : typeof x === "bigint" ? Number(x) : x);
const read = async (functionName, args = []) => plain(await retry(() => c0.readContract({ address, functionName, args })));
const ok = async (c, label, fn, args) => { const r = await tx(c, label, fn, args); check(r.txExecutionResultName === "FINISHED_WITH_RETURN", `${label} succeeds`); };
const fails = async (c, label, fn, args) => { const r = await tx(c, label, fn, args); check(r.txExecutionResultName === "FINISHED_WITH_ERROR", `${label} reverts`); };
const show = (w) => console.log(`    watch ${w.id}: ${w.status} states=${w.states.join(",")} sha=${w.text_sha256.slice(0, 12)} checks=${w.checks}`);
const sha = async (url) => createHash("sha256").update(Buffer.from(await (await fetch(url, { cache: "no-store" })).arrayBuffer())).digest("hex");

address = process.argv[3];
if (!address) {
  const hash = await c0.deployContract({ code: readFileSync(process.argv[2], "utf8"), args: [], fees: await fees(c0) });
  const r = await wait(c0, hash);
  address = r.txDataDecoded?.contractAddress;
  console.log(`deploy: ${hash} ${r.txExecutionResultName} -> ${address}`);
  check(r.txExecutionResultName === "FINISHED_WITH_RETURN", "deployed");
}

const PART = process.env.PART ?? "both";
if (PART !== "demo") {
// Refused: pages that cannot be a baseline.
await fails(c1, "watch a page that does not exist", "watch", ["Missing", "https://plausible.io/no-such-policy-page", JSON.stringify(REAL_PROMISES)]);
await fails(c1, "watch a promise the page does not make", "watch", ["Plausible", REAL, JSON.stringify(["All account data is stored only in the United States"])]);

// The real policy: baseline, then an unchanged recheck by someone else.
const real = await read("get_count");
await ok(c0, "watch plausible.io/privacy", "watch", ["Plausible Analytics privacy policy", REAL, JSON.stringify(REAL_PROMISES)]);
w = await read("get_watch", [real]);
show(w);
check(w.status === "HELD" && w.states.every((s) => s === "kept"), "baseline: every commitment kept");
await ok(c1, "recheck plausible.io/privacy", "recheck", [real]);
w = await read("get_watch", [real]);
show(w);
check((await read("get_history", [real, 0])).at(-1).outcome === "UNCHANGED" && w.checks === 2, "same text: UNCHANGED, decided without the model");
await fails(c1, "recheck a watch that does not exist", "recheck", [real + 100]);

}
if (PART !== "real") {
// The demo policy: v1, then v2.
const demo = await read("get_count");
await ok(c0, "watch demo policy v1", "watch", ["Acme Cloud (demo) terms", DEMO, JSON.stringify(DEMO_PROMISES)]);
show(await read("get_watch", [demo]));
const v1 = await sha(DEMO);
console.log(`waiting for ${DEMO} to serve v2 (publish demo/policy-v2.html as demo/policy.html on gh-pages)`);
while ((await sha(DEMO)) === v1) await sleep(30000);
await sleep(120000); // let every CDN edge serve v2
await ok(c1, "recheck demo policy v2", "recheck", [demo]);
w = await read("get_watch", [demo]);
show(w);
check(w.status === "BROKEN", "v2: BROKEN");
check(w.states[0] === "dropped" && w.states[1] === "weakened" && w.states[2] === "kept", "data sale dropped, refunds weakened, export kept");
check((await read("get_history", [demo, 0])).map((h) => h.outcome).join() === "BASELINE,CHANGED", "history keeps both");
}
console.log("contract", address);
