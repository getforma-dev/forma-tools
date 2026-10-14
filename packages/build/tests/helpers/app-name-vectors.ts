// The application-name grammar as data, shared with forma-server.
//
// COPIED from getforma-dev/forma, `crates/forma-server/tests/js/app_name_vectors.json`,
// at commit bcb66a5 (forma PR 16, FORMA-130's review follow-up). The build's `app` and forma-server's
// `sw::ServiceWorker::for_app` must accept exactly the same names (one string
// in both places), so both test the same table; a change to the grammar
// changes both copies in paired PRs. JSON escapes keep the hostile names
// visible.
export const APP_NAME_VECTORS: { readonly accepted: readonly string[]; readonly refused: readonly string[] } = {
  accepted: [
    "ledger",
    "ksx-studio",
    "9lives",
    "a",
    "0",
    "123",
    "a--b",
    "ledger-",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ],
  refused: [
    "",
    "Ledger",
    "LEDGER",
    "-ledger",
    "led:ger",
    "forma:ledger",
    "led ger",
    " ledger",
    "ledger ",
    "led_ger",
    "led.ger",
    "led/ger",
    "l\u00e9dger",
    "ledg\u0435r",
    "\uff4cedger",
    "led\"ger",
    "led'ger",
    "led\\ger",
    "led`ger",
    "${x}",
    "</script>",
    "ledger\n",
    "ledger\r",
    "led\u0000ger",
    "led\tger",
    "led\u2028ger",
    "led\u200bger",
    "\ufeffledger",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ],
};
