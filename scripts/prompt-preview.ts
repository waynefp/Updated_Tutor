// Prints the exact tutor prompt for a preset, from current memory.
// Usage: npx tsx scripts/prompt-preview.ts ["Lucia's plan"] [gemini|openai]
import { loadMemory } from "../server/lib/memoryStore.js";
import { buildTutorInstructions, getSessionContext, getSessionPresets } from "../server/lib/prompts.js";

const [label, engineArg] = process.argv.slice(2);
const engine = engineArg === "openai" ? "openai" : "gemini";
const memory = await loadMemory();
const presets = getSessionPresets(memory);
const preset = presets.find((item) => item.label === label) ?? presets[0];
const context = getSessionContext(memory, { focus: preset.focus, presetLabel: preset.label });
const prompt = buildTutorInstructions(memory, { focus: preset.focus, presetLabel: preset.label, engine });
console.log(`Preset: ${preset.label} · mode ${context.mode} · goal: ${context.objective ?? "(none)"} · ${prompt.length} chars`);
console.log(`Presets: ${presets.map((item) => item.label).join(" | ")}\n`);
console.log(prompt);
