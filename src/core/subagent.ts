import { getConfig } from '../db/store.js';

export interface SubagentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[]; // empty = all tools
  model?: string;
}

const subagents: Map<string, SubagentConfig> = new Map();

export function registerSubagent(config: SubagentConfig): void {
  subagents.set(config.name, config);
}

export function getSubagent(name: string): SubagentConfig | undefined {
  return subagents.get(name);
}

export function listSubagents(): SubagentConfig[] {
  return Array.from(subagents.values());
}

export function removeSubagent(name: string): boolean {
  return subagents.delete(name);
}

export function getSubagentTools(config: SubagentConfig): string[] | null {
  if (config.tools.length === 0) return null; // null = all tools
  return config.tools;
}

export function getSubagentModel(config: SubagentConfig): string {
  return config.model || getConfig('model') || 'gpt-4o';
}

export function buildSubagentSystemPrompt(config: SubagentConfig, task: string): string {
  return `${config.systemPrompt}

## Your Task
${task}

## Guidelines
- Work independently in the project directory.
- Use the available tools to complete your task.
- When done, provide a clear summary of what you found/did.
- Be concise — return a summary, not every detail.
`;
}

// Built-in read-only explorer subagent
registerSubagent({
  name: 'explorer',
  description: 'Fast read-only research agent for searching and analyzing codebases.',
  systemPrompt: `You are a fast, focused research agent. You can read files, search code, and find patterns. You CANNOT write or edit files. You CANNOT run terminal commands that modify state. You CAN run read-only commands like grep, find, and cat.

Focus on:
- Understanding code structure and patterns
- Finding relevant files and code sections
- Summarizing findings clearly`,
  tools: ['read_file', 'search_code', 'glob_files'],
});

registerSubagent({
  name: 'reviewer',
  description: 'Code review specialist. Reviews code for quality, security, and best practices.',
  systemPrompt: `You are a senior code reviewer. When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Review for: code quality, security issues, performance, readability, test coverage

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples and how to fix each issue.`,
  tools: ['read_file', 'search_code', 'glob_files', 'git_ops'],
});

registerSubagent({
  name: 'debugger',
  description: 'Debugging specialist for errors, test failures, and unexpected behavior.',
  systemPrompt: `You are an expert debugger. When invoked:
1. Analyze the error or unexpected behavior described
2. Trace through the code to find root cause
3. Identify the minimal fix
4. Implement and verify

For each issue provide:
- Root cause explanation
- Evidence from the code
- Specific fix
- How to verify it works`,
  tools: ['read_file', 'edit_file', 'search_code', 'glob_files', 'run_terminal'],
});
