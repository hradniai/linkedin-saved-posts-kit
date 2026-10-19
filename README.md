# LinkedIn saved posts kit

This kit copies the posts you saved on LinkedIn into one folder on your computer. Each post gets its own folder with the text, the author, a link to the original and the images, and a list called `index.md` keeps them in the same order as LinkedIn. Your AI agent then sorts them into categories you choose yourself and pulls out what you will actually use: tools, links, methods, names. For each post it also tells you whether there is something in it or whether it is mostly self-promotion.

All of this is done by your own AI agent, a program such as Claude Code, Codex or Cursor that works with files on your computer and runs commands for you. You sign in to LinkedIn yourself and answer a few questions. One thing up front: the agent is an AI model. When that model runs in the cloud, which is the usual case for Claude Code, Codex and Cursor, the company that provides it receives everything the agent reads while it works, including the text and images of the saved posts it processes. Details are under [Privacy](#privacy).

## Where it works

Any AI agent that can work with files and with MCP servers. An MCP server is an add-on that gives the agent extra tools; this kit uses Chrome DevTools MCP, the official add-on from the Chrome DevTools team, so the agent can drive a separate Chrome window. Claude Code, Codex and Cursor can all do this. The optional automatic processing after each weekly download works only with Claude Code (more under [What happens](#what-happens)).

It runs on macOS, Windows and Linux. It was tested live on macOS. The Windows and Linux steps were written from the tools' documentation and a review of the code, not tested on a real machine; if you use one of them, the checklist below tells you what to watch.

<details>
<summary><b>Windows and Linux: what to check</b></summary>

- **Windows:** keep the kit and your data folder out of folders that OneDrive synchronizes (Documents and Desktop often are) and off drives formatted as FAT32 or exFAT, such as many USB sticks.
- **Windows with Codex:** the Chrome DevTools MCP documentation describes special settings for Codex on Windows (starting it through `cmd /c` and a longer start-up time); the agent points you to them, and [install-devtools.md](install-devtools.md) links them.
- **Windows weekly update:** it runs as a task in Task Scheduler, the part of Windows that starts programs at a set time, and only while you are logged on. A console window stays open during the run; closing it stops the run.
- **Linux weekly update:** it runs as a systemd user timer. The browser window needs your desktop session; if the run cannot open a window, the agent can switch it to a browser without a window.
- If anything behaves differently from this description, tell your agent what you see; it reads the error and adapts.

</details>

## Before you start

Not sure about any of this? Skip the list: the agent checks everything first, tells you what is missing and waits.

- **An AI agent** that can work with files and MCP servers, as above.
- **Google Chrome.**
- **Node.js**, a free program that runs JavaScript on your computer. Chrome DevTools MCP needs it, and the kit's own scripts run on it. Recommended: the current LTS version (long-term support, the stable one) from [nodejs.org](https://nodejs.org). An older version works only if it meets the minimum that Chrome DevTools MCP requires; the agent checks that. Installing Node.js means downloading the installer, clicking through it and entering your computer password.

The agent installs Chrome DevTools MCP for you once you allow it. The manual steps are in [install-devtools.md](install-devtools.md). You do not need any particular versions: the kit always uses the current version of every tool.

## Start

It takes about 20 to 40 minutes by our estimate, most of it the short interview about your posts, plus one restart of your agent if Chrome DevTools MCP has to be installed first.

1. **Get the kit.** On the kit's GitHub page, [github.com/hradniai/linkedin-saved-posts-kit](https://github.com/hradniai/linkedin-saved-posts-kit), click **Code**, then **Download ZIP**, and unzip it, or clone it with Git (`git clone https://github.com/hradniai/linkedin-saved-posts-kit.git`) if you know how. Put the folder somewhere you will keep it, for example in your home folder.
2. **Open your agent in the folder where you want your saved posts to live.** The data goes into a subfolder named `my-linkedin-saved-posts` there, so everything stays in one place. On a Mac, avoid starting it in Documents, Desktop or Downloads: macOS may later block the automatic weekly update from reading those folders. On Windows the same goes for folders synchronized by OneDrive.
3. **Paste this sentence** into the agent, with the path changed to where you put the kit:

   > Read INSTRUCTIONS.md in the folder `~/linkedin-saved-posts-kit` and set up downloading of my saved LinkedIn posts.

   The sentence is in English because the instructions are; the agent talks to you in your own language.

If you want the automatic weekly update, at the end you run one or two commands yourself in a terminal (the text window for typing commands): a test run and switching the schedule on. The agent prepares them and tells you what you should see. The decision whether anything runs on its own stays in your hands.

## What happens

1. **The agent checks your computer** for Node.js, Chrome and Chrome DevTools MCP. If Chrome DevTools MCP is missing, it asks whether it may install it, installs it and asks you to restart the agent, because new tools load only after a restart. After the restart write "continue" (in Claude Code, start it with `claude --continue`), or paste the sentence above again.
2. **It asks one question:** where to create the `my-linkedin-saved-posts` folder (by default in the folder you started it in) and whether to download images (by default yes). Nothing more.
3. **A separate Chrome window opens**, used only by the agent. You sign in to LinkedIn yourself, as usual. Never type your password to the agent. If LinkedIn offers "Keep me signed in", leave it on. If it asks for a verification code or a security check, you complete it yourself. Then write "done" to the agent.
4. **The first download.** The agent goes through your 50 most recently saved posts and downloads those published in the last 60 days. The publication date is exact: it is computed from the post's number. If none of them is that recent on the very first download, it takes the 10 most recently saved instead, so the next step has something to work with. Then it writes "Done: N posts downloaded".
5. **Setting up the processing.** Right away it shows you up to five of the most recently downloaded posts (all of them if there are fewer) and asks three things about each: why you saved it, which piece of information you would use, and what for. From your answers it proposes categories and what to do with your posts, for example your own overview of tools, content ideas or workshop material. It saves this in a file called `processor.md` in your folder and processes the posts right away. Whenever you want to change something, just tell it.
6. **The weekly update, if you want it.** The agent recommends once a week on a fixed day and time and strongly advises against running it more often than every 72 hours: LinkedIn forbids automated access, and the more often the list is read, the higher the risk that your account is restricted. Every later download, by hand or automatic, reads the list from the top only until it reaches posts it already knows, at most 80 posts. The download runs without AI and writes its result to a log. If nothing new turned up, it downloads nothing and says so.

   The agent also asks whether new posts should be processed right after each download. That works only through Claude Code, which must be installed on your computer and signed in with your Claude subscription. Each run uses your subscription's limits. The kit's script does not let Claude Code switch to an API key (a key that is billed separately) set in its environment; if such a key is set in Claude Code's own settings, the agent warns you. If you do not want this, or do not have Claude Code, the agent processes new posts the next time you open it in the `my-linkedin-saved-posts` folder.

From then on, open your agent in `my-linkedin-saved-posts` for anything about your saved posts. You can ask for an update any time, for example "update my saved LinkedIn posts".

The sign-in stays in the agent's browser profile until LinkedIn ends it, for example after a password change, signing out of all sessions or a security check. Then you sign in again with the agent, and the weekly update reminds you in its log.

## What changes on your computer

- **Chrome DevTools MCP** is added to your agent's list of MCP servers, with your consent. It is downloaded from the npm registry when it starts.
- **A separate Chrome profile** for the agent's browser: `~/.cache/chrome-devtools-mcp/chrome-profile` (on Windows `%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile`). Your LinkedIn sign-in lives there. Your everyday Chrome, its bookmarks and passwords stay untouched, and the agent does not see them.
- **Your data folder**, `my-linkedin-saved-posts`, described under [What you get](#what-you-get).
- **With Claude Code**, a file `.claude/agents/saved-posts-processor.md` inside your data folder: a helper agent that processes your posts and may only read and write files.
- **Only if you switch the weekly update on**, one scheduled job with a unique name that includes your agent, your folder's name and the date and time it was created, so it never replaces another job:
  - macOS: a file in `~/Library/LaunchAgents/`, run by launchd, the Mac's built-in scheduler;
  - Windows: a task in Task Scheduler;
  - Linux: a `.service` and a `.timer` file in `~/.config/systemd/user/`.

  The agent writes the job's name and the command that removes it into the `AGENTS.md` file in your data folder.

Nothing else is changed: no system settings, and no scheduled job you already have is replaced or removed.

**Undo.** In this order, and your agent can walk you through it:

1. Remove the scheduled job, if you switched one on, with the command from your `AGENTS.md`. For reference: macOS `launchctl bootout gui/$(id -u)/<job name>`, then delete the file in `~/Library/LaunchAgents/`; Windows `Unregister-ScheduledTask -TaskName "<job name>" -Confirm:$false` in PowerShell; Linux `systemctl --user disable --now <job name>.timer`, delete both files, then `systemctl --user daemon-reload`.
2. Sign out of LinkedIn in the agent's Chrome window, then quit the agent and delete the browser profile folder above (other uses of Chrome DevTools MCP lose their sign-ins too).
3. Ask your agent to remove the Chrome DevTools MCP server from its configuration, if you no longer want it.
4. Delete the `my-linkedin-saved-posts` folder and the kit folder.

## What you get

One folder, `my-linkedin-saved-posts`:

- **`index.md`**, the list of all your posts in LinkedIn's order: publication date, author, the start of the text, a link to the local copy and to the original.
- **`posts/<post number>/`**, one folder per post, with `post.md` to read, `post.json` for further processing by programs, images in `assets/` (plus the post's PDF or video when LinkedIn offers it for download in its data) and, after processing, `processing.json` with categories and the information pulled out.
- **`processor.md`**, your processing settings, and **`reviews/`**, overviews by category. An overview also tells you what images add when they explain something (a diagram, an example, data), that a post has a carousel or a video, and which posts have comments worth reading. Comments are not downloaded by default; ask the agent and it downloads them for the posts you pick. Other files, such as an overview of tools, appear depending on what you agree with the agent.
- **`AGENTS.md`**, the folder's basic settings, which you can change any time in plain words. Next to it `CLAUDE.md`, a link to the same file, so Claude Code reads it too.
- **`.state/`**, a hidden folder with technical state and logs. Leave it alone.

## Risks

LinkedIn's terms forbid using software or scripts to copy or scrape the service, and any unauthorized automated access ([User Agreement](https://www.linkedin.com/legal/user-agreement)). The terms name no safe limit, not for a small number of posts and not for one run a week. The risk that your account is restricted therefore cannot be put into numbers, and signing in by hand does not change that.

The kit only slows down and limits what it does. After loading the list it waits a moment, it scrolls with irregular pauses like a person reading, later downloads stop at posts it already knows, and it stops at every check or sign-in prompt. After such a stop it downloads nothing for 72 hours, unless you sign in again by hand through the agent. It works around nothing.

LinkedIn's official data export lists saved items only with a date and a link, not the text of the post ([Download your data](https://www.linkedin.com/help/linkedin/answer/a1339364/downloading-your-account-data?lang=en)). That is why this kit reads the saved-posts page in your signed-in browser.

The pages of individual posts load tools that detect bots. That is why downloading comments, which means opening each post separately, is off by default. Switch it on only knowingly, or ask for it for a few selected posts.

If you do not want to take this risk, do not use the kit.

## Privacy

The post files are stored only on your computer. The agent, however, works with an AI model, and if that model runs in the cloud, its provider receives everything the agent reads while it works.

- **While downloading**, that is mainly the address of the open page and short summaries of each run; post texts go straight into files.
- **While setting up the processing**, the agent shows you up to five whole posts, and **while processing** it reads every post it processes, including the downloaded images. So the provider receives each post's text, the author's name and description, links and mentions, images, comments if you download them, and your processing settings in `processor.md`.
- **Automatic processing through Claude Code** sends the same to Anthropic, always through your subscription, never through an API key.
- **Link checks**, if you switch them on, have the agent open links from the posts. Pages written by strangers can contain hidden instructions for AI. The agent is told to treat them only as data, but that is not complete protection.
- **Automatic processing after the weekly update runs unattended**, but Claude Code may then only read and write inside your folder, with no command line and no internet, so link checks never run there. After each run the kit's script also checks that nothing changed outside the outputs. If something did, for example `AGENTS.md`, `processor.md` or the downloaded posts, it puts it back, moves new files in places they should not be into a quarantine folder and writes this into the log. This protection does not reach the content of the outputs themselves: the overviews and files that processing creates can contain nonsense or misleading entries.

If you do not want any of this, use an agent with a local model, or do not use the kit.

The agent never reads or prints passwords or cookies and does not look inside the browser profile. The weekly update only checks whether another Chrome is using that profile at the moment; if none is, it removes the lock file left behind by a Chrome that did not close cleanly.

The downloaded files (`post.md`, `post.json` and images) are read-only, so processing cannot overwrite them by mistake. That is a safeguard, not a guarantee: an agent with access to the command line can change file permissions.

## When something goes wrong

| Situation | What to do |
|---|---|
| The agent says Node.js or Chrome is missing | Install what it names, then tell it to continue |
| The agent asks you to restart it | Quit it and start it again in the same folder; in Claude Code use `claude --continue`, then write "continue" |
| LinkedIn asks for a code or a security check | Complete it yourself in the agent's Chrome window, then tell the agent. Downloads pause for 72 hours unless you sign in again through the agent |
| The agent says the browser is already running | Another agent's Chrome holds the browser profile. Quit that Chrome or that agent, then try again |
| The weekly test run says "profile is in use" | The agent's Chrome is still open. Quit the agent (on a Mac, press Cmd+Q in that Chrome window too) and run the command again |
| The weekly run says "Could not check whether the browser profile is in use" or "Could not remove a stale browser lock" | Quit the agent and check that no Chrome window of that profile is left, then delete the lock file the message names and run the command again |
| On a Mac, the first weekly run asks whether `node` may control other applications | Allow it (System Settings, Privacy & Security); otherwise the weekly run cannot start Chrome |
| The weekly log says to sign in again | Open the agent in `my-linkedin-saved-posts` and ask it to sign you in again |
| On a Mac, the weekly log shows a permission error | The kit or the data folder is in Documents, Desktop or Downloads. Ask the agent to move them to your home folder and prepare the job again |
| The agent says LinkedIn changed how the saved list loads | The kit needs an update. Check the kit's page for a newer version |
| You want everything gone | Follow "Undo" under [What changes on your computer](#what-changes-on-your-computer) |

## About the author

This repository is maintained by Šimon Hradní (Hradni.AI, Prague). He helps individuals and companies start using agentic AI and supports companies in adopting AI across their whole ecosystem, through training, workshops, building AI ambassador programs, developing new services and hands-on implementation projects. If you want help with AI in your work or your company, from a first training session to company-wide AI adoption or a larger implementation, write to simon@hradni.net.

## License

Apache License 2.0 (see [LICENSE](LICENSE)). You may use, change and share this kit, also commercially. When you pass on a copy or a changed version, keep the [NOTICE](NOTICE) file, which credits the author and links to the original, and mark what you changed.

A friendly request, not a legal condition: if you write or talk about this kit, please mention Šimon Hradní and link to this repository. If you improve it, consider suggesting the change here (an issue or pull request) rather than publishing a separate copy, so everyone gets the improvement.
