import chalk from 'chalk';
import { type Interface as RLInterface } from 'readline';
import { getConfig, setConfig } from '../db/store.js';
import * as ui from '../ui/index.js';

const PROVIDERS = [
  { name: 'OpenAI',           url: 'https://api.openai.com/v1',       model: 'gpt-4o',               keyHint: 'sk-...' },
  { name: 'Anthropic (OpenAI-compat)', url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', keyHint: 'sk-ant-...' },
  { name: 'Groq',             url: 'https://api.groq.com/openai/v1',  model: 'llama-3.3-70b-versatile', keyHint: 'gsk_...' },
  { name: 'Together AI',      url: 'https://api.together.xyz/v1',     model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', keyHint: '' },
  { name: 'OpenRouter',       url: 'https://openrouter.ai/api/v1',    model: 'openai/gpt-4o',        keyHint: 'sk-or-...' },
  { name: 'Ollama (local)',    url: 'http://localhost:11434/v1',       model: 'llama3',               keyHint: 'ollama' },
  { name: 'LM Studio (local)',url: 'http://localhost:1234/v1',        model: 'loaded-model',         keyHint: 'lm-studio' },
  { name: 'Custom',           url: '',                                 model: '',                     keyHint: '' },
];

const isLocal = (idx: number) => idx === 5 || idx === 6;

function ask(rl: RLInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askRequired(rl: RLInterface, question: string): Promise<string> {
  while (true) {
    const answer = await ask(rl, question);
    if (answer) return answer;
    console.log(`  ${ui.icon.cross} ${ui.c.error('Required.')} Try again.`);
  }
}

/**
 * Interactive setup wizard. Uses the SAME readline instance as the main CLI
 * so stdin is never closed.
 */
export async function runSetup(rl: RLInterface): Promise<void> {
  console.log();
  console.log(chalk.bold.white('  Welcome to Koda! Let\'s get you set up.\n'));

  // Provider selection
  console.log(chalk.bold('  Choose your AI provider:\n'));
  PROVIDERS.forEach((p, i) => {
    const num = chalk.cyan(`  ${(i + 1).toString().padStart(2)}`);
    const name = chalk.white(p.name);
    const hint = p.url ? ui.c.dim(` (${p.url})`) : '';
    console.log(`${num}  ${name}${hint}`);
  });
  console.log();

  const choice = await ask(rl, `  ${ui.icon.arrow} Pick a number ${ui.c.dim('[1-8]')}: `);
  const idx = Math.max(0, Math.min(PROVIDERS.length - 1, (parseInt(choice) || 1) - 1));
  const provider = PROVIDERS[idx];

  console.log(`\n  ${ui.icon.check} ${chalk.white(provider.name)}\n`);

  // API URL
  let apiUrl = provider.url;
  if (!apiUrl) {
    apiUrl = await askRequired(rl, `  ${ui.icon.arrow} API base URL: `);
  } else {
    const custom = await ask(rl, `  ${ui.icon.arrow} API URL ${ui.c.dim(`[${apiUrl}]`)}: `);
    if (custom) apiUrl = custom;
  }
  setConfig('api_base_url', apiUrl);
  console.log(`  ${ui.icon.check} ${ui.c.dim('URL:')} ${apiUrl}`);

  // API Key
  if (isLocal(idx)) {
    setConfig('api_key', provider.keyHint);
    console.log(`\n  ${ui.icon.check} ${ui.c.dim('Key:')} ${provider.keyHint} ${ui.c.dim('(local — no key needed)')}`);
  } else {
    const keyHint = provider.keyHint ? ui.c.dim(` (${provider.keyHint})`) : '';
    const apiKey = await askRequired(rl, `\n  ${ui.icon.arrow} API key${keyHint}: `);
    setConfig('api_key', apiKey);
    console.log(`  ${ui.icon.check} ${ui.c.dim('Key:')} ${apiKey.slice(0, 8)}...`);
  }

  // Model
  let model = provider.model;
  if (!model) {
    model = await askRequired(rl, `\n  ${ui.icon.arrow} Model name: `);
  } else {
    const custom = await ask(rl, `\n  ${ui.icon.arrow} Model ${ui.c.dim(`[${model}]`)}: `);
    if (custom) model = custom;
  }
  setConfig('model', model);
  console.log(`  ${ui.icon.check} ${ui.c.dim('Model:')} ${model}`);

  console.log(`\n  ${chalk.green.bold('All set!')} Start chatting below.\n`);
}

export function needsSetup(): boolean {
  return !getConfig('api_key');
}
