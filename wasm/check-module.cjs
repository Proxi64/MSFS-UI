// Checks a built module before it is installed: node check-module.cjs <file.wasm> [forbidden string]...
// - every import is the sim's (env.fs*) or the C library's (wasi_snapshot_preview1.*): anything else (such as
//   __stack_chk_fail) means a compiler flag is missing;
// - the exports the sim needs are there (entry points, memory functions of the SDK's libc, the function table);
// - none of the given strings (the build machine's paths and user name) is in the binary.
const fs = require('fs');

const required = [
  'memory', '__indirect_function_table', '__wasm_call_ctors', 'module_init', 'module_deinit',
  'malloc', 'free', 'mallinfo', 'mchunkit_begin', 'mchunkit_next', 'get_pages_state', 'mark_decommit_pages',
];

const bytes = fs.readFileSync(process.argv[2]);
const compiled = new WebAssembly.Module(bytes);
const problems = [];

for (const entry of WebAssembly.Module.imports(compiled)) {
  const allowed = (entry.module === 'env' && entry.name.startsWith('fs')) || entry.module === 'wasi_snapshot_preview1';
  if (!allowed) problems.push(`import outside the sim's API: ${entry.module}.${entry.name}`);
}
const exported = new Set(WebAssembly.Module.exports(compiled).map((entry) => entry.name));
for (const name of required) {
  if (!exported.has(name)) problems.push(`missing export: ${name}`);
}
const content = bytes.toString('latin1').toLowerCase();
for (const forbidden of process.argv.slice(3)) {
  if (forbidden && content.includes(forbidden.toLowerCase())) problems.push('a path or name of this machine is in the binary');
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check failed: ${problem}`);
  process.exit(1);
}
console.log(`checks OK: ${WebAssembly.Module.imports(compiled).length} imports, ${exported.size} exports, no personal data`);
