#!/usr/bin/env node

const USAGE = `Usage: arb <command> [options]

Commands:
  start                         Start the arb daemon
  status [--json]               Show session and poller status
  kick <source> <key> [message] Manually dispatch an event
  jira <command> [args]         Jira CLI operations

Run 'arb <command> --help' for details on a specific command.`;

const command = process.argv[2];

if (!command || command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(0);
}

// Strip the subcommand from argv so downstream CLIs see the right args
// e.g. "arb kick jira LABS-919" → argv becomes [node, script, jira, LABS-919]
process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];

switch (command) {
  case "start":
    import("./index.js");
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
