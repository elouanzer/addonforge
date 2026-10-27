'use strict';

// Stand-in for a tunnel binary in tests: `node fake-tunnel.js <mode> <url>`.
//   ok         print some noise, then the URL, then run until killed
//   ok-exit    like ok, but exit by itself after a moment (the tunnel dying)
//   crash      print an error and exit 1
//   silent     never print a URL

const [mode, url] = process.argv.slice(2);

if (mode === 'crash') {
  console.error('ERR failed to connect to the edge');
  process.exit(1);
}

console.error('INF starting tunnel');
if (mode !== 'silent') {
  setTimeout(() => console.log(`your url is: ${url}`), 100);
}
if (mode === 'ok-exit') setTimeout(() => process.exit(0), 1500);
setInterval(() => {}, 1000);
