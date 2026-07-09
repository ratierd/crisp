/**
 * `bun setup` — interactive onboarding wizard.
 *
 * Collects provider and LangSmith keys into .env (idempotent merge: existing
 * lines and comments survive, secrets are never echoed back) and helps pull a
 * first model into the user's own Ollama. Local models need no server config —
 * the *browser* discovers and runs the daemon (ADR-0004); this wizard only
 * makes sure there is something for it to find.
 */
import * as p from '@clack/prompts';

const ENV_PATH = new URL('../.env', import.meta.url).pathname;
const ENV_EXAMPLE_PATH = new URL('../.env.example', import.meta.url).pathname;
const OLLAMA_URL = 'http://localhost:11434';
const LANGSMITH_EU = 'https://eu.api.smith.langchain.com';

// ---------------------------------------------------------------- .env merge

export function parseVars(lines: string[]): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of lines) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) vars.set(m[1] ?? '', m[2] ?? '');
  }
  return vars;
}

/** Update a var in place; comments and unknown lines survive verbatim. */
export function setVar(lines: string[], name: string, value: string): void {
  const active = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (active >= 0) {
    lines[active] = `${name}=${value}`;
    return;
  }
  // a commented-out example line (e.g. `# LANGSMITH_ENDPOINT=…`) marks the
  // spot where the var belongs — activate it right below
  const commented = lines.findIndex((l) => new RegExp(`^#\\s*${name}=`).test(l));
  if (commented >= 0) {
    lines.splice(commented + 1, 0, `${name}=${value}`);
    return;
  }
  if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  lines.push(`${name}=${value}`);
}

function mask(v: string): string {
  return v.length <= 8 ? '…' : `${v.slice(0, 6)}…${v.slice(-4)}`;
}

// ------------------------------------------------------------- key checking

type Verdict = 'ok' | 'auth' | 'unreachable';

/** Reduced to ok/auth/unreachable only — response bodies can echo key fragments. */
async function probeAuth(url: string, headers: Record<string, string>): Promise<Verdict> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 403) return 'auth';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

const validateAnthropic = (key: string) =>
  probeAuth('https://api.anthropic.com/v1/models', {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  });

const validateOpenAI = (key: string) =>
  probeAuth('https://api.openai.com/v1/models', { authorization: `Bearer ${key}` });

const validateOpenRouter = (key: string) =>
  probeAuth('https://openrouter.ai/api/v1/key', { authorization: `Bearer ${key}` });

/**
 * LangSmith keys are region-bound: an EU key 401s against the default US
 * host. On auth failure with no explicit endpoint, retry the EU host and
 * report which one worked so the caller can persist LANGSMITH_ENDPOINT.
 */
async function validateLangsmith(
  key: string,
  endpoint: string,
): Promise<{ verdict: Verdict; endpoint?: string }> {
  const check = (host: string) =>
    probeAuth(`${host}/api/v1/sessions?limit=1`, { 'x-api-key': key });
  if (endpoint) return { verdict: await check(endpoint) };
  const us = await check('https://api.smith.langchain.com');
  if (us !== 'auth') return { verdict: us };
  const eu = await check(LANGSMITH_EU);
  if (eu === 'ok') return { verdict: 'ok', endpoint: LANGSMITH_EU };
  return { verdict: 'auth' };
}

// ------------------------------------------------------------------ prompts

function got<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Setup cancelled — nothing was written.');
    process.exit(0);
  }
  return value as T;
}

async function askSecret(message: string): Promise<string> {
  const v = got(await p.password({ message, mask: '•' }));
  return (v ?? '').trim();
}

/** Returns the final value for the key ('' = unset). Never echoes secrets. */
async function promptKey(opts: {
  label: string;
  current: string;
  validate: (key: string) => Promise<Verdict>;
}): Promise<string> {
  let value = opts.current;
  if (opts.current) {
    const action = got(
      await p.select({
        message: `${opts.label} — currently set (${mask(opts.current)})`,
        options: [
          { value: 'keep', label: 'Keep it' },
          { value: 'replace', label: 'Replace it' },
          { value: 'clear', label: 'Clear it' },
        ],
      }),
    );
    if (action === 'clear') return '';
    if (action === 'replace') value = await askSecret(opts.label);
  } else {
    value = await askSecret(`${opts.label} (Enter to skip)`);
  }

  while (value) {
    const s = p.spinner();
    s.start(`Checking ${opts.label}…`);
    const verdict = await opts.validate(value);
    if (verdict === 'ok') {
      s.stop(`${opts.label}: valid`);
      break;
    }
    if (verdict === 'unreachable') {
      // the wizard records, it doesn't gatekeep — offline setup must work
      s.stop(`${opts.label}: could not verify (network) — keeping it`);
      break;
    }
    s.stop(`${opts.label}: rejected (auth failed)`);
    const next = got(
      await p.select({
        message: 'What now?',
        options: [
          { value: 'reenter', label: 'Re-enter the key' },
          { value: 'keep', label: 'Keep it anyway' },
          { value: 'clear', label: 'Leave it unset' },
        ],
      }),
    );
    if (next === 'keep') break;
    if (next === 'clear') return '';
    value = await askSecret(opts.label);
  }
  return value;
}

// ------------------------------------------------------------------- ollama

async function discoverOllama(): Promise<string[] | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

async function pullModel(model: string): Promise<boolean> {
  const s = p.spinner();
  s.start(`Pulling ${model}…`);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) {
      s.stop(`Pull failed (HTTP ${res.status})`);
      return false;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: { status?: string; error?: string; total?: number; completed?: number };
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.error) {
          s.stop(`Pull failed: ${evt.error}`);
          return false;
        }
        const pct =
          evt.total && evt.completed ? ` ${Math.round((evt.completed / evt.total) * 100)}%` : '';
        s.message(`Pulling ${model} — ${evt.status ?? '…'}${pct}`);
      }
    }
    s.stop(`Pulled ${model} — it appears in Crisp's picker with a "local" badge`);
    return true;
  } catch (err) {
    s.stop(`Pull failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function pullFlow(): Promise<void> {
  while (true) {
    const choice = got(
      await p.select({
        message: 'Which model? (approximate memory while running)',
        options: [
          { value: 'smollm2:135m', label: 'smollm2:135m', hint: '~0.3 GB — tiny, instant answers' },
          { value: 'llama3.2:3b', label: 'llama3.2:3b', hint: '~2.5 GB — solid small all-rounder' },
          { value: 'qwen2.5:7b', label: 'qwen2.5:7b', hint: '~5 GB — strongest of the three' },
          { value: 'other', label: 'Something else…', hint: 'any Ollama or hf.co/… reference' },
          { value: 'skip', label: 'Skip' },
        ],
      }),
    );
    if (choice === 'skip') return;
    const model =
      choice === 'other'
        ? got(
            await p.text({
              message: 'Model reference',
              placeholder: 'e.g. gemma3:4b or hf.co/unsloth/Llama-3.2-1B-Instruct-GGUF',
            }),
          ).trim()
        : choice;
    if (!model) continue;
    const ok = await pullModel(model);
    const again = got(
      await p.confirm({
        message: ok ? 'Pull another?' : 'Try a different model?',
        initialValue: !ok,
      }),
    );
    if (!again) return;
  }
}

async function ollamaStep(): Promise<void> {
  p.log.step('Local models — your own Ollama, discovered and run by the browser');
  while (true) {
    const s = p.spinner();
    s.start('Looking for an Ollama daemon on localhost:11434…');
    const models = await discoverOllama();
    if (models === null) {
      s.stop('No Ollama daemon reachable');
      if (Bun.which('ollama')) {
        p.log.warn('Ollama is installed but not running — start it with `ollama serve`.');
        const action = got(
          await p.select({
            message: 'What now?',
            options: [
              { value: 'recheck', label: 'Check again' },
              { value: 'skip', label: 'Skip local models for now' },
            ],
          }),
        );
        if (action === 'recheck') continue;
      } else {
        p.log.info(
          'Ollama is not installed — get it at https://ollama.com/download, then re-run `bun setup`.',
        );
      }
      return;
    }
    if (models.length > 0) {
      s.stop(`Ollama connected — ${models.join(', ')} will appear in Crisp's picker automatically`);
      const more = got(
        await p.confirm({ message: 'Pull another model now?', initialValue: false }),
      );
      if (!more) return;
    } else {
      s.stop('Ollama connected — no models installed yet');
      p.log.info('Pull at least one so the picker has a local model to offer.');
    }
    await pullFlow();
    return;
  }
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    console.error('bun setup is interactive — run it from a terminal.');
    process.exit(1);
  }
  p.intro('crisp setup');

  const envExists = await Bun.file(ENV_PATH).exists();
  const content = envExists
    ? await Bun.file(ENV_PATH).text()
    : (await Bun.file(ENV_EXAMPLE_PATH).exists())
      ? await Bun.file(ENV_EXAMPLE_PATH).text()
      : '';
  const lines = content.split('\n');
  const original = parseVars(lines);
  const next = new Map(original);

  p.log.step('Remote providers — a model appears in the picker only when its key is set');
  next.set(
    'ANTHROPIC_API_KEY',
    await promptKey({
      label: 'Anthropic API key',
      current: original.get('ANTHROPIC_API_KEY') ?? '',
      validate: validateAnthropic,
    }),
  );
  next.set(
    'OPENAI_API_KEY',
    await promptKey({
      label: 'OpenAI API key',
      current: original.get('OPENAI_API_KEY') ?? '',
      validate: validateOpenAI,
    }),
  );
  next.set(
    'OPENROUTER_API_KEY',
    await promptKey({
      label: 'OpenRouter API key',
      current: original.get('OPENROUTER_API_KEY') ?? '',
      validate: validateOpenRouter,
    }),
  );

  p.log.step('Observability — optional; with a LangSmith key every Run becomes a trace');
  let detectedEndpoint: string | undefined;
  const lsKey = await promptKey({
    label: 'LangSmith API key',
    current: original.get('LANGSMITH_API_KEY') ?? '',
    validate: async (key) => {
      const r = await validateLangsmith(key, original.get('LANGSMITH_ENDPOINT') ?? '');
      detectedEndpoint = r.endpoint;
      return r.verdict;
    },
  });
  next.set('LANGSMITH_API_KEY', lsKey);
  if (lsKey && detectedEndpoint) {
    next.set('LANGSMITH_ENDPOINT', detectedEndpoint);
    p.log.success(
      `Key belongs to LangSmith EU — LANGSMITH_ENDPOINT will be set to ${detectedEndpoint}.`,
    );
  }
  if (lsKey) {
    const project = got(
      await p.text({
        message: 'LangSmith project name',
        initialValue: original.get('LANGSMITH_PROJECT') || 'crisp',
      }),
    ).trim();
    next.set('LANGSMITH_PROJECT', project || 'crisp');
  }

  await ollamaStep();

  const managed = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'LANGSMITH_API_KEY',
    'LANGSMITH_ENDPOINT',
    'LANGSMITH_PROJECT',
  ];
  const changed = managed.filter((k) => (next.get(k) ?? '') !== (original.get(k) ?? ''));

  if (envExists && changed.length === 0) {
    p.log.info('No changes to .env.');
  } else {
    for (const k of changed) setVar(lines, k, next.get(k) ?? '');
    const what = changed.length > 0 ? `updates ${changed.join(', ')}` : 'copied from .env.example';
    const ok = got(
      await p.confirm({ message: `${envExists ? 'Write' : 'Create'} .env? (${what})` }),
    );
    if (ok) {
      await Bun.write(ENV_PATH, lines.join('\n'));
      p.log.success(
        `.env ${envExists ? 'updated' : 'created'} — compose and bun dev both read it.`,
      );
    } else {
      p.log.warn('Nothing written.');
    }
  }

  p.outro(
    'Run `docker compose up --build` → http://localhost:3000  (dev: `docker compose up redis -d && bun dev`)',
  );
}

if (import.meta.main) await main();
