import { getPreferenceValues, showToast, Toast, Clipboard, showHUD, LocalStorage } from "@raycast/api";
import { exec } from "child_process";
import { promisify } from "util";
import fetch from "node-fetch";

interface Preferences {
  claudeApiKey: string;
  claudeModel?: string;
  promptPreset?: string;
  customPrompt?: string;
  avoidEmDashes?: boolean;
}

interface ClaudeContentBlock {
  type: string;
  text: string;
}

interface ClaudeAPIResponse {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Define preset interface
interface Preset {
  id: string;
  name: string;
  prompt: string;
}

// Default presets
const DEFAULT_PRESETS: Preset[] = [
  {
    id: "conversational",
    name: "Conversational & Human",
    prompt: "Rewrite this with correct spelling and grammar. Aim to have a conversational and human tone of voice.",
  },
  {
    id: "formal",
    name: "Formal & Professional",
    prompt:
      "Rewrite this with correct spelling and grammar. Use a formal, professional tone suitable for business or academic contexts.",
  },
  {
    id: "concise",
    name: "Concise & Clear",
    prompt:
      "Rewrite this to be more concise and clear. Remove unnecessary words and simplify complex sentences while maintaining the original meaning.",
  },
  {
    id: "grammar",
    name: "Fix Grammar Only",
    prompt:
      "Fix only the spelling and grammar in this text. Don't change the style, tone, or word choice unless necessary for grammatical correctness.",
  },
];

// Helper function to get all presets (default + user-defined)
async function getAllPresets(): Promise<Preset[]> {
  // Get user presets from LocalStorage
  const userPresetsJson = (await LocalStorage.getItem("user_presets")) as string;
  const userPresets: Preset[] = userPresetsJson ? JSON.parse(userPresetsJson) : [];

  // Get deletion markers
  const deletionMarkers = userPresets
    .filter((p) => p.id.startsWith("deleted_"))
    .map((p) => p.id.replace("deleted_", ""));

  // Get shadow copies
  const shadowCopies = userPresets.filter((p) => p.id.startsWith("shadow_"));

  // Filter out deletion markers and shadow copies from user presets
  const regularUserPresets = userPresets.filter((p) => !p.id.startsWith("deleted_") && !p.id.startsWith("shadow_"));

  // Filter default presets that haven't been deleted
  const activeDefaultPresets = DEFAULT_PRESETS.filter((p) => !deletionMarkers.includes(p.id));

  // Apply shadow copies to default presets
  const finalDefaultPresets = activeDefaultPresets.map((defaultPreset) => {
    // Check if there's a shadow copy for this default preset
    const shadow = shadowCopies.find((p) => p.id === `shadow_${defaultPreset.id}`);
    if (shadow) {
      // Return the shadow copy but keep the original ID
      return {
        id: defaultPreset.id,
        name: shadow.name,
        prompt: shadow.prompt,
      };
    }
    // No shadow, return the original
    return defaultPreset;
  });

  // Combine default and user presets
  return [...finalDefaultPresets, ...regularUserPresets];
}

// Helper function to get a preset by ID
async function getPresetById(presetId: string): Promise<Preset | undefined> {
  const allPresets = await getAllPresets();
  return allPresets.find((preset) => preset.id === presetId);
}

// Helper function to get selected text
async function getSelectedText(): Promise<string | null> {
  try {
    // Save original clipboard content to restore later
    const { stdout: originalClipboard } = await promisify(exec)("pbpaste");

    // Try to get selected text by simulating CMD+C
    await promisify(exec)('osascript -e \'tell application "System Events" to keystroke "c" using {command down}\'');

    // Wait for the clipboard to update
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Get the updated clipboard content
    const { stdout: newClipboard } = await promisify(exec)("pbpaste");

    // Restore original clipboard content
    await Clipboard.copy(originalClipboard);

    // Return the clipboard content (selected text)
    return newClipboard;
  } catch (error) {
    console.error("Error getting selected text:", error);
    return null;
  }
}

// Function to toggle between preset options
export async function togglePreset() {
  try {
    // Get all presets
    const allPresets = await getAllPresets();

    if (allPresets.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No presets available",
        message: "Add a preset first using the 'Add Preset' command",
      });
      return;
    }

    // Get current preset from LocalStorage
    const currentPresetId = ((await LocalStorage.getItem("current_preset_id")) as string) || allPresets[0].id;

    // Find the index of the current preset
    const currentIndex = allPresets.findIndex((preset) => preset.id === currentPresetId);

    // Calculate the next preset (cycle through options)
    const nextIndex = (currentIndex + 1) % allPresets.length;
    const nextPreset = allPresets[nextIndex];

    // Save the new preset to LocalStorage
    await LocalStorage.setItem("current_preset_id", nextPreset.id);

    // Show confirmation to the user
    await showHUD(`Preset changed to: ${nextPreset.name}`);
  } catch (error) {
    console.error("Error toggling preset:", error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Error toggling preset",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Function to add a new preset
export async function addPreset(name: string, prompt: string): Promise<void> {
  try {
    // Get existing user presets
    const userPresetsJson = (await LocalStorage.getItem("user_presets")) as string;
    const userPresets: Preset[] = userPresetsJson ? JSON.parse(userPresetsJson) : [];

    // Create a new preset
    const newPreset: Preset = {
      id: `user_${Date.now()}`, // Generate a unique ID
      name,
      prompt,
    };

    // Add the new preset
    userPresets.push(newPreset);

    // Save updated presets
    await LocalStorage.setItem("user_presets", JSON.stringify(userPresets));

    // Set as current preset
    await LocalStorage.setItem("current_preset_id", newPreset.id);

    // Show confirmation
    await showHUD(`Added new preset: ${name}`);
  } catch (error) {
    console.error("Error adding preset:", error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Error adding preset",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Function to edit an existing preset
export async function editPreset(presetId: string, name: string, prompt: string): Promise<void> {
  try {
    // Get all presets
    const allPresets = await getAllPresets();
    const presetToEdit = allPresets.find((p) => p.id === presetId);

    if (!presetToEdit) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Preset not found",
        message: "The preset you're trying to edit doesn't exist",
      });
      return;
    }

    // Check if it's a default preset
    if (DEFAULT_PRESETS.some((p) => p.id === presetId)) {
      // For default presets, create a shadow copy in user presets
      const userPresetsJson = (await LocalStorage.getItem("user_presets")) as string;
      const userPresets: Preset[] = userPresetsJson ? JSON.parse(userPresetsJson) : [];

      // Check if a shadow copy already exists
      const shadowIndex = userPresets.findIndex((p) => p.id === `shadow_${presetId}`);

      if (shadowIndex >= 0) {
        // Update existing shadow
        userPresets[shadowIndex] = {
          id: `shadow_${presetId}`,
          name,
          prompt,
        };
      } else {
        // Create new shadow
        userPresets.push({
          id: `shadow_${presetId}`,
          name,
          prompt,
        });
      }

      // Save updated presets
      await LocalStorage.setItem("user_presets", JSON.stringify(userPresets));

      // Show confirmation
      await showHUD(`Updated preset: ${name}`);
      return;
    }

    // For user presets, update directly
    const userPresetsJson = (await LocalStorage.getItem("user_presets")) as string;
    const userPresets: Preset[] = userPresetsJson ? JSON.parse(userPresetsJson) : [];

    // Update the preset
    const updatedPresets = userPresets.map((p) => (p.id === presetId ? { ...p, name, prompt } : p));

    // Save updated presets
    await LocalStorage.setItem("user_presets", JSON.stringify(updatedPresets));

    // Show confirmation
    await showHUD(`Updated preset: ${name}`);
  } catch (error) {
    console.error("Error editing preset:", error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Error editing preset",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Function to delete a preset
export async function deletePreset(presetId: string): Promise<void> {
  try {
    // Check if it's a default preset
    if (DEFAULT_PRESETS.some((p) => p.id === presetId)) {
      // For default presets, create a shadow deletion marker
      const userPresetsJson = (await LocalStorage.getItem("user_presets")) as string;
      const userPresets: Preset[] = userPresetsJson ? JSON.parse(userPresetsJson) : [];

      // Add a deletion marker
      userPresets.push({
        id: `deleted_${presetId}`,
        name: "DELETED",
        prompt: "DELETED",
      });

      // Save updated presets
      await LocalStorage.setItem("user_presets", JSON.stringify(userPresets));

      // If the deleted preset was the current one, switch to another preset
      const currentPresetId = await LocalStorage.getItem("current_preset_id");
      if (currentPresetId === presetId) {
        const allPresets = await getAllPresets();
        if (allPresets.length > 0) {
          await LocalStorage.setItem("current_preset_id", allPresets[0].id);
        } else {
          await LocalStorage.removeItem("current_preset_id");
        }
      }

      // Show confirmation
      const preset = DEFAULT_PRESETS.find((p) => p.id === presetId);
      await showHUD(`Deleted preset: ${preset?.name || presetId}`);
      return;
    }

    // For user presets, delete directly
    const userPresetsJson = (await LocalStorage.getItem("user_presets")) as string;
    const userPresets: Preset[] = userPresetsJson ? JSON.parse(userPresetsJson) : [];

    // Find the preset to delete
    const presetToDelete = userPresets.find((p) => p.id === presetId);

    if (!presetToDelete) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Preset not found",
        message: "The preset you're trying to delete doesn't exist",
      });
      return;
    }

    // Remove the preset
    const updatedPresets = userPresets.filter((p) => p.id !== presetId);

    // Save updated presets
    await LocalStorage.setItem("user_presets", JSON.stringify(updatedPresets));

    // If the deleted preset was the current one, switch to the first available preset
    const currentPresetId = await LocalStorage.getItem("current_preset_id");
    if (currentPresetId === presetId) {
      const allPresets = await getAllPresets();
      if (allPresets.length > 0) {
        await LocalStorage.setItem("current_preset_id", allPresets[0].id);
      } else {
        await LocalStorage.removeItem("current_preset_id");
      }
    }

    // Show confirmation
    await showHUD(`Deleted preset: ${presetToDelete.name}`);
  } catch (error) {
    console.error("Error deleting preset:", error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Error deleting preset",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Function to list all presets
export async function listPresets(): Promise<Preset[]> {
  return await getAllPresets();
}

export default async function command() {
  try {
    // Get API key and other preferences
    const preferences = getPreferenceValues<Preferences>();
    const apiKey = preferences.claudeApiKey;
    const selectedModel = preferences.claudeModel || "claude-3-5-sonnet-20241022";
    const avoidEmDashes = preferences.avoidEmDashes ?? true;

    // Get all presets
    const allPresets = await getAllPresets();

    // Get the current preset ID from LocalStorage or use the first preset
    const currentPresetId =
      ((await LocalStorage.getItem("current_preset_id")) as string) ||
      (allPresets.length > 0 ? allPresets[0].id : "conversational");

    // Get the current preset
    const currentPreset = (await getPresetById(currentPresetId)) || allPresets[0];

    if (!apiKey) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Claude API Key Missing",
        message: "Please add your Claude API Key in extension preferences",
      });
      return;
    }

    // Check if this is the first time using the API key
    const hasUsedApiKey = await LocalStorage.getItem("has_used_claude_api_key");

    if (!hasUsedApiKey) {
      // First time using the API key - show welcome message
      await LocalStorage.setItem("has_used_claude_api_key", "true");
      await showHUD("✅ You're ready to rewrite text with Claude! Select text and press Option+R.");
      return;
    }

    // Get selected text
    const selectedText = await getSelectedText();

    // Check if text is selected
    if (!selectedText || selectedText.trim() === "") {
      await showToast({
        style: Toast.Style.Failure,
        title: "No Text Selected",
        message: "Please select some text before pressing Option+R",
      });
      return;
    }

    // Get the prompt to use from the current preset
    const promptToUse = currentPreset.prompt;

    // Show loading indicator
    await showToast({
      style: Toast.Style.Animated,
      title: `Rewriting with "${currentPreset.name}" style...`,
      message: `Using ${getModelDisplayName(selectedModel)}`,
    });

    // Prepare system message with all formatting instructions
    let systemMessage =
      "You are a helpful text rewriting assistant. Your job is to take the provided text and rewrite it as instructed while preserving the original line breaks, paragraph structure, emojis, and formatting";

    if (avoidEmDashes) {
      systemMessage +=
        ". Do not use em dashes (—) in your rewrite. Use other punctuation like commas, parentheses, or colons instead";
    }

    systemMessage += ". You should return ONLY the rewritten text, with no additional commentary.";

    // Make API request to Claude
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 8192,
        system: systemMessage,
        messages: [
          {
            role: "user",
            content: `${promptToUse} Here's the text to rewrite:

${selectedText}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Claude API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = (await response.json()) as ClaudeAPIResponse;

    // Extract text from the Claude API response
    let rewrittenText = "No text returned from Claude";
    if (data.content?.[0]?.type === "text") {
      rewrittenText = data.content[0].text;
    }

    // Copy rewritten text to clipboard and paste it to replace the selected text
    await Clipboard.copy(rewrittenText);

    try {
      // Paste back automatically to replace the selected text
      await promisify(exec)('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
      await showHUD(`✅ Text rewritten using "${currentPreset.name}" style`);
    } catch (pasteError) {
      console.error("Error auto-pasting:", pasteError);
      await showHUD(`✅ Text rewritten and copied to clipboard (press CMD+V to paste)`);
    }
  } catch (error) {
    console.error("Error:", error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Error rewriting text",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Helper function to get a human-readable model name
function getModelDisplayName(modelId: string | undefined): string {
  if (!modelId) {
    return "Claude 3.5 Sonnet v2"; // Default model display name
  }

  switch (modelId) {
    case "claude-3-7-sonnet-20250219":
      return "Claude 3.7 Sonnet";
    case "claude-3-5-sonnet-20241022":
      return "Claude 3.5 Sonnet v2";
    case "claude-3-5-sonnet-20240620":
      return "Claude 3.5 Sonnet";
    default:
      return modelId;
  }
}
