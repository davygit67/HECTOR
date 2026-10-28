# Cloud tasks → your room

The connection sends instructions to your existing spatial canvas agent. That agent uses current room geometry, supported media/program tools and the same scene controls as local chat. The cloud does not render projector frames or invent mapping coordinates.

```text
Cloud task / LLM / automation
    │ MCP tool call (or authenticated HTTP request)
    ▼
Projection inbox — durable requests and delivery results
    ▲ outbound connection from the projector computer
    │
Selected Studio → existing canvas agent → calibrated renderer → projector
```

The studio checks for work without calling an LLM. Model usage occurs when a request is delivered. With the default three-second interval, delivery normally starts within a few seconds once the selected studio is ready; this is not a real-time frame transport.

## Tools available to the cloud

| Tool | What it does |
| --- | --- |
| `publish_task_update` | Sends a title, summary and placement preference for a readable projected note |
| `request_projection` | Sends a creative prompt or follow-up adjustment to your canvas agent |
| `get_projection_request` | Retrieves delivery state and the agent's result |
| `get_projector_status` | Identifies the installation and whether a receiver recently checked in |
| `cancel_projection_request` | Cancels a request before execution starts |

For example, an authorized scheduled task can finish its work and call:

```json
{
  "requestId": "morning-brief-2026-10-27",
  "targetId": "home-studio",
  "title": "Your morning brief is ready",
  "summary": "The report is complete. Three items need your attention.",
  "placement": "A readable note on the wall beside the video",
  "ttlSeconds": 3600
}
```

That is input to `publish_task_update`. For `request_projection`, use:

```json
{
  "requestId": "celebrate-report-2026-10-27",
  "targetId": "home-studio",
  "prompt": "Create a gentle green celebration around the room because my report is finished. Keep the video and timer visible.",
  "ttlSeconds": 600
}
```

Reuse the same request ID and identical input when retrying a network failure. Use a new ID for each new scheduled run or follow-up. The target is the configured installation ID, not a guessed surface ID. Task summaries are labeled as quoted data; creative prompts are delegated requests. Only give the submit credential to an automation you intend to authorize to change this room.

## Connection setup

The software is implemented and tested locally. A public endpoint and your cloud account still need to be connected; merely installing this package does not give an existing scheduled task access to it.

1. Run the relay on a continuously available Node.js host with persistent private storage and an HTTPS reverse proxy. For a local trial, run it on this Mac with `npm --prefix agent run relay`; localhost HTTP is supported. Set the server variables below first.
2. Put the relay origin, device ID and **device** credential in the projector computer's `agent/.env`. Refresh/relaunch the updated studio, open its conversation panel and select **Receive here**. Only one studio can receive; reconnecting requires selecting it again. Pause stops cloud delivery. Keep the computer, studio and required projector output running.
3. Connect your cloud client to `https://YOUR-RELAY-HOST/mcp` using its **submit** credential, or configure the local stdio proxy. Add the appropriate tool call to the end of the scheduled task's instructions. Test one explicit request and inspect its returned job ID before relying on an unattended schedule.

The two credentials must differ and each must contain at least 32 characters. Generate cryptographically random values in your password manager or deployment secret manager. Keep them out of chat, browser code, source control and URLs. Neither is your OpenAI API key.

Relay server settings:

| Variable | Value |
| --- | --- |
| `PROJECTION_RELAY_DEVICE_ID` | Your installation ID, e.g. `home-studio` |
| `PROJECTION_RELAY_SUBMIT_TOKEN` | Private credential for cloud/MCP callers |
| `PROJECTION_RELAY_DEVICE_TOKEN` | Different private credential for the local receiver |
| `PROJECTION_RELAY_STORE` | Absolute path on a persistent private disk, e.g. `/data/projection-inbox.json` |
| `PROJECTION_RELAY_BIND` | Defaults to `127.0.0.1`; use your deployment interface behind its HTTPS proxy |
| `PROJECTION_RELAY_PORT` | Defaults to `8787` |
| `PROJECTION_RELAY_ALLOWED_HOSTS` | Exact comma-separated Host values, e.g. `projector.example.com`; include port if non-default |

Projector-computer settings:

```dotenv
PROJECTION_RELAY_URL=https://YOUR-RELAY-HOST
PROJECTION_RELAY_DEVICE_ID=home-studio
PROJECTION_RELAY_DEVICE_TOKEN=replace-with-private-device-credential
```

Use `http://127.0.0.1:8787` only when the relay runs on the same computer. The receiver makes outbound requests, so the studio itself needs no public port, router forwarding or Vite tunnel. Do not publish the development studio as the MCP endpoint.

An unconfigured running host rechecks local settings when you choose **Check setup**. Once it has loaded valid relay settings, it keeps them for that host session: restart the host to change the relay URL, device ID or credential. A browser refresh alone does not replace cached host settings.

For a local MCP client that supports stdio, configure the `node` executable with arguments `--import`, `tsx`, `src/relay/stdio.ts`, working directory `agent/`, and environment variables `PROJECTION_RELAY_URL` and `PROJECTION_RELAY_SUBMIT_TOKEN`. The relay must already be running; the proxy does not create another queue. For a manual terminal launch, `npm --prefix agent run mcp` loads `agent/.env`; avoid npm's stdout banner in an MCP client's stdio command.

Remote HTTP clients must support a configured `Authorization: Bearer …` header. This first version does **not** implement an OAuth authorization server. A provider that requires OAuth needs an authenticated gateway/adapter before it can connect. ChatGPT custom MCP setup supports a public HTTPS endpoint or supported Secure MCP Tunnel; account availability, authentication and unattended write permissions must be checked for the selected product. Scheduled-task support must be verified in the actual account, not inferred from interactive tool availability. See [OpenAI's connection guide](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt) and [scheduled-task documentation](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt).

## Plain HTTP automation

If your scheduler cannot call MCP, it can `POST /jobs` with the same tool input plus `"kind":"task_update"` or `"kind":"creative_prompt"`, JSON content type and the submit Authorization header. Read results with `POST /jobs/status` and `{ "id": "returned-job-id" }`. `GET /status` gives receiver connectivity. Only the device credential can call `/device/*`; a cloud caller cannot claim jobs or fabricate completion receipts using its submit credential.

## Delivery behavior and limits

- `queued` means durably accepted; `running` means local execution started. `complete` and `incomplete` are the local agent's reports about canvas work. All receipts explicitly keep `projectionVerified:false`. The MCP service has no camera-image or raw room-state endpoint; the authorized cloud caller receives the agent's result text, which may describe canvas contents.
- Offline or busy studios leave work queued until its delivery deadline. `ttlSeconds` expires undelivered requests; it does not erase content after display. Existing agent capabilities determine whether a requested visual can be made. Generated videos and arbitrary web apps are not added by MCP itself.
- A request interrupted after execution may be `uncertain`. It will not automatically run again. Check the studio before intentionally submitting another request. This avoids common duplicate effects but does not claim distributed exactly-once execution.
- A saved local receipt is retried after a network outage without repeating the agent call. Local and relay journals use private atomic files and a single-process lock. After a process crash, verify it has stopped before removing its adjacent `.lock` file; preserve the JSON for recovery. Never delete the inbox to resolve a temporary connection problem.
- One installation and one relay process are supported. Storage retains up to 1,000 jobs, including deduplication history, then rejects new jobs. Archive completed history while stopped before resetting intentionally; archived request IDs will no longer deduplicate against a new store. A shared database, retention policy and multi-tenant OAuth are later deployment work. Do not use an ephemeral/serverless filesystem for this store.
- The loopback defaults are intended for local development. Public hosting needs TLS, persistent storage, process supervision and controlled access. The relay has bounded inputs, host/origin checks, separate credentials, an authenticated request limit and no arbitrary file/code/URL execution endpoint.

Implementation follows the official [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server) Streamable HTTP transport and also provides a stdio proxy. Local tests exercise real MCP discovery/calls, the durable queue, receiver recovery and the existing agent/canonical scene with scripted model responses. They do not qualify a cloud provider account or a physical projector.
