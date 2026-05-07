#!/usr/bin/env node

const USAGE = `Usage: arb <command> [options]

Commands:
  start                         Start the arb daemon (local mode)
  client [name]                 Start as a worker client (server mode)
  status [--json]               Show session and poller status
  kick <source> <key> [message] Manually dispatch an event
  jira <command> [args]         Jira CLI operations

Options:
  --config <path>               Path to config file (default: arb.json)

Run 'arb <command> --help' for details on a specific command.`;

// Extract --config before subcommand routing so all commands can use it
const configIdx = process.argv.indexOf("--config");
if (configIdx !== -1 && process.argv[configIdx + 1]) {
  process.env.ARB_CONFIG_PATH = process.argv[configIdx + 1];
  process.argv.splice(configIdx, 2);
}

const command = process.argv[2];

if (!command || command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(0);
}

// Strip the subcommand from argv so downstream CLIs see the right args
process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];

switch (command) {
  case "start":
    import("./index.js");
    break;
  case "client":
    import("./client-cli.js");
    break;
  case "status":
    import("./status-cli.js");
    break;
  case "kick":
    import("./kick-cli.js");
    break;
  case "jira":
    import("./jira-cli.js");
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    console.log(USAGE);
    process.exit(1);
}
