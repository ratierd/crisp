<!-- User-facing copy: apps/web/public/byo-ollama.html — keep in sync. -->

# Bring your own Ollama

Chat with models running on **your** machine, against a deployed Crisp.

## What this is

Crisp never runs local models on its server — it can't; a deployed server has no way to reach your `localhost`. Instead, the page in your browser discovers your own Ollama daemon, runs the generation right there in the tab, and streams it into the transcript exactly like a server run. The Crisp server never talks to your Ollama; the only thing it receives is the finished conversation. Your job: install Ollama, pull a model, and tell your daemon that the Crisp origin is allowed to call it. About five minutes.

## Privacy, honestly

Generation happens on your machine — prompts and tokens flow between your browser tab and your local daemon, and the model itself never leaves your disk. But local-only _execution_ is not local-only _storage_: once a run finishes, the browser reports the conversation to the Crisp server, which persists it. And when the operator has LangSmith observability enabled, that finished run is mirrored there as a trace too. If you don't want a conversation stored, don't have it here.

## Step 1 — install Ollama

- **macOS / Windows**: download the app from [ollama.com/download](https://ollama.com/download) and run it. It lives in the menu bar / system tray.
- **Linux**:

  ```sh
  curl -fsSL https://ollama.com/install.sh | sh
  ```

  This installs a systemd service that starts on boot.

## Step 2 — pull a model

```sh
ollama pull llama3.2:3b
```

Some good starting points:

| model          | size    | good for                               |
| -------------- | ------- | -------------------------------------- |
| `smollm2:135m` | ~0.3 GB | a quick test — downloads in seconds    |
| `llama3.2:3b`  | ~2.5 GB | solid everyday chat on modest hardware |
| `qwen2.5:7b`   | ~5 GB   | stronger answers if you have the RAM   |

Any GGUF on HuggingFace works too: `ollama pull hf.co/<user>/<repo>`.

## Step 3 — allow the Crisp origin on your daemon

Ollama only accepts browser requests from origins it trusts. Localhost is trusted by default — which is why local dev needs no config — but a deployed Crisp origin is not, so you opt in once with the `OLLAMA_ORIGINS` environment variable.

The fastest way to see it work:

```sh
OLLAMA_ORIGINS=https://<your-crisp-domain> ollama serve
```

Crisp's model picker shows this exact command with the real origin filled in — open the picker and copy it from there rather than typing the domain by hand.

That command lasts until you close the terminal. To make it stick:

- **macOS (Ollama.app)**:

  ```sh
  launchctl setenv OLLAMA_ORIGINS "https://<your-crisp-domain>"
  ```

  Then quit and restart Ollama from the menu bar.

- **Windows**: Settings → search "environment variables" → add a _user_ variable named `OLLAMA_ORIGINS` with value `https://<your-crisp-domain>`. Quit Ollama from the tray and relaunch it.

- **Linux (systemd service)**:

  ```sh
  sudo systemctl edit ollama
  ```

  Add:

  ```ini
  [Service]
  Environment="OLLAMA_ORIGINS=https://<your-crisp-domain>"
  ```

  Then:

  ```sh
  sudo systemctl restart ollama
  ```

Multiple origins are comma-separated: `OLLAMA_ORIGINS=https://a.example.com,https://b.example.com`.

## Step 4 — the browser prompt

On an HTTPS deployment, Chromium-based browsers (Chrome, Edge, Brave, Arc) ask once for permission before a page may talk to your local network — that's Private Network Access doing its job. Click **Allow**; the page is only reaching your own Ollama on `localhost:11434`. Firefox doesn't currently gate this, so there's nothing to click. Safari and macOS may show their own Local Network permission dialog — allow that too.

## Step 5 — use it

Open the model picker in Crisp. Your models appear with a **local** badge and ids like `byo/llama3.2:3b` — pick one and chat. Streaming, stop, regenerate, and feedback all work exactly as they do with server models.

The picker re-checks your daemon every time you open it. Just pulled a new model? Close the picker and reopen it — no reload needed.

## Troubleshooting

| symptom                                    | fix                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No local models in the picker              | Your daemon isn't running — start the Ollama app, or run `ollama serve`. If it _is_ running, the origin probably isn't allowed yet: do [step 3](#step-3--allow-the-crisp-origin-on-your-daemon), then reopen the picker. |
| Still nothing, daemon and origin both fine | You may have denied the browser's local-network prompt. Re-allow it in the browser's site settings for the Crisp domain, then reload.                                                                                    |
| 403 errors from Ollama                     | An `OLLAMA_ORIGINS` typo. The value must match the page's origin _exactly_ — scheme included, no trailing slash. `https://<your-crisp-domain>`, not `<your-crisp-domain>` or `https://<your-crisp-domain>/`.             |
| Requests never reach the daemon            | Antivirus or a firewall blocking port 11434 locally. Allow the port, or check whether your security software proxies localhost traffic.                                                                                  |
| Reloaded mid-answer, the reply stopped     | Expected. A local run lives in your tab, so a reload can't resume it mid-stream (server runs can). What was generated before the reload is kept.                                                                         |

One last note: the `<your-crisp-domain>` placeholders in this page are illustrative. The copy button in the model picker gives you the exact command with the real origin — use that.
