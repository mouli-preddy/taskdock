# Plugin LLM Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give plugins full access to LLM capabilities — SDK calls (Claude/Copilot), launching interactive terminals (Claude/Copilot with and without showing), and programmatic UI navigation to switch to the terminal tab.

**Architecture:** Plugins already have stub `ctx.ai.claude()` and `ctx.ai.copilot()` methods. We'll implement these by adding new message types (`ai:claude`, `ai:copilot`, `ai:terminal`, `ui:navigate`) that the wrapper script sends to the host process. The PluginScriptRunner will intercept these messages, delegate to the real Claude/Copilot providers and ChatTerminalService, then write results back to the child process via a response file. For terminal launches, a new `ctx.ai.launchTerminal()` API spawns an interactive chat terminal and optionally navigates to it. For navigation, `ctx.ui.navigate(section)` triggers a frontend section switch.

**Tech Stack:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Copilot SDK (`@github/copilot-sdk`), ChatTerminalService (node-pty), WebSocket bridge

---

### Task 1: Extend Plugin SDK Types

**Files:**
- Modify: `src/shared/plugin-types.ts`
- Modify: `src/main/plugins/schema/plugin-sdk.d.ts`

**Step 1: Add new types to plugin-types.ts**

Add `PluginNavigateEvent` interface after the existing `PluginToastEvent`:

```typescript
export interface PluginNavigateEvent {
  pluginId: string;
  section: string;
}
```

**Step 2: Extend the Plugin SDK type definitions**

In `src/main/plugins/schema/plugin-sdk.d.ts`, expand the `ai` and `ui` sections:

```typescript
/** AI provider calls */
ai: {
  /** Send a prompt to Claude SDK and get a text response */
  claude(prompt: string, opts?: { model?: 'sonnet' | 'opus' | 'haiku' }): Promise<string>;
  /** Send a prompt to GitHub Copilot SDK and get a text response */
  copilot(prompt: string, opts?: { model?: 'gpt-4o' | 'gpt-4' | 'gpt-5' | 'claude-3.5-sonnet' }): Promise<string>;
  /** Launch an interactive AI terminal session. Returns the session ID. */
  launchTerminal(opts: {
    ai: 'copilot' | 'claude';
    prompt: string;
    /** Switch the UI to the terminal tab (default: false) */
    show?: boolean;
  }): Promise<string>;
};

/** UI manipulation */
ui: {
  update(componentId: string, data: any): Promise<void>;
  toast(message: string, level?: 'success' | 'error' | 'warning' | 'info'): Promise<void>;
  inject(tab: string, location: string, component: any): Promise<void>;
  /** Navigate the app to a section: 'review', 'terminals', 'workitems', 'settings', or 'plugin-<id>' */
  navigate(section: string): Promise<void>;
};
```

**Step 3: Commit**

```
feat(plugins): extend SDK types with LLM and navigation APIs
```

---

### Task 2: Implement AI Delegation in PluginScriptRunner

**Files:**
- Modify: `src/main/plugins/plugin-script-runner.ts`

**Step 1: Add new callbacks to ScriptRunnerCallbacks**

Add these to the `ScriptRunnerCallbacks` interface:

```typescript
export interface ScriptRunnerCallbacks {
  onUIUpdate: (pluginId: string, componentId: string, data: any) => void;
  onUIInject: (pluginId: string, tab: string, location: string, component: any) => void;
  onToast: (pluginId: string, message: string, level: string) => void;
  onLog: (pluginId: string, level: string, message: string) => void;
  onNavigate: (pluginId: string, section: string) => void;
  onAIClaude: (pluginId: string, prompt: string, opts: any) => Promise<string>;
  onAICopilot: (pluginId: string, prompt: string, opts: any) => Promise<string>;
  onAILaunchTerminal: (pluginId: string, opts: { ai: 'copilot' | 'claude'; prompt: string; show?: boolean }) => Promise<string>;
}
```

**Step 2: Update the wrapper script to support request/response for AI calls**

The key challenge: AI calls are async and need to return data to the child process. The wrapper already uses stdout messages (`__PLUGIN_MSG__:`) for fire-and-forget messages. For request/response, we use a file-based protocol:

1. Child writes request to `req-<id>.json`
2. Parent detects it (via polling the stdout message), processes it, writes response to `res-<id>.json`
3. Child polls for response file

Update `ensureWrapperScript()` to rewrite the wrapper code. The new wrapper adds:

- `ctx.ai.claude(prompt, opts?)` — sends `ai:claude` request message, writes request file, waits for response file
- `ctx.ai.copilot(prompt, opts?)` — sends `ai:copilot` request message, same pattern
- `ctx.ai.launchTerminal(opts)` — sends `ai:terminal` request message, same pattern
- `ctx.ui.navigate(section)` — sends `ui:navigate` fire-and-forget message

The request/response flow in the wrapper:

```typescript
async function requestFromHost(type: string, payload: any): Promise<any> {
  const reqId = 'r' + Date.now() + Math.random().toString(36).slice(2, 6);
  const reqFile = path.join(path.dirname(contextFile), 'req-' + reqId + '.json');
  const resFile = path.join(path.dirname(contextFile), 'res-' + reqId + '.json');
  fs.writeFileSync(reqFile, JSON.stringify({ type, ...payload }));
  sendMessage({ type: 'host:request', reqId, reqFile, resFile });
  // Poll for response (100ms interval, up to 120s)
  for (let i = 0; i < 1200; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(resFile)) {
      const res = JSON.parse(fs.readFileSync(resFile, 'utf-8'));
      try { fs.unlinkSync(reqFile); } catch {}
      try { fs.unlinkSync(resFile); } catch {}
      if (res.error) throw new Error(res.error);
      return res.result;
    }
  }
  throw new Error('Host request timed out');
}
```

Then the AI context becomes:

```typescript
ai: {
  async claude(prompt: string, opts?: any) {
    return requestFromHost('ai:claude', { prompt, opts });
  },
  async copilot(prompt: string, opts?: any) {
    return requestFromHost('ai:copilot', { prompt, opts });
  },
  async launchTerminal(opts: any) {
    return requestFromHost('ai:terminal', { opts });
  },
},
```

And navigation:

```typescript
ui: {
  // ... existing methods ...
  async navigate(section: string) {
    sendMessage({ type: 'ui:navigate', section });
  },
},
```

**Step 3: Handle host:request messages in the parent process**

In `handleScriptMessage`, add handling for `host:request`:

```typescript
case 'host:request': {
  const { reqId, reqFile, resFile } = msg;
  this.handleHostRequest(pluginId, reqFile, resFile).catch(err => {
    // Write error response
    fs.writeFileSync(resFile, JSON.stringify({ error: err.message }));
  });
  break;
}
case 'ui:navigate':
  this.callbacks.onNavigate(pluginId, msg.section);
  break;
```

Add the async handler method:

```typescript
private async handleHostRequest(pluginId: string, reqFile: string, resFile: string): Promise<void> {
  const req = JSON.parse(fs.readFileSync(reqFile, 'utf-8'));
  let result: any;
  switch (req.type) {
    case 'ai:claude':
      result = await this.callbacks.onAIClaude(pluginId, req.prompt, req.opts || {});
      break;
    case 'ai:copilot':
      result = await this.callbacks.onAICopilot(pluginId, req.prompt, req.opts || {});
      break;
    case 'ai:terminal':
      result = await this.callbacks.onAILaunchTerminal(pluginId, req.opts);
      break;
    default:
      throw new Error(`Unknown host request type: ${req.type}`);
  }
  fs.writeFileSync(resFile, JSON.stringify({ result }));
}
```

**Step 4: Commit**

```
feat(plugins): implement AI request/response protocol in script runner
```

---

### Task 3: Wire Up AI Callbacks in PluginEngine and Bridge

**Files:**
- Modify: `src/main/plugins/plugin-engine.ts`
- Modify: `src-backend/bridge.ts`

**Step 1: Update PluginEngine to provide AI callbacks**

In the constructor, update the `PluginScriptRunner` instantiation to add the new callbacks:

```typescript
this.runner = new PluginScriptRunner({
  // ... existing callbacks ...
  onNavigate: (pluginId, section) => {
    this.emit('ui:navigate', { pluginId, section });
  },
  onAIClaude: async (pluginId, prompt, opts) => {
    return this.callClaude(prompt, opts);
  },
  onAICopilot: async (pluginId, prompt, opts) => {
    return this.callCopilot(prompt, opts);
  },
  onAILaunchTerminal: async (pluginId, opts) => {
    return this.launchAITerminal(pluginId, opts);
  },
});
```

Add the AI implementation methods to `PluginEngine`. These use the same providers the app already uses:

```typescript
private async callClaude(prompt: string, opts: any): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const model = opts?.model || 'sonnet';
  const response = query({ prompt, options: { model, maxTurns: 1 } });
  let result = '';
  for await (const message of response) {
    if (message.type === 'assistant' && message.message?.content) {
      result += message.message.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
    }
  }
  return result;
}

private async callCopilot(prompt: string, opts: any): Promise<string> {
  const { CopilotClient } = await import('@github/copilot-sdk');
  // Use singleton pattern matching copilot-provider.ts
  if (!this._copilotClient) {
    this._copilotClient = new CopilotClient();
    await this._copilotClient.start();
  }
  const model = opts?.model || 'gpt-4o';
  const session = await this._copilotClient.createSession({ model, streaming: false });
  try {
    return await new Promise<string>((resolve, reject) => {
      let content = '';
      session.on((event: any) => {
        if (event.type === 'assistant.message') content = event.data.content;
        else if (event.type === 'assistant.message_delta') content += event.data.deltaContent;
        else if (event.type === 'session.idle') resolve(content);
        else if (event.type === 'session.error') reject(new Error(event.data.message));
      });
      session.send({ prompt }).catch(reject);
    });
  } finally {
    await session.destroy();
  }
}

private _copilotClient: any = null;

private async launchAITerminal(pluginId: string, opts: { ai: 'copilot' | 'claude'; prompt: string; show?: boolean }): Promise<string> {
  // Emit a request for the bridge to create a chat terminal
  // The bridge handles ChatTerminalService directly
  return new Promise<string>((resolve, reject) => {
    this.emit('ai:launch-terminal', {
      pluginId,
      ...opts,
      callback: (sessionId: string, error?: string) => {
        if (error) reject(new Error(error));
        else resolve(sessionId);
      },
    });
  });
}
```

**Step 2: Handle navigate and terminal events in bridge.ts**

In `bridge.ts`, after the existing plugin event forwarding, add:

```typescript
pluginEngine.on('ui:navigate', (event) => broadcast('plugin:ui-navigate', event));

pluginEngine.on('ai:launch-terminal', (event) => {
  const { pluginId, ai, prompt, show, callback } = event;
  try {
    const contextPath = path.join(os.homedir(), '.taskdock', 'plugins', '_runtime', `terminal-${Date.now()}`);
    fs.mkdirSync(contextPath, { recursive: true });
    const sessionId = chatTerminalService.createSession({
      ai,
      workingDir: process.cwd(),
      contextPath,
      initialPrompt: prompt,
    });
    if (show) {
      broadcast('plugin:ui-navigate', { pluginId, section: 'terminals' });
    }
    callback(sessionId);
  } catch (err: any) {
    callback('', err.message);
  }
});
```

**Step 3: Commit**

```
feat(plugins): wire AI SDK and terminal launch callbacks through engine and bridge
```

---

### Task 4: Handle Navigation Events in Renderer

**Files:**
- Modify: `src/renderer/app.ts`
- Modify: `src/renderer/api.d.ts`

**Step 1: Add the event listener to api.d.ts**

In the `ElectronAPI` interface, add after `onPluginStateChanged`:

```typescript
onPluginNavigate: (callback: (event: { pluginId: string; section: string }) => void) => () => void;
```

**Step 2: Register the event in the Tauri preload/WebSocket handler**

Find where the other `onPlugin*` handlers are registered and add the navigate handler using the same pattern. The renderer communicates via WebSocket events, so this will just be listening for `plugin:ui-navigate`.

**Step 3: Handle the event in app.ts**

In `initPlugins()`, after the existing `onPluginUIInject` handler, add:

```typescript
window.electronAPI.onPluginNavigate((event: { pluginId: string; section: string }) => {
  this.switchSection(event.section as SectionId);
});
```

**Step 4: Commit**

```
feat(plugins): handle ui:navigate events in renderer for section switching
```

---

### Task 5: Update Hello World Plugin — Add AI Demo Tab and Workflows

**Files:**
- Modify: `src/main/plugins/examples/hello-world/manifest.json`
- Modify: `src/main/plugins/examples/hello-world/ui.json`
- Create: `src/main/plugins/examples/hello-world/workflows/ask-claude-sdk.ts`
- Create: `src/main/plugins/examples/hello-world/workflows/ask-copilot-sdk.ts`
- Create: `src/main/plugins/examples/hello-world/workflows/launch-claude-terminal.ts`
- Create: `src/main/plugins/examples/hello-world/workflows/launch-copilot-terminal.ts`

**Step 1: Add new triggers to manifest.json**

Add these manual triggers:

```json
{ "type": "manual", "id": "ask-claude-sdk", "workflow": "workflows/ask-claude-sdk.ts", "label": "Ask Claude (SDK)", "timeout": 120 },
{ "type": "manual", "id": "ask-copilot-sdk", "workflow": "workflows/ask-copilot-sdk.ts", "label": "Ask Copilot (SDK)", "timeout": 120 },
{ "type": "manual", "id": "launch-claude-terminal", "workflow": "workflows/launch-claude-terminal.ts", "label": "Claude Terminal" },
{ "type": "manual", "id": "launch-copilot-terminal", "workflow": "workflows/launch-copilot-terminal.ts", "label": "Copilot Terminal" }
```

**Step 2: Add an "AI" tab to ui.json**

In the tabs array (right side of the split panel), add a new tab after "Settings":

```json
{
  "label": "AI",
  "content": {
    "type": "detail-panel",
    "sections": [
      {
        "type": "header",
        "title": "AI Integration",
        "subtitle": "Test Claude & Copilot SDK and Terminal features"
      },
      {
        "type": "button-group",
        "id": "ai-sdk-buttons",
        "buttons": [
          { "label": "Ask Claude (SDK)", "icon": "brain", "action": "ask-claude-sdk", "variant": "primary" },
          { "label": "Ask Copilot (SDK)", "icon": "bot", "action": "ask-copilot-sdk" }
        ]
      },
      {
        "type": "card",
        "id": "ai-sdk-result",
        "label": "SDK Response",
        "content": "Click a button above to send a prompt via SDK"
      },
      {
        "type": "header",
        "title": "AI Terminals",
        "subtitle": "Launch interactive AI terminal sessions"
      },
      {
        "type": "button-group",
        "id": "ai-terminal-buttons",
        "buttons": [
          { "label": "Claude Terminal", "icon": "terminal", "action": "launch-claude-terminal", "variant": "primary" },
          { "label": "Copilot Terminal", "icon": "terminal", "action": "launch-copilot-terminal" }
        ]
      },
      {
        "type": "card",
        "id": "ai-terminal-result",
        "label": "Terminal Session",
        "content": "Click a button above to launch an interactive AI terminal"
      },
      {
        "type": "status-badge",
        "id": "ai-status",
        "value": "Ready",
        "colorMap": {
          "Ready": "#58a6ff",
          "Calling...": "#d29922",
          "Done": "#3fb950",
          "Error": "#f85149",
          "Launched": "#a371f7"
        }
      }
    ]
  }
}
```

**Step 3: Create ask-claude-sdk.ts**

```typescript
// Ask Claude via SDK — demonstrates ctx.ai.claude()

export default async function(ctx: any) {
  ctx.log.info('Calling Claude SDK...');
  await ctx.ui.update('ai-status', { value: 'Calling...' });
  await ctx.ui.update('ai-sdk-result', { label: 'SDK Response', content: 'Waiting for Claude...' });

  try {
    const response = await ctx.ai.claude('What is TaskDock in one sentence? (Make something up, this is a test.)');
    await ctx.ui.update('ai-sdk-result', {
      label: 'Claude SDK Response',
      content: response,
    });
    await ctx.ui.update('ai-status', { value: 'Done' });
    await ctx.ui.toast('Claude SDK response received', 'success');
    ctx.log.info('Claude SDK call succeeded');
  } catch (err: any) {
    await ctx.ui.update('ai-sdk-result', {
      label: 'Claude SDK Error',
      content: `Error: ${err.message}`,
    });
    await ctx.ui.update('ai-status', { value: 'Error' });
    await ctx.ui.toast(`Claude SDK failed: ${err.message}`, 'error');
    ctx.log.error(`Claude SDK error: ${err.message}`);
  }
}
```

**Step 4: Create ask-copilot-sdk.ts**

```typescript
// Ask Copilot via SDK — demonstrates ctx.ai.copilot()

export default async function(ctx: any) {
  ctx.log.info('Calling Copilot SDK...');
  await ctx.ui.update('ai-status', { value: 'Calling...' });
  await ctx.ui.update('ai-sdk-result', { label: 'SDK Response', content: 'Waiting for Copilot...' });

  try {
    const response = await ctx.ai.copilot('What is TaskDock in one sentence? (Make something up, this is a test.)');
    await ctx.ui.update('ai-sdk-result', {
      label: 'Copilot SDK Response',
      content: response,
    });
    await ctx.ui.update('ai-status', { value: 'Done' });
    await ctx.ui.toast('Copilot SDK response received', 'success');
    ctx.log.info('Copilot SDK call succeeded');
  } catch (err: any) {
    await ctx.ui.update('ai-sdk-result', {
      label: 'Copilot SDK Error',
      content: `Error: ${err.message}`,
    });
    await ctx.ui.update('ai-status', { value: 'Error' });
    await ctx.ui.toast(`Copilot SDK failed: ${err.message}`, 'error');
    ctx.log.error(`Copilot SDK error: ${err.message}`);
  }
}
```

**Step 5: Create launch-claude-terminal.ts**

```typescript
// Launch Claude interactive terminal — demonstrates ctx.ai.launchTerminal()

export default async function(ctx: any) {
  ctx.log.info('Launching Claude terminal...');
  await ctx.ui.update('ai-status', { value: 'Calling...' });
  await ctx.ui.update('ai-terminal-result', { label: 'Terminal Session', content: 'Launching Claude terminal...' });

  try {
    const sessionId = await ctx.ai.launchTerminal({
      ai: 'claude',
      prompt: 'You are a helpful assistant running inside TaskDock. Say hello and ask how you can help.',
      show: true,
    });
    await ctx.ui.update('ai-terminal-result', {
      label: 'Claude Terminal',
      content: `Session started: ${sessionId}\nThe terminal tab should now be active.`,
    });
    await ctx.ui.update('ai-status', { value: 'Launched' });
    await ctx.ui.toast('Claude terminal launched', 'success');
    ctx.log.info(`Claude terminal launched: ${sessionId}`);
  } catch (err: any) {
    await ctx.ui.update('ai-terminal-result', {
      label: 'Terminal Error',
      content: `Error: ${err.message}`,
    });
    await ctx.ui.update('ai-status', { value: 'Error' });
    await ctx.ui.toast(`Claude terminal failed: ${err.message}`, 'error');
    ctx.log.error(`Claude terminal error: ${err.message}`);
  }
}
```

**Step 6: Create launch-copilot-terminal.ts**

```typescript
// Launch Copilot interactive terminal — demonstrates ctx.ai.launchTerminal()

export default async function(ctx: any) {
  ctx.log.info('Launching Copilot terminal...');
  await ctx.ui.update('ai-status', { value: 'Calling...' });
  await ctx.ui.update('ai-terminal-result', { label: 'Terminal Session', content: 'Launching Copilot terminal...' });

  try {
    const sessionId = await ctx.ai.launchTerminal({
      ai: 'copilot',
      prompt: 'You are a helpful assistant running inside TaskDock. Say hello and ask how you can help.',
      show: true,
    });
    await ctx.ui.update('ai-terminal-result', {
      label: 'Copilot Terminal',
      content: `Session started: ${sessionId}\nThe terminal tab should now be active.`,
    });
    await ctx.ui.update('ai-status', { value: 'Launched' });
    await ctx.ui.toast('Copilot terminal launched', 'success');
    ctx.log.info(`Copilot terminal launched: ${sessionId}`);
  } catch (err: any) {
    await ctx.ui.update('ai-terminal-result', {
      label: 'Terminal Error',
      content: `Error: ${err.message}`,
    });
    await ctx.ui.update('ai-status', { value: 'Error' });
    await ctx.ui.toast(`Copilot terminal failed: ${err.message}`, 'error');
    ctx.log.error(`Copilot terminal error: ${err.message}`);
  }
}
```

**Step 7: Commit**

```
feat(plugins): add AI demo tab and workflows to hello-world example
```

---

### Task 6: Copy Updated Hello World to Installed Location

**Files:**
- Directory: `~/.taskdock/plugins/hello-world/` (user's installed plugin directory)

**Step 1: Copy all files from source**

Copy the entire `src/main/plugins/examples/hello-world/` directory contents to `~/.taskdock/plugins/hello-world/`, preserving directory structure. This includes:
- `manifest.json` (updated with new triggers)
- `ui.json` (updated with AI tab)
- `workflows/greet.ts`
- `workflows/reset.ts`
- `workflows/save-settings.ts`
- `workflows/on-event.ts`
- `workflows/ask-claude-sdk.ts` (new)
- `workflows/ask-copilot-sdk.ts` (new)
- `workflows/launch-claude-terminal.ts` (new)
- `workflows/launch-copilot-terminal.ts` (new)

The hot-reload watcher will pick up changes automatically.

**Step 2: Verify**

The plugin engine's file watcher should detect the changes and reload. No restart needed.

---

### Task 7: Update Plugin SDK README

**Files:**
- Modify: `src/main/plugins/schema/README.md`

**Step 1: Add AI section to the SDK documentation**

Add documentation about the new `ctx.ai` methods covering:
- `ctx.ai.claude(prompt, opts?)` — SDK call to Claude
- `ctx.ai.copilot(prompt, opts?)` — SDK call to Copilot
- `ctx.ai.launchTerminal({ ai, prompt, show? })` — Launch interactive terminal
- `ctx.ui.navigate(section)` — Switch app section

**Step 2: Commit**

```
docs(plugins): document AI and navigation APIs in plugin SDK README
```
