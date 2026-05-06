import type { MonitorEvent } from "./events.js";
import type { DispatcherPort } from "./dispatcher-port.js";
import { Dispatcher } from "./dispatcher.js";
import { ServerQueueDispatcher } from "./server-dispatcher.js";

export interface ArbConfig {
  arbServerUrl?: string;
  arbServerToken?: string;
  opencodeUrl?: string;
  owner?: string;
  promptDir?: string;
  stateDir?: string;
  directoryResolver: (event: MonitorEvent) => string | undefined;
}

export function createDispatcher(config: ArbConfig): DispatcherPort {
  if (config.arbServerUrl && config.arbServerToken) {
    return new ServerQueueDispatcher({
      arbServerUrl: config.arbServerUrl,
      arbServerToken: config.arbServerToken,
      promptDir: config.promptDir,
      owner: config.owner,
    });
  }

  return new Dispatcher({
    serverUrl: config.opencodeUrl,
    owner: config.owner,
    promptDir: config.promptDir,
    stateDir: config.stateDir,
    directoryResolver: config.directoryResolver,
  });
}
