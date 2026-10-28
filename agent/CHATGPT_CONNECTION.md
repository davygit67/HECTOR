# Connect ChatGPT and Codex cloud tasks

Use OpenAI's **Secure MCP Tunnel** for this private prototype. It connects an OpenAI cloud client to this computer over outbound HTTPS; the Studio and relay remain private. The tunnel forwards calls to `agent/mcp-local.mjs`, which exposes the five tools described in [the cloud projection guide](CLOUD_PROJECTION.md).

```text
ChatGPT / Codex task with the projector tools enabled
  → OpenAI Secure MCP Tunnel
  → local MCP proxy → durable local inbox
  → the Studio chosen with Receive here
  → your existing spatial agent → calibrated output
```

This is the account connection procedure, not evidence that an account has been connected. Discovery and a real cloud tool call must succeed before calling setup complete. A local Codex MCP configuration alone does not install tools into cloud tasks.

## 1. Prepare the local inbox

Configure the separate sender/device credentials and loopback relay settings in `agent/.env` as described in [Connection setup](CLOUD_PROJECTION.md#connection-setup). Keep that file private and out of Git. Preserve the existing model API key. The relay credentials are not OpenAI API keys.

From the project folder, run:

```sh
npm --prefix agent run relay
```

Keep it running. In the updated Studio, open **Cloud updates**, choose **Check setup**, then **Receive here** in the intended room window. A host that has already loaded valid relay settings must restart to change them; an unconfigured host can recheck them. Reloading a receiving window requires choosing Receive here again.

For an MCP client, the launch command is the Node executable with the absolute path to `agent/mcp-local.mjs` as its argument. No particular working directory is required. The launcher reads `agent/.env` beside itself; an optional second command argument selects another private environment file. Environment-provided relay URL/submit token take precedence. Only those two settings and a small set of operating-system environment values are forwarded to the proxy. The model, device and tunnel credentials are not forwarded.

Do not use `npm run mcp` as a stdio client command: npm's banner is not MCP protocol output.

## 2. Create or select the OpenAI tunnel

Sign in to [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels). Reuse a suitable tunnel, or create one named **Projection Mapper**. Associate it with the intended ChatGPT workspace and the Platform organization used by the calling product. A personal Platform organization by itself does not imply access from a different workspace.

The operator needs **Tunnels Read + Manage** to create/edit and **Read + Use** to run or select the tunnel. Custom MCP access in ChatGPT is a separate workspace permission. If the page reports an access restriction, resolve that account permission before continuing; a tunnel ID does not bypass it.

For the personal prototype, check the actual signed-in email in both products before creating the tunnel. The same display name can belong to two different accounts, and signing into Safari does not change the in-app browser's account. If ChatGPT reports that the server denied access, compare the accounts, organization/workspace association and Read + Use permission before changing MCP authentication or creating another tunnel. The local canvas agent's model API key can remain separate; only the tunnel runtime credential must be authorized for the chosen tunnel.

Create or select a runtime API key with Tunnels Read + Use. Enter it locally as `CONTROL_PLANE_API_KEY` through a secure secret input or your environment manager. Do not put a literal key in a command argument, task prompt, chat, committed file or screenshot. Do not give the long-running client an admin key. Do not assume the existing model API key has the required tunnel permissions.

For a separate local credential, use the ignored `agent/.env.tunnel` file with `CONTROL_PLANE_API_KEY=...`. Edit it in an actual text editor; a file preview may be read-only. On macOS, `open -e agent/.env.tunnel` opens TextEdit. Keep the file private (mode 600) and leave the model key in `agent/.env` unchanged. If a key has been pasted into chat, replace it in Platform, update this local file, reconnect the runtime, verify status, and revoke the exposed key. Never paste the replacement into a chat.

## 3. Run the official tunnel client

Download the current client through Platform tunnel settings or the release linked from [OpenAI's Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). Choose the build for the projector computer; check the release digest. Keep downloaded binaries and local profiles in private ignored storage, such as `agent/.local-data/`.

Use the installed client's `help quickstart` and `init --help` to check its current arguments. Example, from `agent/`, with the binary available as `tunnel-client`:

```sh
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile projection-mapper \
  --profile-dir .local-data/tunnel-profiles \
  --tunnel-id YOUR_ACTUAL_TUNNEL_ID \
  --health-listen-addr 127.0.0.1:0 \
  --mcp-command '"/absolute/path/to/node" "/absolute/project/path/agent/mcp-local.mjs"'

tunnel-client doctor --profile-dir .local-data/tunnel-profiles --profile projection-mapper --explain
tunnel-client run --profile-dir .local-data/tunnel-profiles --profile projection-mapper
```

Replace the ID and paths with the actual values. The profile references `env:CONTROL_PLANE_API_KEY`; it must not contain the literal key. Keep the local admin interface on loopback. For an ongoing installation, use the client's documented `runtimes connect`/`runtimes status` supervision workflow after checking that release's help. Verify running, healthy and ready status; process creation alone is insufficient.

The tunnel's stdio target has no additional OAuth flow. The proxy holds the private submit credential locally, while OpenAI tunnel/workspace permissions control who may reach its tools. Give tunnel access only to accounts/workspaces you intend to allow to change this room and read agent result text.

### Restart an existing installation

The relay and tunnel are separate processes. Start the relay as above and open Studio. Reuse the existing tunnel and profile; do not create a new plugin each time. Prefer the official client's managed `runtimes connect` workflow with the existing alias/profile, then inspect `runtimes status`.

For a foreground troubleshooting session, after checking that no managed runtime for this profile is already running, the following loads the private key without putting it in command arguments. Run from the project root with a Node version supporting `--env-file`; replace the client version/profile with the installed ones:

```sh
node --env-file=agent/.env.tunnel -e 'const {spawnSync}=require("node:child_process"); const r=spawnSync("./agent/.local-data/tunnel-client-v0.0.18/tunnel-client",["run","--profile-dir","agent/.local-data/tunnel-profiles","--profile","projection-mapper-chatgpt"],{stdio:"inherit",env:process.env}); process.exitCode=r.status ?? 1;'
```

Keep that terminal open, and select **Receive here** in Studio after any Studio reload. No login/startup service is installed by these steps. To rotate a runtime key, stop its existing runtime first and relaunch with the updated private file; an already-running process retains its old environment.

## 4. Add the tools to the cloud chat

While both local processes are running, open **ChatGPT Plugins → Add custom MCP server → Connection: Tunnel**. Select the same tunnel, name the plugin Projection Mapper, and configure authentication to match the stdio target. Complete the product's access review. If the tunnel is missing, check its workspace association and your Read + Use permission.

For Codex cloud, select the supported tunnel-backed MCP target in the calling product/environment. Do not copy the local `.env` into a cloud repository or assume a local app/CLI MCP entry travels to the cloud. Verify the tools are actually listed in the intended cloud task. If that environment offers no supported tunnel/plugin selection, it is not connected by these local steps; use a supported cloud surface or an authenticated hosted gateway.

First make a read-only call: **“Use Projection Mapper to get the projector status.”** Confirm the expected installation ID, and then choose Receive here if needed. Next send one clearly identified test note and inspect its returned request ID with `get_projection_request`. Confirm the note in Studio. Physical projection requires checking the actual output separately.

A Responses API test uses the calling Platform account's API balance, which is separate from ChatGPT access. An `insufficient_quota` / `credit_balance_exhausted` response does not prove a tunnel failure. Verify the installed plugin through ChatGPT itself, or add API credits only if you intend to use that API account. A discovered tool list proves discovery, not successful task delivery.

## 5. Tell individual scheduled tasks what to send

Connecting the plugin does not subscribe to every cloud task's completion. Enable it in each desired chat/task and add an explicit completion instruction. For example:

> After completing this task, use Projection Mapper to send a concise visual update. Read get_projector_status to obtain the installation ID. Call publish_task_update with a unique requestId for this scheduled run, a short title, the useful result summary, placement beside existing content, and ttlSeconds 3600. Reuse the exact requestId and input for retries of this same update. Record the returned request ID. Check get_projection_request within the remaining task time, and distinguish queued, running, complete, incomplete, failed and uncertain. Do not say the update was physically displayed without actual observation. If the tools are unavailable, authentication or approval is required, or the connection fails, report that delivery is pending or failed rather than claiming success.

For creative requests, call `request_projection` with the desired experience instead of `publish_task_update`. Follow-up adjustments are new requests with new IDs. The local agent still decides how to implement them using current room geometry and its supported tools.

[OpenAI's scheduled-task guide](https://learn.chatgpt.com/docs/automations) describes web tasks using connected tools available to their chat. Test the exact task interactively, then verify its first scheduled run. Availability and write approval requirements must be checked in the actual account; an interactive success does not prove unattended delivery. No schedule is created by this project.

## Availability and recovery

- **Mac, relay and tunnel online; Studio paused/busy:** accepted updates stay in the local inbox until their delivery deadline. Pause/Resume/Release remain local controls.
- **Mac or tunnel offline before acceptance:** cloud calls cannot reliably submit. OpenAI documents a 120-second tunnel request deadline. This tunnel is not an overnight offline mailbox. Retry using the same request ID and identical input; inspect status if acceptance is uncertain.
- **Always-on delivery later:** run the relay/tunnel on an always-on computer or persistent server and have the projector computer poll that relay. That deployment needs a reachable authenticated HTTPS relay endpoint and private storage. A sleeping laptop cannot replace it.
- **Agent complete:** the agent reports canvas work; the protocol retains `projectionVerified:false`. Actual optical output and hardware availability are separate.

References: [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [MCP connection surfaces](https://learn.chatgpt.com/docs/extend/mcp), [scheduled tasks](https://learn.chatgpt.com/docs/automations). For a direct public ChatGPT endpoint, this relay's static bearer token alone is insufficient: ChatGPT does not present arbitrary custom API keys, so use an appropriate supported authentication gateway. See [ChatGPT authentication](https://developers.openai.com/plugins/build/auth).
