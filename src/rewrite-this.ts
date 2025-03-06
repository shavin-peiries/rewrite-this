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

export default async function command() {
  try {
    // Get API key and other preferences
    const preferences = getPreferenceValues<Preferences>();
    const apiKey = preferences.claudeApiKey;
    const selectedModel = preferences.claudeModel || "claude-3-5-sonnet-20241022";
    const promptPreset = preferences.promptPreset || "conversational";
    const customPrompt =
      preferences.customPrompt ||
      "Rewrite this with correct spelling and grammar. Aim to have a conversational and human tone of voice.";
    const avoidEmDashes = preferences.avoidEmDashes ?? true;

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

    // Determine which prompt to use based on preset
    let promptToUse = customPrompt;

    if (promptPreset !== "custom") {
      switch (promptPreset) {
        case "conversational":
          promptToUse =
            "Rewrite this with correct spelling and grammar. Aim to have a conversational and human tone of voice."; 
          break;
        case "formal":
          promptToUse =
            "Rewrite this with correct spelling and grammar. Use a formal, professional tone suitable for business or academic contexts.";
          break;
        case "concise":
          promptToUse =
            "Rewrite this to be more concise and clear. Remove unnecessary words and simplify complex sentences while maintaining the original meaning.";
          break;
        case "grammar":
          promptToUse =
            "Fix only the spelling and grammar in this text. Don't change the style, tone, or word choice unless necessary for grammatical correctness.";
          break;
      }
    }

    // Show loading indicator
    await showToast({
      style: Toast.Style.Animated,
      title: "Rewriting selected text...",
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
      await showHUD(`✅ Text rewritten using ${getModelDisplayName(selectedModel)}`);
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
