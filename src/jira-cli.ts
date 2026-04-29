#!/usr/bin/env node
import "dotenv/config";
import { JiraClient } from "./jira-client.js";

const USAGE = `Usage: arb-jira <command> [args]

Commands:
  add_comment <issue-key> <body>       Add a comment to an issue
  get_issue <issue-key> [fields...]    Get issue details (optional field list)
  transition <issue-key> <id>          Transition issue status
  get_transitions <issue-key>          List available transitions
  edit_issue <issue-key> <json>        Update issue fields (JSON object)
  create_issue <json>                  Create issue (JSON fields object)
  search <jql> [fields...]             Search issues with JQL

Examples:
  arb-jira add_comment PROJ-123 "Looking into this."
  arb-jira transition PROJ-123 3
  arb-jira get_issue PROJ-123
  arb-jira get_issue PROJ-123 summary status
  arb-jira search "project = PROJ AND status = Open"
  arb-jira create_issue '{"project":{"key":"PROJ"},"issuetype":{"name":"Task"},"summary":"New task"}'
  arb-jira edit_issue PROJ-123 '{"summary":"Updated title"}'`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const client = new JiraClient();

  switch (command) {
    case "add_comment": {
      const [issueKey, ...bodyParts] = args;
      if (!issueKey || bodyParts.length === 0) {
        console.error("Usage: add_comment <issue-key> <body>");
        process.exit(1);
      }
      const result = await client.addComment(issueKey, bodyParts.join(" "));
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "get_issue": {
      const [issueKey, ...fields] = args;
      if (!issueKey) {
        console.error("Usage: get_issue <issue-key> [fields...]");
        process.exit(1);
      }
      const result = await client.getIssue(issueKey, fields.length ? fields : undefined);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "transition": {
      const [issueKey, transitionId] = args;
      if (!issueKey || !transitionId) {
        console.error("Usage: transition <issue-key> <transition-id>");
        process.exit(1);
      }
      await client.transition(issueKey, transitionId);
      console.log(`Transitioned ${issueKey} with transition ${transitionId}`);
      break;
    }

    case "get_transitions": {
      const [issueKey] = args;
      if (!issueKey) {
        console.error("Usage: get_transitions <issue-key>");
        process.exit(1);
      }
      const result = await client.getTransitions(issueKey);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "edit_issue": {
      const [issueKey, fieldsJson] = args;
      if (!issueKey || !fieldsJson) {
        console.error("Usage: edit_issue <issue-key> <json>");
        process.exit(1);
      }
      await client.editIssue(issueKey, JSON.parse(fieldsJson));
      console.log(`Updated ${issueKey}`);
      break;
    }

    case "create_issue": {
      const [fieldsJson] = args;
      if (!fieldsJson) {
        console.error("Usage: create_issue <json>");
        process.exit(1);
      }
      const result = await client.createIssue(JSON.parse(fieldsJson));
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "search": {
      const [jql, ...fields] = args;
      if (!jql) {
        console.error("Usage: search <jql> [fields...]");
        process.exit(1);
      }
      const result = await client.search(jql, fields.length ? fields : undefined);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
