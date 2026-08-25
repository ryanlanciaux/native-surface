#!/usr/bin/env node
// Thin subcommand forwarder: the engine package owns the `native-surface` bin
// name; feature packages own the implementations. `playground` resolves
// @native-surface/playground from the HOST project (cwd), so the heavyweight
// tooling stays an optional devDependency of the app, not of the engine.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const USAGE = `Usage: native-surface <command> [options]

Commands:
  playground   Serve the component playground against the app in the current
               directory (requires @native-surface/playground).

Run \`native-surface playground --help\` for that command's options.`;

const [command, ...rest] = process.argv.slice(2);

if (command === 'playground') {
  const hostRequire = createRequire(`${process.cwd()}/__resolve__.mjs`);
  let cliPath;
  try {
    cliPath = hostRequire.resolve('@native-surface/playground/bin/cli.mjs');
  } catch {
    console.error(
      'native-surface playground needs @native-surface/playground installed in this project:\n\n' +
        '  npm i -D @native-surface/playground\n\n' +
        'then re-run: npx native-surface playground'
    );
    process.exit(1);
  }
  // The playground CLI parses process.argv from index 2 — drop the subcommand.
  process.argv = [process.argv[0], cliPath, ...rest];
  await import(pathToFileURL(cliPath).href);
} else if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
  console.log(USAGE);
} else {
  console.error(`native-surface: unknown command "${command}"\n\n${USAGE}`);
  process.exit(1);
}
