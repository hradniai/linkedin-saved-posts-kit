# Installing Chrome DevTools MCP (manual steps)

Chrome DevTools MCP is the official tool from the Chrome DevTools team that lets your AI agent drive a separate Chrome window. Source and documentation: [github.com/ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp).

Normally the agent installs it for you. These steps are for when you want to do it by hand, or when the agent gets stuck.

## What you need

- Google Chrome, the current stable version.
- Node.js, recommended the current LTS version from [nodejs.org](https://nodejs.org). Chrome DevTools MCP does not work without it, because it starts through `npx`, which comes with Node.js. The command `npm view chrome-devtools-mcp@latest engines` shows the minimum version Chrome DevTools MCP currently requires; `node -v` shows the version you have.
- An AI client (your agent program) that supports MCP.

## Installing

The commands always use the newest version (`@latest`), as the weekly update does. Restart your client after installing; new tools load only then.

**Claude Code:**

```
claude mcp add chrome-devtools --scope user -- npx -y chrome-devtools-mcp@latest
```

**Codex:**

```
codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest
```

Codex keeps its settings in a file called `config.toml` in the folder named by the `CODEX_HOME` variable, or, when that is not set, in the `.codex` folder in your home folder. For Codex on Windows, the Chrome DevTools MCP documentation describes special settings (starting through `cmd /c npx` and a longer start-up time); you find them in [client-configurations.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/client-configurations.md).

**Other clients** (Cursor, VS Code, Gemini CLI, Windsurf, Cline, JetBrains and others) accept the standard configuration:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

Where to put it in each client is described in [client-configurations.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/client-configurations.md). If the server does not connect on Windows, check there whether your client needs to start `npx` through `cmd /c`.

Two optional switches for `args`:

- `--no-usage-statistics` turns off the usage statistics the tool otherwise sends to Google.
- `--filesystemRoot=<path to your my-linkedin-saved-posts folder>/.state/raw` lets the server save raw data straight into your folder. It is not needed: when the server refuses to write there, the agent uses the system's temporary folder and moves the data over itself.

**Check.** Write to the agent: "Open example.com in the browser and tell me the page title." A Chrome window should open, and the agent should answer "Example Domain".

## The browser profile and signing in

The server starts a separate Chrome with its own profile, which is kept between starts: `~/.cache/chrome-devtools-mcp/chrome-profile` (on Windows `%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile`). You sign in to it once and the sign-in stays. The agent does not see your everyday Chrome, its bookmarks or passwords. Only one Chrome can use the profile at a time. That is why the weekly update does not run while the agent's browser is open, and why two agents (for example Claude Code and Codex) cannot have the browser open at the same time. If the agent reports that the browser is already running, close the other agent's Chrome. The error message's advice to use `--isolated` does not apply here.

The documentation warns that some websites may refuse a sign-in in a browser controlled by automation. If LinkedIn did that, you can start Chrome yourself with a debugging port and let the server only connect to it (`--browserUrl`, see the documentation, "advanced usage"). Connecting to your everyday Chrome (`--autoConnect`) is not recommended for this kit: the agent would see all your open windows.

Do not use the `--isolated` switch: it creates an empty profile every time, and you would have to sign in again each time.

## Signing out and cleaning up

- You can sign out of LinkedIn directly in the agent's window.
- Full reset: close the agent (and with it its Chrome) and delete the profile folder named above.
- Never copy your everyday Chrome profile into the agent's profile and never export cookies. The kit needs nothing of the kind.
