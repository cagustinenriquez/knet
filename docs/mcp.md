# AI assistants (MCP)

Status: **implemented** on branch `feature/mcp` (steps 1-4 of the plan below, outreach drafts, plus the snap
plug and privacy policy). Code: [src/main/mcp/](../src/main/mcp/). Tests: `test/mcp.test.js`,
`e2e/mcp.e2e.js`.

Let people use OkNetwork from Claude, Cursor, VS Code and other AI assistants and agents:
"show me this week's best React jobs", "move Catawiki to Interview and note the call is on
Thursday", "write a cover letter for this one".

## Goals

- Any assistant that supports **MCP** (Model Context Protocol) can read your jobs, matches,
  applications and profile, and (if you allow it) update them.
- **No servers to host.** Everything runs on the user's computer, like the rest of the app.
- **Off by default.** The user turns it on in Settings, and can choose read-only.
- One setup that covers Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Zed and
  agent frameworks (LangChain, the OpenAI Agents SDK, the Claude Agent SDK, …).

Not in scope for the first version: ChatGPT (see [ChatGPT](#chatgpt)), and the app itself
calling an AI (see [Later](#later)).

## How it works

```
 Claude Desktop ──stdio──▶ oknetwork --mcp ──┐
                            (small bridge)    │  HTTP, 127.0.0.1 only,
 Claude Code / Cursor /  ───────────────────▶ ├─ with a secret token ──▶ OkNetwork app
 VS Code / agents                             │                          (MCP server inside
                                              ┘                           the main process)
```

The **running app** is the MCP server. It listens on `http://127.0.0.1:<port>/mcp` using
MCP's Streamable HTTP transport (`@modelcontextprotocol/sdk`, MIT license).

- Clients that support HTTP servers (Claude Code, Cursor, VS Code, agent frameworks) connect
  to it directly.
- Clients that only start local programs (Claude Desktop) run `oknetwork --mcp`: the same app
  started in a small bridge mode that passes messages between stdin/stdout and the running
  app. It opens no window. If the app isn't running, it starts it in the tray first.

### Why the app is the server (and not a separate program reading the data file)

- **One writer.** The app saves `knet-data.json` all the time (new jobs, stage changes). A
  second program writing the same file would overwrite changes. Going through the app avoids
  that, and the UI updates live when an assistant changes something.
- **Same logic.** Searching, match scores, duplicate merging and stage history all live in
  the app's code already. The MCP tools call that code instead of copying it.
- **Snap.** A snap keeps its data in `~/snap/oknetwork/current/...`, which other programs
  shouldn't depend on. A localhost connection works the same on every platform.

### Do we need to host a server?

No. Nothing runs on the internet and nothing extra is installed: the MCP server is part of
the desktop app, on `127.0.0.1`. The assistant's model provider (Anthropic, OpenAI, …) sees
what the assistant reads through the tools, the same as anything else the user shares with
it.

The one exception is ChatGPT, which only connects to MCP servers on the public internet.

### Separate project (`knet-mcp`)?

**Recommendation: keep it in this repository**, as its own folder (`src/main/mcp/`) with its
own tests.

- The tools need the app's own code (store, scoring, dedupe, stages). In a separate repo
  they'd have to be copied or published as a library, and every change to the data model
  would need a matching release in two places.
- Users get it with the app they already have: no Node.js, no `npx`, no second install.
- The stdio bridge is the app binary itself (`oknetwork --mcp`), so it's always the matching
  version.

A separate `knet-mcp` package would make sense later if we want a **hosted** version for
ChatGPT, or an npm package for people who don't use the desktop app. The tool definitions
can be kept in one module so they're easy to move out then.

## Tools

Read tools (always available when MCP is on):

| Tool | What it does |
| --- | --- |
| `search_jobs` | Filter matches: text, minimum score, remote only, source, status (new, saved, applied, hidden), posted within N days. Returns a short list (id, title, company, location, score, posted). |
| `get_job` | One job: full description, match score with the reasons, "Also posted on", apply link, application stage and notes. |
| `fill_templates` | The user's own email (subject + body) and cover letter templates (Templates view), filled in for one job, plus contacts and any variables still missing. Assistants start from these when drafting, so drafts keep the user's voice, structure and links. |
| `get_new_matches` | Recently found jobs at or above the alert threshold that no assistant has handled yet (no `record_outreach`), with contact details. Excludes hidden and applied jobs. |
| `list_applications` | The Applications board: each job's stage, last change and notes. |
| `get_profile` | Titles, skills, soft skills, years, locations, threshold. No email. |
| `get_stats` | Counts: new matches, applications per stage, response rate. |

Write tools (only when "Allow changes" is on):

| Tool | What it does |
| --- | --- |
| `set_job_status` | Save, hide, or mark a job as applied. |
| `set_application_stage` | Move an application to a stage (applied, screening, interview, offer, rejected, ghosted, withdrawn). Recorded in the timeline. |
| `add_application_note` | Append to an application's notes (append only; never replaces what the user wrote). |
| `update_profile` | Add or remove roles, skills, soft skills, locations and exclude keywords; change years of experience or remote-only. Re-scores every job. |
| `record_outreach` | Store a message the assistant drafted for a job (status "drafted", shown on the job in the app; the job moves to Saved), or why it skipped it ("skipped"). Never sends anything. |
| `check_for_new_jobs` | Run a check for new jobs now. |

Deliberately **not** provided: sending email, applying to jobs, posting jobs, adding or
suggesting sources, deleting data, changing settings other than the profile. Those stay in
the app, where the user sees them.

Prompts (ready-made instructions the user can pick in the assistant):

- `cover_letter(job_id)`: a cover letter from the job and the profile.
- `interview_prep(job_id)`: likely questions and what to study.
- `outreach(limit?, min_score?)`: check for new jobs, and for each new match draft a short
  message to the hiring team, starting from the user's email template (`fill_templates`) and
  tailored with the posting's keywords. If the posting has an email address and the assistant has an
  email tool (e.g. Gmail), it creates an **email draft**; otherwise the message is stored on the
  job in OkNetwork. Never sends. Made to run on a schedule, e.g. `/loop 30m /oknetwork:outreach`
  in Claude Code (it has to run on the user's computer: cloud agents can't reach 127.0.0.1).
- `skills_gap`: skills that keep appearing in good matches but aren't in the profile.

`get_job` also returns `contacts`: emails and LinkedIn profile links found in the posting (minus
noreply-style addresses) and the apply link. They come from the posting's text, so they're as
untrusted as the description; that's acceptable because the user reviews every draft.

## Security

- **Localhost only**: the server binds to `127.0.0.1`, never `0.0.0.0`.
- **Token**: a random token is created when MCP is turned on; every request needs
  `Authorization: Bearer <token>`. "Reset token" in Settings disconnects every assistant.
- **Origin check**: requests with an `Origin` header from a web page are rejected (blocks
  websites from reaching the server through the browser, a.k.a. DNS rebinding).
- **Read-only by default.** Write tools are only listed when the user turns on "Allow
  changes".
- **Job descriptions are untrusted text.** Anyone can write a posting, and a posting could
  contain instructions aimed at the AI ("ignore your instructions and …"). Mitigations:
  - descriptions are returned in a clearly marked field, with a note in the tool description
    that it's text from a third party;
  - the write tools can't do anything that leaves the computer (no email, no applying, no
    sources), so the worst a malicious posting can do is change local data;
  - `add_application_note` only appends, and `update_profile` changes are listed in the activity log.
- **Activity log**: Settings shows the last 50 tool calls (time, assistant name, tool, job),
  so the user can see what an assistant did.

## Settings → AI assistants

- Switch: **Let AI assistants use OkNetwork** (off by default).
- Switch: **Allow changes** (off by default).
- Port (default 47823; changes if busy) and token, with **Copy** and **Reset token**.
- Setup snippets with the port and token filled in, each with a Copy button:

  Claude Code:
  ```bash
  claude mcp add --transport http oknetwork http://127.0.0.1:47823/mcp \
    --header "Authorization: Bearer <token>"
  ```

  Claude Desktop (`claude_desktop_config.json`):
  ```json
  { "mcpServers": { "oknetwork": { "command": "oknetwork", "args": ["--mcp"] } } }
  ```
  (On Linux the command is `/snap/bin/oknetwork`; on macOS
  `/Applications/OkNetwork.app/Contents/MacOS/OkNetwork`; on Windows the installed .exe.
  The bridge reads the token itself, so it isn't in the file.)

  Cursor / VS Code: the `mcp.json` equivalent of the Claude Code line.

- Activity log.

## Packaging changes

- **Snap**: add the `network-bind` plug (the `default` plugs don't allow listening on a
  port). Check it doesn't trigger a manual store review.
- **Single instance**: `oknetwork --mcp` must not take the single-instance lock or show the
  window; it runs as the bridge and exits when the client disconnects.
- **macOS / Windows**: nothing special; localhost-only listening doesn't trigger the
  firewall prompt.

## Privacy policy

Add a section: the AI assistants feature is off by default; when turned on, assistants the
user connects can read the data described above, and what they read is sent to that
assistant's provider under the provider's own privacy policy. OkNetwork itself still sends
nothing anywhere.

## Plan

1. MCP server in the main process with the read tools; Settings switch, token, setup
   snippets. Tests: tool results against a fixture data file; an E2E test that connects a
   real MCP client to the running app.
2. Write tools behind "Allow changes", activity log, live UI updates.
3. `oknetwork --mcp` stdio bridge for Claude Desktop.
4. Prompts (cover letter, interview prep, skills gap).
5. Snap `network-bind` plug, privacy policy section, README.

## ChatGPT

ChatGPT connects only to MCP servers reachable over the internet (HTTPS). Options, for later:

- the user runs a tunnel (Cloudflare Tunnel, ngrok) to the local server: works today, but
  fiddly, and exposes the server to the internet (the token becomes essential);
- a hosted relay that the app connects out to: needs us to run a server, accounts, and a new
  privacy story. This is where a separate `knet-mcp` project would make sense.

## Later

- **The app calling an AI itself**, with the user's own key (Anthropic, OpenAI) or a local
  model (Ollama): smarter matching that knows "Vue" and "React" are related, one-click cover
  letters, a short "why this fits" per job.

## Decisions

- **Port**: default 47823 (the next free one if it's busy). The actual port and the token are
  written to `<userData>/mcp.json` (mode 600) for the bridge, so a changed port doesn't break
  Claude Desktop. HTTP clients (Claude Code, Cursor, VS Code) need the setup copied again if
  the port changes.
- **Bridge and a closed app**: the bridge starts the app in the tray (`--hidden`) and waits
  up to 20 s. If AI assistants are off, it answers with an error that says where to turn
  them on. After an app restart it reconnects on its own.
- **Write tools when "Allow changes" is off**: registered but disabled, so they disappear
  from the tool list (and come back) without reconnecting.
- **Activity log**: last 50 calls, kept in memory (cleared when the app quits).

## Open questions

- Ask in the app before the first write from a new assistant ("Claude wants to change your
  profile: Allow?"), or is the "Allow changes" switch enough?
- Windows: `oknetwork --mcp` from Claude Desktop is untested (Electron apps on Windows are GUI
  programs; stdin/stdout through a pipe should work, but needs checking on a real machine).
- Snap: check that the `network-bind` plug passes the store's automatic review.
