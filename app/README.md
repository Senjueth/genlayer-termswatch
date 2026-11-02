# Demo app

A static page that talks to the contract deployed on GenLayer Testnet Bradbury (address in the page header).
Reads work without a wallet; writes go through MetaMask.

Files:
- `index.html` — the page
- `gl.js` — wallet + read/write helpers
- `app.css` — styles
- `check-actions.mjs` — asserts the Watch and Recheck controls are enabled only when the contract would accept the call (`node app/check-actions.mjs app/index.html`, runs in CI)
- `genlayer.js` — not committed; a browser bundle of `genlayer-js@2.0.0-rc.2` (Bradbury Phase 2, fee deposits):

```bash
npm i genlayer-js@2.0.0-rc.2 esbuild
printf 'export { createClient, createAccount } from "genlayer-js";\nexport { testnetBradbury } from "genlayer-js/chains";\n' > entry.js
# rc.2's fee estimate calls FeeManager without a sender and fails on Phase 2 (insufficient funds
# for 0x0); pass the connected account until upstream fixes it:
sed -i.bak 's/publicClient.call({ to: address, data, gasPrice: receiptGasPrice/publicClient.call({ account: client.account?.address, to: address, data, gasPrice: receiptGasPrice/' node_modules/genlayer-js/dist/index.js
npx esbuild entry.js --bundle --format=esm --minify --platform=browser --outfile=app/genlayer.js
```

Every write carries a fee deposit from `estimateTransactionFees`; the unused part is refunded. No call moves GEN.

Serve the folder with any static server (`python -m http.server -d app`). Fonts (Plus Jakarta Sans, JetBrains Mono) load from Google Fonts; without them the system font is used. The `gh-pages` branch carries the built `genlayer.js`.
